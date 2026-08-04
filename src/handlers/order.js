const db = require('../models/db');
const { formatIDR, formatUSD, replacePlaceholders, buildPaymentConfirmation, notifyAdmins, escapeHtml } = require('../utils/helpers');
const { convertIDRtoUSD } = require('../payments/exchange');
const { getExpirationTime } = require('../services/invoice');
const gateway = require('../payments/gateway');
const { getBalance, deductBalance } = require('../payments/balance');
const { handlePaymentSuccess } = require('../services/delivery');
const { cancelOrder } = require('../services/reminder');
const { getOwnedOrder, rejectOrderAccess, assertCanStartTransaction } = require('../utils/buyerSecurity');
const { calculateBulkPrice } = require('../utils/bulkPricing');
const { binanceTxidStates } = require('./binanceState');
const {
    paymentMethodKeyboard,
    paymentPendingKeyboard,
    mainMenuKeyboard
} = require('../utils/keyboard');

/** Pure QRIS invoice renderer: layout/case only, no payment calculation. */
const buildQrisInvoiceMessage = ({ order, product, orderId, subtotalDisplay, feeDisplay, totalDisplay, timeoutMinutes, lang = 'id' }) => {
    const rawProdName = lang === 'en'
        ? (product.name_en || product.name_id || '-')
        : (product.name_id || product.name_en || '-');
    const prodName = escapeHtml(rawProdName);
    const title = lang === 'en' ? 'Order Invoice' : 'Invoice Pesanan';
    const l = lang === 'en'
        ? { orderId: 'Order ID', prod: 'Product', qty: 'Quantity', total: 'Total Payment', valid: 'Valid for', fee: 'Fee' }
        : { orderId: 'Order ID', prod: 'Produk', qty: 'Jumlah', total: 'Total Bayar', valid: 'Berlaku', fee: 'Fee' };
    const waitingStatus = lang === 'en' ? 'Waiting for QRIS payment' : 'Menunggu pembayaran QRIS';
    const instruction = lang === 'en' ? 'Scan the QRIS above to complete payment.' : 'Scan QRIS di atas untuk membayar.';

    let message = `<blockquote>🧾 <b>${title}</b></blockquote>\n\n`;
    message += `<b>${l.orderId}:</b> <code>${escapeHtml(orderId)}</code>\n`;
    message += `<b>${l.prod}:</b> ${prodName}\n`;
    message += `<b>${l.qty}:</b> ${order.quantity} pcs\n\n`;
    message += `<b>Subtotal:</b> ${subtotalDisplay}\n`;
    message += `<b>${l.fee}:</b> ${feeDisplay}\n`;
    message += `───────────\n`;
    message += `<blockquote><b>${l.total}:     ${totalDisplay}</b></blockquote>\n\n`;
    message += `<b>Status:</b> ${waitingStatus}\n`;
    message += `<b>${l.valid}:</b> ${timeoutMinutes} ${lang === 'en' ? 'minutes' : 'menit'}\n\n`;
    message += instruction;
    return message;
};

/**
 * Register order handlers
 * @param {Object} bot - Telegraf bot instance
 */
const registerOrderHandler = (bot) => {
    // Quantity selected - show payment options
    bot.action(/^qty_(.+)_(\d+)$/, async (ctx) => {
        const productId = ctx.match[1];
        const quantity = parseInt(ctx.match[2]);
        const userId = ctx.from.id.toString();
        const lang = db.getUserLanguage(userId);
        const locale = require(`../locales/${lang}`);

        if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999) {
            await ctx.answerCbQuery(lang === 'en' ? 'Invalid quantity.' : 'Jumlah tidak valid.', { show_alert: true });
            return;
        }

        // Maintenance mode check
        const settings = db.getSettings();
        if (settings.maintenance) {
            await ctx.answerCbQuery(lang === 'en' ? '⚠️ Bot is under maintenance. Please try again later.' : '⚠️ Bot sedang maintenance. Silakan coba lagi nanti.', { show_alert: true });
            return;
        }

        // Ban check
        const user = db.getUser(userId);
        if (user && user.banned) {
            await ctx.answerCbQuery(lang === 'en' ? '🚫 Your account has been suspended.' : '🚫 Akun Anda telah disuspend.', { show_alert: true });
            return;
        }

        const product = db.getProductById(productId);
        if (!product || product.active === false) {
            await ctx.answerCbQuery(locale.error_general);
            return;
        }

        const stockCount = db.getAvailableStockCount(productId);
        if (product.stock_mode !== 'unlimited' && stockCount < quantity) {
            await ctx.answerCbQuery(locale.error_no_stock);
            return;
        }

        await ctx.answerCbQuery();

        const effectivePrice = db.getEffectivePrice(product);
        const totalIDR = effectivePrice * quantity;
        const totalUSD = await convertIDRtoUSD(totalIDR);

        const productName = lang === 'en' ? product.name_en : product.name_id;
        const totalDisplay = lang === 'en' ? `$${formatUSD(totalUSD)}` : `Rp ${formatIDR(totalIDR)}`;

        // Create pending order
        const order = db.createOrder({
            user_id: userId,
            product_id: productId,
            quantity: quantity,
            total_idr: totalIDR,
            total_usd: parseFloat(totalUSD.toFixed(2)),
            payment_method: null, // Will be set when user selects
            chat_id: ctx.chat.id,
            expires_at: getExpirationTime('qris').toISOString(), // Default, will update based on method
            flash_sale_applied: db.isFlashSaleActive(product)
        });

        const message = replacePlaceholders(locale.confirm_order, {
            product: productName,
            quantity: quantity,
            total_idr: formatIDR(totalIDR),
            total_usd: formatUSD(totalUSD)
        });

        await ctx.editMessageText(message, {
            parse_mode: 'Markdown',
            ...paymentMethodKeyboard(order.id, lang)
        });
    });

    // Payment method selection - back to payment options
    bot.action(/^pay_select_(.+)$/, async (ctx) => {
        const orderId = ctx.match[1];
        const userId = ctx.from.id.toString();
        const lang = db.getUserLanguage(userId);
        const locale = require(`../locales/${lang}`);

        const order = getOwnedOrder(ctx, orderId, { statuses: ['init', 'pending'] });
        if (!order) {
            await rejectOrderAccess(ctx, lang);
            return;
        }

        await ctx.answerCbQuery();

        const product = db.getProductById(order.product_id);
        const productName = lang === 'en' ? product.name_en : product.name_id;

        const message = replacePlaceholders(locale.confirm_order, {
            product: productName,
            quantity: order.quantity,
            total_idr: formatIDR(order.total_idr),
            total_usd: formatUSD(order.total_usd)
        });

        await ctx.editMessageText(message, {
            parse_mode: 'Markdown',
            ...paymentMethodKeyboard(orderId, lang)
        });
    });

    // QRIS payment selected — router: kalau >1 gateway aktif, tampilkan pilihan;
    // kalau cuma 1 (atau .env tunggal), langsung generate seperti flow lama.
    bot.action(/^pay_qris_(.+)$/, async (ctx) => {
        const orderId = ctx.match[1];
        const userId = ctx.from.id.toString();
        const lang = db.getUserLanguage(userId);
        const locale = require(`../locales/${lang}`);

        if (!await assertCanStartTransaction(ctx, lang)) return;

        // Check if QRIS is enabled
        const settings = db.getSettings();
        if (!settings.qris_enabled) {
            await ctx.answerCbQuery(lang === 'en' ? '⚠️ QRIS is under maintenance.' : '⚠️ QRIS sedang maintenance.', { show_alert: true });
            return;
        }

        const order = getOwnedOrder(ctx, orderId, { statuses: ['init', 'pending'] });
        if (!order) {
            await rejectOrderAccess(ctx, lang);
            return;
        }

        const activeGateways = gateway.listActiveGateways();
        if (activeGateways.length === 0) {
            await ctx.answerCbQuery(lang === 'en' ? '⚠️ No active payment gateway.' : '⚠️ Tidak ada payment gateway aktif.', { show_alert: true });
            return;
        }

        // Legacy callback dari pesan lama: pakai gateway aktif pertama.
        await ctx.answerCbQuery('Creating QRIS...');
        await generateQrisForOrder(ctx, orderId, activeGateways[0].id, lang);
    });

    // Buyer memilih gateway QRIS spesifik (saat >1 aktif). callback: pay_qgw_<gid>_<orderId>
    bot.action(/^pay_qgw_([^_]+)_(.+)$/, async (ctx) => {
        const token = ctx.match[1];
        const gid = token.startsWith('env-') ? null : token;
        const orderId = ctx.match[2];
        const userId = ctx.from.id.toString();
        const lang = db.getUserLanguage(userId);
        const locale = require(`../locales/${lang}`);

        if (!await assertCanStartTransaction(ctx, lang)) return;

        const settings = db.getSettings();
        if (!settings.qris_enabled) {
            await ctx.answerCbQuery(lang === 'en' ? '⚠️ QRIS is under maintenance.' : '⚠️ QRIS sedang maintenance.', { show_alert: true });
            return;
        }
        const order = getOwnedOrder(ctx, orderId, { statuses: ['init', 'pending'] });
        if (!order) {
            await rejectOrderAccess(ctx, lang);
            return;
        }
        await ctx.answerCbQuery('Creating QRIS...');
        await generateQrisForOrder(ctx, orderId, gid, lang);
    });

    /**
     * Generate QRIS untuk sebuah order via gateway tertentu, lalu kirim invoice+QR ke buyer.
     * Dipakai baik oleh flow single-gateway maupun setelah buyer memilih gateway.
     * @param {string|null} gatewayId - id gateway pilihan (null = default/tunggal/.env)
     */
    async function repriceExpiredFlashOrder(ctx, order, lang) {
        const product = db.getProductById(order.product_id);
        const pricing = calculateBulkPrice(product.price_idr, order.quantity, product.qty_discounts, false);
        let totalIDR = pricing.total;
        let discount = 0;
        if (order.voucher_code) {
            const voucher = db.getVoucherByCode(order.voucher_code);
            if (voucher) {
                discount = db.calculateDiscount(totalIDR, voucher);
                totalIDR -= discount;
            }
        }
        const totalUSD = await convertIDRtoUSD(totalIDR);
        const originalUSD = await convertIDRtoUSD(pricing.total);
        const updated = db.updateOrder(order.id, {
            status: 'init', flash_sale_applied: false,
            total_idr: totalIDR, total_usd: parseFloat(totalUSD.toFixed(2)),
            original_total_idr: pricing.total, original_total_usd: parseFloat(originalUSD.toFixed(2)), discount_amount: discount
        });
        const warning = lang === 'en'
            ? '⚠️ The Flash Sale slot has just run out. The order was updated to the current normal/bulk price. Please review the new total.'
            : '⚠️ Slot Flash Sale baru saja habis. Order diperbarui ke harga normal/grosir saat ini. Silakan periksa total baru.';
        await ctx.reply(warning);
        const message = await buildPaymentConfirmation(updated, lang, db, convertIDRtoUSD);
        await ctx.editMessageText(message, { parse_mode: 'HTML', ...paymentMethodKeyboard(order.id, lang) });
    }

    async function generateQrisForOrder(ctx, orderId, gatewayId, lang) {
        const userId = ctx.from.id.toString();
        const order = getOwnedOrder(ctx, orderId, { statuses: ['init', 'pending'] });
        if (!order) return rejectOrderAccess(ctx, lang);

        // Atomic claim: hanya satu tap/callback yang boleh membuat QR & mereservasi stok.
        // Tap kedua melihat status processing dan berhenti, bukan membuat transaksi duplikat.
        if (!db.claimOrderForPayment(orderId)) {
            try {
                await ctx.answerCbQuery(lang === 'en' ? 'Payment is being processed.' : 'Pembayaran sedang diproses.', { show_alert: true });
            } catch (e) { /* callback query mungkin sudah dijawab */ }
            return;
        }

        // Siapkan method + expiry; status tetap processing sampai QR berhasil dibuat.
        const expiresAt = getExpirationTime('qris');
        const flashClaim = db.claimFlashSaleSlot(orderId, expiresAt.toISOString());
        if (!flashClaim.ok) {
            await repriceExpiredFlashOrder(ctx, order, lang);
            return;
        }
        db.refreshVoucherHold(orderId, expiresAt.toISOString());
        db.updateOrder(orderId, {
            status: 'processing',
            payment_method: 'qris',
            expires_at: expiresAt.toISOString()
        });

        // Reserve stock (race guard)
        const prodForReserve = db.getProductById(order.product_id);
        if (prodForReserve && prodForReserve.stock_mode !== 'unlimited') {
            const reserved = db.reserveStock(order.product_id, order.quantity, orderId);
            if (!reserved) {
                db.releaseFlashSaleSlot(orderId);
                db.releaseVoucherHold(orderId);
                db.updateOrder(orderId, { status: 'cancelled' });
                try { await ctx.deleteMessage(); } catch (e) { }
                const errMsg = lang === 'en'
                    ? '❌ Sorry, stock just ran out. Another buyer was faster.'
                    : '❌ Maaf, stok baru saja habis. Pembeli lain lebih cepat.';
                await ctx.reply(errMsg, { ...mainMenuKeyboard(lang, userId) });
                return;
            }
        }

        // Create QRIS via dispatcher. Xoftware menerima timeout toko secara native;
        // PaKasir/WijayaPay tetap memakai timeout lokal yang sama untuk cleanup order/chat/stok.
        const timeoutMinutes = parseInt(db.getConfig('payment_timeout_minutes', null, 15)) || 15;
        const productForMeta = db.getProductById(order.product_id);
        const userForMeta = db.getUser(userId) || {};
        const qrisResult = await gateway.createQRIS(orderId, order.total_idr, gatewayId, {
            timeout_minutes: timeoutMinutes,
            user_id: userId,
            customer_name: userForMeta.first_name || 'Telegram Buyer',
            metadata: {
                customer: { id: userId, name: userForMeta.first_name || 'Telegram Buyer' },
                products: [{ product_code: order.product_id, product_name: productForMeta?.name_id || order.product_id }]
            }
        });

        if (!qrisResult.success) {
            console.error('[ORDER] QRIS creation failed:', qrisResult.error);
            db.releaseReservedStock(orderId);
            db.releaseVoucherHold(orderId);
            db.releaseFlashSaleSlot(orderId);
            db.updateOrder(orderId, { status: 'cancelled' });
            try { await ctx.deleteMessage(); } catch (e) { }
            const errMsg = lang === 'en'
                ? '❌ Failed to create QRIS payment. Please try again.'
                : '❌ Gagal membuat pembayaran QRIS. Silakan coba lagi.';
            await ctx.reply(errMsg, { ...mainMenuKeyboard(lang, userId) });
            return;
        }

        const { renderPaymentImage, getPlainQR } = require('../services/qrisCustom');

        const product = db.getProductById(order.product_id);
        const totalAmount = qrisResult.data.total_payment || order.total_idr;
        const buyerFee = Math.max(0, totalAmount - order.total_idr);
        const totalDisplay = lang === 'en'
            ? `$${formatUSD(await convertIDRtoUSD(totalAmount))}`
            : `Rp ${formatIDR(totalAmount)}`;
        const feeDisplay = lang === 'en'
            ? `$${formatUSD(await convertIDRtoUSD(buyerFee))}`
            : `Rp ${formatIDR(buyerFee)}`;

        const subtotalDisplay = lang === 'en'
            ? `$${formatUSD(await convertIDRtoUSD(order.total_idr))}`
            : `Rp${formatIDR(order.total_idr)}`;
        const message = buildQrisInvoiceMessage({
            order, product, orderId, subtotalDisplay, feeDisplay, totalDisplay, timeoutMinutes, lang
        });

        try { await ctx.deleteMessage(); } catch (e) { }

        let sentMsg;
        try {
            const image = await renderPaymentImage(qrisResult.data);
            sentMsg = await ctx.replyWithPhoto({ source: image.buffer }, {
                caption: message, parse_mode: 'HTML', ...paymentPendingKeyboard(orderId, lang)
            });
        } catch (e) {
            console.error('[QRIS] Custom render failed, using plain QR:', e.message);
            const plainQR = await getPlainQR(qrisResult.data);
            sentMsg = await ctx.replyWithPhoto({ source: plainQR }, {
                caption: message, parse_mode: 'HTML', ...paymentPendingKeyboard(orderId, lang)
            });
        }

        // Simpan message_id + gateway yang dipakai. gateway_id menjamin cek status /
        // verifikasi / webhook memakai credential gateway yang SAMA dengan transaksi.
        db.updateOrder(orderId, {
            status: 'pending',
            message_id: sentMsg.message_id,
            gateway_id: qrisResult.gateway_id || null,
            gateway_signature: qrisResult.data?.signature || null,
            gateway_reference: qrisResult.data?.trx_reference || null
        });

        await notifyAdminNewOrder(ctx.telegram, orderId, order, 'QRIS');
    }

    // Check Payment Status Manually
    bot.action(/^pay_check_(.+)$/, async (ctx) => {
        const orderId = ctx.match[1];
        const userId = ctx.from.id.toString();
        const lang = db.getUserLanguage(userId);

        const order = getOwnedOrder(ctx, orderId, { statuses: ['pending'] });
        if (!order) return rejectOrderAccess(ctx, lang);

        await ctx.answerCbQuery('Checking status...');

        if (order.payment_method === 'qris') {
            // QRIS payment — cek pakai gateway yang membuat transaksi (provider-agnostic)
            const result = await gateway.checkStatus(orderId, order.total_idr, order.gateway_id);

            if (result.success && result.status === 'completed') {
                await handlePaymentSuccess(bot, orderId);
            } else if (result.success && result.status === 'expired') {
                await ctx.answerCbQuery('Invoice expired!', { show_alert: true });
                await ctx.deleteMessage();
                const lang = db.getUserLanguage(ctx.from.id.toString());
                const expiredMsg = lang === 'en' ? '❌ Invoice expired. Please create a new order.' : '❌ Invoice sudah kadaluarsa. Silakan order ulang.';
                await ctx.reply(expiredMsg, { ...mainMenuKeyboard(lang, ctx.from.id.toString()) });
            } else {
                const lang = db.getUserLanguage(ctx.from.id.toString());
                const pendingMsg = lang === 'en'
                    ? '⏳ Payment not detected yet. Please wait a moment after paying.'
                    : '⏳ Belum ada pembayaran masuk. Mohon tunggu sebentar setelah membayar.';
                await ctx.answerCbQuery(pendingMsg, { show_alert: true });
            }
        }
    });

    // Cancel Order
    bot.action(/^pay_cancel_(.+)$/, async (ctx) => {
        const orderId = ctx.match[1];
        const userId = ctx.from.id.toString();
        const lang = db.getUserLanguage(userId);

        const order = getOwnedOrder(ctx, orderId, { statuses: ['init', 'pending'] });
        if (!order) {
            return rejectOrderAccess(ctx, lang);
        }
        await ctx.answerCbQuery();

        // If order is still in 'init' stage (at confirmation), delete it entirely
        if (order.status === 'init') {
            db.releaseFlashSaleSlot(orderId);
            db.releaseVoucherHold(orderId);
            db.deleteOrder(orderId); // Completely remove from DB
        } else {
            // If already pending (payment method selected), release reserved stock + cancel
            db.releaseReservedStock(orderId);
            db.releaseFlashSaleSlot(orderId);
            db.releaseVoucherHold(orderId);
            db.updateOrder(orderId, { status: 'cancelled' });
        }

        await ctx.deleteMessage();
        const cancelMsg = lang === 'en' ? '❌ Order cancelled.' : '❌ Order dibatalkan.';
        await ctx.reply(cancelMsg, {
            ...mainMenuKeyboard(lang, ctx.from.id.toString())
        });
    });

    // Saldo payment selected - instant pay from balance
    bot.action(/^pay_saldo_(.+)$/, async (ctx) => {
        const orderId = ctx.match[1];
        const userId = ctx.from.id.toString();
        const lang = db.getUserLanguage(userId);
        const locale = require(`../locales/${lang}`);

        if (!await assertCanStartTransaction(ctx, lang)) return;

        // Check if Saldo is enabled
        const settings = db.getSettings();
        if (settings.saldo_enabled === false) {
            await ctx.answerCbQuery(lang === 'en' ? '⚠️ Balance payment is under maintenance.' : '⚠️ Pembayaran saldo sedang maintenance.', { show_alert: true });
            return;
        }

        const order = getOwnedOrder(ctx, orderId, { statuses: ['init', 'pending'] });
        if (!order) {
            await rejectOrderAccess(ctx, lang);
            return;
        }

        // Check balance
        const currentBalance = getBalance(userId);
        if (currentBalance < order.total_idr) {
            const balanceDisplay = lang === 'en'
                ? `$${formatUSD(await convertIDRtoUSD(currentBalance))}`
                : `Rp ${formatIDR(currentBalance)}`;
            const totalDisplay = lang === 'en'
                ? `$${formatUSD(order.total_usd)}`
                : `Rp ${formatIDR(order.total_idr)}`;
            const msg = lang === 'en'
                ? `❌ Insufficient balance!\n\n💰 Your balance: ${balanceDisplay}\n💳 Total: ${totalDisplay}\n\nPlease top up your balance first.`
                : `❌ Saldo tidak cukup!\n\n💰 Saldo kamu: ${balanceDisplay}\n💳 Total: ${totalDisplay}\n\nSilakan topup saldo terlebih dahulu.`;
            await ctx.answerCbQuery(lang === 'en' ? '❌ Insufficient balance!' : '❌ Saldo tidak cukup!', { show_alert: true });
            return;
        }

        // H1: atomically claim this order so a rapid double-tap can't charge twice.
        // Only ONE invocation flips it out of init/pending; a concurrent tap gets false and bails.
        if (!db.claimOrderForPayment(orderId)) {
            await ctx.answerCbQuery(lang === 'en' ? '⏳ Already being processed...' : '⏳ Order sedang diproses...');
            return;
        }

        const holdMinutes = parseInt(db.getConfig('payment_timeout_minutes', null, 15)) || 15;
        const saldoHoldExpiry = new Date(Date.now() + holdMinutes * 60 * 1000).toISOString();
        const flashClaim = db.claimFlashSaleSlot(orderId, saldoHoldExpiry);
        if (!flashClaim.ok) {
            await ctx.answerCbQuery(lang === 'en' ? 'Flash Sale slot sold out.' : 'Slot Flash Sale habis.', { show_alert: true });
            await repriceExpiredFlashOrder(ctx, order, lang);
            return;
        }

        await ctx.answerCbQuery(lang === 'en' ? '💰 Processing...' : '💰 Memproses...');

        // Check stock availability one more time before instant payment
        const product = db.getProductById(order.product_id);
        if (product && product.stock_mode !== 'unlimited') {
            const stockCount = db.getAvailableStockCount(order.product_id);
            if (stockCount < order.quantity) {
                db.releaseFlashSaleSlot(orderId);
                db.releaseVoucherHold(orderId);
                db.updateOrder(orderId, { status: 'cancelled' });
                try { await ctx.deleteMessage(); } catch (e) { }
                const errMsg = lang === 'en'
                    ? '❌ Sorry, stock just ran out. Another buyer was faster.'
                    : '❌ Maaf, stok baru saja habis. Pembeli lain lebih cepat.';
                await ctx.reply(errMsg, { ...mainMenuKeyboard(lang, userId) });
                return;
            }
        }

        // Deduct balance
        const productName = lang === 'en' ? product.name_en : product.name_id;
        const result = deductBalance(userId, order.total_idr, orderId, `Beli ${productName} x${order.quantity}`);

        if (!result) {
            db.releaseFlashSaleSlot(orderId);
            db.updateOrder(orderId, { status: 'init' }); // revert claim so the user can retry
            const errMsg = lang === 'en' ? '❌ Failed to deduct balance.' : '❌ Gagal memotong saldo.';
            await ctx.answerCbQuery(errMsg, { show_alert: true });
            return;
        }

        // Update order status
        db.updateOrder(orderId, {
            status: 'pending',
            payment_method: 'saldo',
            expires_at: new Date().toISOString() // Instant, no expiry needed
        });

        // Trigger delivery immediately (saldo = instant)
        await handlePaymentSuccess(bot, orderId, { method: 'saldo' });

        // Delete the confirmation message
        try { await ctx.deleteMessage(); } catch (e) { }

        // Saldo = instant, skip ORDER MASUK — admin gets ORDER SELESAI directly
    });

    // ==================== VOUCHER SYSTEM ====================

    // Store voucher input states (userId -> orderId)
    const voucherStates = new Map();

    const cleanupVoucherInput = async (ctx, state) => {
        try { await ctx.telegram.deleteMessage(state.chatId, state.promptMessageId); } catch (_) { }
        try { await ctx.deleteMessage(); } catch (_) { }
    };

    const editVoucherConfirmation = async (ctx, state, order, lang) => {
        const confirmMsg = await buildPaymentConfirmation(order, lang, db, convertIDRtoUSD);
        try {
            await ctx.telegram.editMessageText(state.chatId, state.confirmationMessageId, undefined, confirmMsg, {
                parse_mode: 'HTML', ...paymentMethodKeyboard(order.id, lang)
            });
        } catch (_) {
            await ctx.reply(confirmMsg, { parse_mode: 'HTML', ...paymentMethodKeyboard(order.id, lang) });
        }
    };

    // Helper: delay function
    const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    // User clicks "Pakai Voucher" button
    bot.action(/^voucher_apply_(.+)$/, async (ctx) => {
        const orderId = ctx.match[1];
        const userId = ctx.from.id.toString();
        const lang = db.getUserLanguage(userId);

        const order = getOwnedOrder(ctx, orderId, { statuses: ['init'] });
        if (!order) {
            await rejectOrderAccess(ctx, lang);
            return;
        }

        // Check if voucher already applied
        if (order.voucher_code) {
            const msg = lang === 'en'
                ? `⚠️ Voucher "${order.voucher_code}" already applied!`
                : `⚠️ Voucher "${order.voucher_code}" sudah dipakai!`;
            await ctx.answerCbQuery(msg, { show_alert: true });
            return;
        }

        await ctx.answerCbQuery();

        const prompt = lang === 'en'
            ? 'Type your voucher code:'
            : 'Ketik kode voucher:';

        const promptMsg = await ctx.reply(prompt, {
            reply_markup: { force_reply: true, selective: true }
        });
        voucherStates.set(userId, {
            orderId,
            chatId: ctx.chat.id,
            confirmationMessageId: ctx.callbackQuery?.message?.message_id,
            promptMessageId: promptMsg.message_id,
            expiresAt: Date.now() + 10 * 60 * 1000
        });
    });

    // Cancel voucher input
    bot.action(/^voucher_cancel_(.+)$/, async (ctx) => {
        const orderId = ctx.match[1];
        const userId = ctx.from.id.toString();
        const lang = db.getUserLanguage(userId);

        voucherStates.delete(userId);
        await ctx.answerCbQuery();

        const order = getOwnedOrder(ctx, orderId, { statuses: ['init'] });
        if (!order) return rejectOrderAccess(ctx, lang);

        const confirmMsg = await buildPaymentConfirmation(order, lang, db, convertIDRtoUSD);

        try { await ctx.deleteMessage(); } catch (e) { }
        await ctx.reply(confirmMsg, {
            parse_mode: 'HTML',
            ...paymentMethodKeyboard(orderId, lang)
        });
    });

    // Remove an already-applied voucher ("Hapus Voucher" button)
    bot.action(/^voucher_remove_(.+)$/, async (ctx) => {
        const orderId = ctx.match[1];
        const userId = ctx.from.id.toString();
        const lang = db.getUserLanguage(userId);

        const order = getOwnedOrder(ctx, orderId, { statuses: ['init'] });
        if (!order) {
            await rejectOrderAccess(ctx, lang);
            return;
        }

        if (order.voucher_code) {
            db.releaseVoucherHold(orderId);
            // Restore original totals and clear voucher fields (voucher was never consumed)
            db.updateOrder(orderId, {
                voucher_code: null,
                discount_amount: 0,
                total_idr: order.original_total_idr || order.total_idr,
                total_usd: order.original_total_usd || order.total_usd,
                original_total_idr: null,
                original_total_usd: null
            });
        }

        await ctx.answerCbQuery(lang === 'en' ? '🗑️ Voucher removed' : '🗑️ Voucher dihapus');

        const updatedOrder = db.getOrderById(orderId);
        const confirmMsg = await buildPaymentConfirmation(updatedOrder, lang, db, convertIDRtoUSD);
        await ctx.editMessageText(confirmMsg, {
            parse_mode: 'HTML',
            ...paymentMethodKeyboard(orderId, lang)
        });
    });

    // Text handler for voucher code input
    bot.on('text', async (ctx, next) => {
        const userId = ctx.from.id.toString();
        const state = voucherStates.get(userId);

        if (!state) return next();
        if (state.expiresAt <= Date.now()) {
            voucherStates.delete(userId);
            return next();
        }
        if (String(ctx.chat.id) !== String(state.chatId)) return next();
        if (ctx.message.reply_to_message?.message_id !== state.promptMessageId) return next();
        const orderId = state.orderId;

        const lang = db.getUserLanguage(userId);
        const code = ctx.message.text.trim().toUpperCase();

        // Clear state
        voucherStates.delete(userId);
        await cleanupVoucherInput(ctx, state);

        // Validate voucher
        const voucher = db.getVoucherByCode(code);

        if (!voucher || db.hasUserRedeemedVoucher(code, userId)) {
            // FAIL: show error, wait 3s, replace with original form.
            // Per-user rule: a code is valid once PER user (checked via voucher_redemptions).
            const errorMsg = !voucher
                ? (lang === 'en' ? '❌ Voucher code not found.' : '❌ Kode voucher tidak ditemukan.')
                : (lang === 'en' ? '❌ You have already used this voucher.' : '❌ Kamu sudah pernah pakai voucher ini.');

            const sentMsg = await ctx.reply(errorMsg);

            await delay(2000);

            try { await ctx.telegram.deleteMessage(ctx.chat.id, sentMsg.message_id); } catch (e) { }

            const order = getOwnedOrder(ctx, orderId, { statuses: ['init'] });
            if (!order) return rejectOrderAccess(ctx, lang);
            return;
        }

        // SUCCESS: voucher hanya boleh mengubah draft order milik user ini.
        const order = getOwnedOrder(ctx, orderId, { statuses: ['init'] });
        if (!order) return rejectOrderAccess(ctx, lang);

        if (!db.claimVoucherHold(code, userId, orderId)) {
            const msg = lang === 'en'
                ? '❌ This voucher is already held or redeemed by another order.'
                : '❌ Voucher ini sedang dipakai atau sudah digunakan di order lain.';
            await ctx.reply(msg);
            return;
        }

        const discountAmount = db.calculateDiscount(order.total_idr, voucher);
        const finalPrice = order.total_idr - discountAmount;
        const finalUSD = await convertIDRtoUSD(finalPrice);

        // NOTE: voucher is NOT consumed here. It's only recorded as redeemed at
        // payment success (delivery.js), so an abandoned/cancelled order never burns it.

        // Update order with voucher info
        db.updateOrder(orderId, {
            voucher_code: code,
            discount_amount: discountAmount,
            total_idr: finalPrice,
            total_usd: parseFloat(finalUSD.toFixed(2)),
            original_total_idr: order.total_idr,
            original_total_usd: order.total_usd
        });

        // Edit the original confirmation message; no duplicate payment page.
        const updatedOrder = db.getOrderById(orderId);
        await editVoucherConfirmation(ctx, state, updatedOrder, lang);
    });

    // ==================== BINANCE PAY ====================
    // Flow: buyer klik → bot tampilkan QR statis + nominal USDT + minta TX ID (force_reply)
    // → buyer submit TX ID → bot verifikasi via API Binance (TX ID + nominal cocok, belum
    // dipakai) → set paid → handlePaymentSuccess (kirim produk).
    // State di-share dengan keyboard.js (untuk top-up Binance Pay juga) via binanceState.js.

    bot.action(/^pay_binance_(.+)$/, async (ctx) => {
        const orderId = ctx.match[1];
        const userId = ctx.from.id.toString();
        const lang = db.getUserLanguage(userId);

        if (!await assertCanStartTransaction(ctx, lang)) return;

        const order = getOwnedOrder(ctx, orderId, { statuses: ['init', 'pending'] });
        if (!order) return rejectOrderAccess(ctx, lang);

        if (!gateway.isBinanceEnabled()) {
            return ctx.answerCbQuery(lang === 'en' ? 'Binance Pay is unavailable.' : 'Binance Pay tidak tersedia.', { show_alert: true });
        }

        await ctx.answerCbQuery(lang === 'en' ? 'Preparing Binance Pay...' : 'Menyiapkan Binance Pay...');

        // Hitung nominal USDT saat QR disiapkan (bukan realtime polling — sesuai desain).
        const totalUSD = order.total_usd || await convertIDRtoUSD(order.total_idr);
        const amountUSDT = parseFloat(Number(totalUSD).toFixed(2));

        const qr = await gateway.renderBinanceQR();
        if (!qr.success) {
            return ctx.reply(lang === 'en' ? `Failed to load Binance QR: ${qr.error}` : `Gagal memuat QR Binance: ${qr.error}`);
        }

        // Binance diberi waktu tetap 15 menit dari saat buyer memilih metode ini.
        // QRIS/setting timeout lain tidak disentuh.
        const binanceExpiry = new Date(Date.now() + 15 * 60 * 1000);
        db.updateOrder(orderId, {
            payment_method: 'binance',
            status: 'pending',
            binance_amount: String(amountUSDT),
            expires_at: binanceExpiry.toISOString()
        });

        // Reserve stok setelah order pending — sama seperti flow QRIS (race guard).
        const prodForReserve = db.getProductById(order.product_id);
        if (prodForReserve && prodForReserve.stock_mode !== 'unlimited') {
            const reserved = db.reserveStock(order.product_id, order.quantity, orderId);
            if (!reserved) {
                db.updateOrder(orderId, { status: 'cancelled' });
                return ctx.reply(lang === 'en'
                    ? '❌ Stock ran out. Please try again.'
                    : '❌ Stok habis. Silakan coba lagi.');
            }
        }

        // Hapus chat "Konfirmasi Pembayaran" (pesan pembawa tombol) — sama seperti flow
        // QRIS: begitu QR muncul, halaman pemilihan metode dibersihkan.
        try { await ctx.deleteMessage(); } catch (e) { }

        const currency = qr.currency || 'USDT';
        const product = db.getProductById(order.product_id);
        const productName = escapeHtml(lang === 'en'
            ? (product?.name_en || product?.name_id || '-')
            : (product?.name_id || product?.name_en || '-'));
        const qtyLabel = lang === 'en' ? 'pcs' : 'pcs';
        const caption = lang === 'en'
            ? `<blockquote>🅑 <b>Binance Pay</b></blockquote>\n\n<b>Order:</b> <code>${orderId}</code>\n<b>Product:</b> ${productName}\n<b>Quantity:</b> ${order.quantity} ${qtyLabel}\n\n<blockquote><b>Pay exactly: ${amountUSDT} ${currency}</b></blockquote>\n\n1. Scan the QR in your Binance app\n2. Enter the exact amount above\n3. After paying, <b>reply to this message with your Transaction ID</b>`
            : `<blockquote>🅑 <b>Binance Pay</b></blockquote>\n\n<b>Order:</b> <code>${orderId}</code>\n<b>Produk:</b> ${productName}\n<b>Jumlah:</b> ${order.quantity} ${qtyLabel}\n\n<blockquote><b>Bayar tepat: ${amountUSDT} ${currency}</b></blockquote>\n\n1. Scan QR di aplikasi Binance kamu\n2. Masukkan nominal PERSIS di atas\n3. Setelah bayar, <b>balas pesan ini dengan Transaction ID</b>`;

        // Sama seperti QRIS: simpan message_id invoice QR + prompt TX ID agar expiry
        // checker bisa hapus keduanya saat order expired (cegah buyer submit TX ID setelah expiry).
        const invoiceMsg = await ctx.replyWithPhoto({ source: qr.buffer }, { caption, parse_mode: 'HTML' });
        
        const promptText = lang === 'en'
            ? 'Reply here with your Binance Transaction ID:'
            : 'Balas pesan ini dengan Transaction ID Binance kamu:';
        const promptMsg = await ctx.reply(promptText, { reply_markup: { force_reply: true, selective: true } });

        db.updateOrder(orderId, {
            message_id: invoiceMsg.message_id,
            reminder_message_id: promptMsg.message_id
        });
        await notifyAdminNewOrder(ctx.telegram, orderId, db.getOrderById(orderId), 'BINANCE PAY');

        binanceTxidStates.set(orderId, {
            orderId,
            chatId: ctx.chat.id,
            invoiceMessageId: invoiceMsg.message_id,
            promptMessageId: promptMsg.message_id,
            amountUSDT,
            expiresAt: Date.now() + 30 * 60 * 1000
        });
    });

    // Text handler: buyer submit Binance TX ID (harus reply ke prompt).
    bot.on('text', async (ctx, next) => {
        const userId = ctx.from.id.toString();
        const state = binanceTxidStates.get(userId);
        if (!state) return next();
        if (state.expiresAt <= Date.now()) { binanceTxidStates.delete(userId); return next(); }
        if (String(ctx.chat.id) !== String(state.chatId)) return next();
        if (ctx.message.reply_to_message?.message_id !== state.promptMessageId) return next();

        const lang = db.getUserLanguage(userId);
        const orderId = state.orderId;
        const txId = ctx.message.text.trim();

        // Validasi order masih layak dibayar + belum expired.
        const order = db.getOrderById(orderId);
        if (!order || !['pending', 'init', 'processing'].includes(order.status)) {
            binanceTxidStates.delete(orderId);
            return ctx.reply(lang === 'en' ? 'This order is no longer payable.' : 'Order ini sudah tidak bisa dibayar.');
        }
        // Cegah buyer submit TX ID setelah order expired (walau state masih ada).
        if (order.expires_at && new Date(order.expires_at) <= new Date()) {
            binanceTxidStates.delete(orderId);
            return ctx.reply(lang === 'en'
                ? '⏰ Order expired. Please create a new order.'
                : '⏰ Order sudah kadaluarsa. Silakan buat order baru.');
        }

        // 1) Anti-reuse cepat (sebelum hit API).
        const usedBy = db.isBinanceTxidUsed(txId);
        if (usedBy) {
            return ctx.reply(lang === 'en'
                ? '❌ This Transaction ID was already used.'
                : '❌ Transaction ID ini sudah pernah dipakai.');
        }

        const verifyingMsg = await ctx.reply(lang === 'en' ? '⏳ Verifying your payment...' : '⏳ Memverifikasi pembayaran...');
        const deleteVerifying = async () => {
            try { await ctx.telegram.deleteMessage(ctx.chat.id, verifyingMsg.message_id); } catch (_) { }
        };

        // 2) Verifikasi ke Binance (TX ID + nominal + currency + arah masuk).
        const amountUSDT = state.amountUSDT || parseFloat(order.binance_amount || order.total_usd || 0);
        console.log(`[BINANCE] verify start order=${orderId} txid=${txId} amount=${amountUSDT}`);
        const vt0 = Date.now();
        let result;
        try {
            result = await gateway.verifyBinancePayment(txId, amountUSDT, {
                orderCreatedAt: order.created_at
            });
        } catch (e) {
            console.error(`[BINANCE] verify THREW: ${e.message}`);
            return ctx.reply(lang === 'en' ? 'Verification error, try again.' : 'Error verifikasi, coba lagi.');
        }
        console.log(`[BINANCE] verify done in ${((Date.now() - vt0) / 1000).toFixed(1)}s valid=${result.valid} status=${result.status}`);

        if (!result.valid) {
            const reasons = {
                not_found: lang === 'en' ? 'Transaction ID not found in payments yet. Wait a moment and retry.' : 'Transaction ID belum ditemukan. Tunggu sebentar lalu coba lagi.',
                amount_mismatch: lang === 'en' ? 'Amount does not match the order.' : 'Nominal tidak sesuai order.',
                currency_mismatch: lang === 'en' ? 'Wrong currency.' : 'Mata uang salah.',
                outgoing: lang === 'en' ? 'That transaction is outgoing, not a payment to us.' : 'Transaksi itu keluar, bukan pembayaran ke kami.',
                api_error: lang === 'en' ? 'Verification service error. Try again shortly.' : 'Layanan verifikasi bermasalah. Coba lagi sebentar.',
                no_txid: lang === 'en' ? 'Please send a valid Transaction ID.' : 'Kirim Transaction ID yang valid.'
            };
            const msg = reasons[result.status] || (lang === 'en' ? 'Verification failed.' : 'Verifikasi gagal.');
            // JANGAN hapus state untuk kasus not_found/api_error → buyer bisa retry (reply lagi).
            if (!['not_found', 'api_error'].includes(result.status)) binanceTxidStates.delete(userId);
            return ctx.reply(`❌ ${msg}`);
        }

        // Valid = bersihkan pesan sementara sebelum receipt/pengiriman tampil.
        // Invoice QR dihapus oleh handlePaymentSuccess memakai order.message_id.
        await deleteVerifying();
        try { await ctx.telegram.deleteMessage(state.chatId, state.promptMessageId); } catch (_) { }
        try { await ctx.deleteMessage(); } catch (_) { } // pesan TX ID buyer

        // 3) Klaim TX ID atomik (anti-reuse race). Kalah race → tolak.
        const claimed = db.claimBinanceTxid(txId, orderId, amountUSDT);
        if (!claimed) {
            binanceTxidStates.delete(userId);
            return ctx.reply(lang === 'en' ? '❌ This Transaction ID was just used.' : '❌ Transaction ID ini baru saja dipakai.');
        }

        // 4) Konsumsi state + catat TX ID. JANGAN set status 'paid' di sini:
        // handlePaymentSuccess() memakai claimOrderForDelivery() yang HANYA menang saat
        // status masih 'pending' (persis seperti flow QRIS). Kalau kita set 'paid' dulu,
        // claim gagal dan produk tidak terkirim.
        binanceTxidStates.delete(userId);
        db.updateOrder(orderId, { binance_txid: txId, paid_at: new Date().toISOString() });

        try {
            const delivered = await handlePaymentSuccess(bot, orderId, { transaction_id: txId });
            if (delivered === false) {
                return ctx.reply(lang === 'en'
                    ? '⚠️ Payment verified but order could not be delivered (already processed?). Contact support.'
                    : '⚠️ Pembayaran terverifikasi tapi order gagal dikirim (sudah diproses?). Hubungi admin.');
            }
        } catch (e) {
            console.error('[BINANCE] deliver error:', e.message);
            return ctx.reply(lang === 'en'
                ? '✅ Payment verified, but delivery hit an error. Contact support.'
                : '✅ Pembayaran terverifikasi, tapi pengiriman error. Hubungi admin.');
        }
    });

};


/**
 * Notify admin about new order
 */
// Map to store admin notification message IDs: orderId -> [{chatId, messageId}]
const adminNotifMessages = new Map();

const notifyAdminNewOrder = async (telegram, orderId, order, method) => {
    try {
        const product = db.getProductById(order.product_id);
        const locale = require('../locales/id');
        const { getAdminIds } = require('../utils/helpers');
        const user = db.getUser(order.user_id);
        const username = user?.username ? `@${user.username}` : '-';
        const userDisplay = `${username} (<code>${order.user_id}</code>)`;

        const now = new Date().toLocaleString('id-ID', {
            timeZone: 'Asia/Jakarta',
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit', second: '2-digit'
        }) + ' WIB';

        const message = replacePlaceholders(locale.admin_notif_new_order, {
            order_id: orderId,
            user_display: userDisplay,
            product: product.name_id,
            quantity: order.quantity,
            amount: formatIDR(order.total_idr),
            checkout_time: now,
            method: method
        });

        // Send to each admin and save message IDs
        const ids = getAdminIds();
        const sentMessages = [];
        for (const id of ids) {
            try {
                const sent = await telegram.sendMessage(id, message, { parse_mode: 'HTML' });
                sentMessages.push({ chatId: id, messageId: sent.message_id });
            } catch (e) {
                console.error(`Failed to notify admin ${id}:`, e.message);
            }
        }
        adminNotifMessages.set(orderId, sentMessages);
    } catch (error) {
        console.error('Admin notification error:', error);
    }
};

/**
 * Update ORDER MASUK message status to ✅ Completed
 */
const updateOrderMasukCompleted = async (telegram, orderId) => {
    const messages = adminNotifMessages.get(orderId);
    if (!messages || messages.length === 0) return;

    // Simpler: just edit each message's text
    try {
        const order = db.getOrderById(orderId);
        if (!order) return;
        const product = db.getProductById(order.product_id);
        const locale = require('../locales/id');
        const user = db.getUser(order.user_id);
        const username = user?.username ? `@${user.username}` : '-';
        const userDisplay = `${username} (<code>${order.user_id}</code>)`;

        const checkoutTime = order.created_at
            ? new Date(order.created_at).toLocaleString('id-ID', {
                timeZone: 'Asia/Jakarta',
                day: '2-digit', month: '2-digit', year: 'numeric',
                hour: '2-digit', minute: '2-digit', second: '2-digit'
            }) + ' WIB'
            : '-';

        // Build updated message with completed status
        const updatedMessage = replacePlaceholders(locale.admin_notif_new_order, {
            order_id: orderId,
            user_display: userDisplay,
            product: product.name_id,
            quantity: order.quantity,
            amount: formatIDR(order.total_idr),
            checkout_time: checkoutTime,
            method: order.payment_method?.toUpperCase() || '-'
        }).replace(/\(⏱.*?Menunggu Pembayaran.*?\)/, '(<i>✅ Completed</i>)');

        for (const { chatId, messageId } of messages) {
            try {
                await telegram.editMessageText(chatId, messageId, undefined, updatedMessage, {
                    parse_mode: 'HTML'
                });
            } catch (e) {
                console.error(`Failed to update ORDER MASUK for admin ${chatId}:`, e.message);
            }
        }
    } catch (error) {
        console.error('Update ORDER MASUK error:', error);
    }

    // Cleanup
    adminNotifMessages.delete(orderId);
};

module.exports = { registerOrderHandler, updateOrderMasukCompleted, buildQrisInvoiceMessage };
