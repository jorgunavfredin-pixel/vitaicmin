const db = require('../models/db');
const { formatIDR, formatUSD, replacePlaceholders, buildPaymentConfirmation, notifyAdmins } = require('../utils/helpers');
const { convertIDRtoUSD } = require('../payments/exchange');
const { getExpirationTime } = require('../services/invoice');
const { createQRISPayment } = require('../payments/qris');
const { getBalance, deductBalance } = require('../payments/balance');
const { handlePaymentSuccess } = require('../services/delivery');
const { cancelOrder } = require('../services/reminder');
const {
    paymentMethodKeyboard,
    paymentPendingKeyboard,
    mainMenuKeyboard
} = require('../utils/keyboard');

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
        if (!product) {
            await ctx.answerCbQuery(locale.error_general);
            return;
        }

        const stockCount = db.getAvailableStockCount(productId);
        if (stockCount < quantity) {
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
            expires_at: getExpirationTime('qris').toISOString() // Default, will update based on method
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

        const order = db.getOrderById(orderId);
        if (!order) {
            await ctx.answerCbQuery(locale.error_order_not_found);
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

    // QRIS payment selected
    bot.action(/^pay_qris_(.+)$/, async (ctx) => {
        const orderId = ctx.match[1];
        const userId = ctx.from.id.toString();
        const lang = db.getUserLanguage(userId);
        const locale = require(`../locales/${lang}`);

        // Check if QRIS is enabled
        const settings = db.getSettings();
        if (!settings.qris_enabled) {
            await ctx.answerCbQuery(lang === 'en' ? '⚠️ QRIS is under maintenance.' : '⚠️ QRIS sedang maintenance.', { show_alert: true });
            return;
        }

        const order = db.getOrderById(orderId);
        // Accept both 'init' (from confirmation) and 'pending' for compatibility
        if (!order || (order.status !== 'init' && order.status !== 'pending')) {
            await ctx.answerCbQuery(locale.error_order_not_found);
            return;
        }

        await ctx.answerCbQuery('Creating QRIS...');

        // Update order: set status to pending, add payment method and expiry
        const expiresAt = getExpirationTime('qris');
        db.updateOrder(orderId, {
            status: 'pending', // Now committed - expiry counts
            payment_method: 'qris',
            expires_at: expiresAt.toISOString()
        });

        // Reserve stock for this order (prevent race condition)
        const prodForReserve = db.getProductById(order.product_id);
        if (prodForReserve && prodForReserve.stock_mode !== 'unlimited') {
            const reserved = db.reserveStock(order.product_id, order.quantity, orderId);
            if (!reserved) {
                db.updateOrder(orderId, { status: 'cancelled' });
                try { await ctx.deleteMessage(); } catch (e) { }
                const errMsg = lang === 'en'
                    ? '❌ Sorry, stock just ran out. Another buyer was faster.'
                    : '❌ Maaf, stok baru saja habis. Pembeli lain lebih cepat.';
                await ctx.reply(errMsg, { ...mainMenuKeyboard(lang, userId) });
                return;
            }
        }

        // Create QRIS payment via PaKasir
        const qrisResult = await createQRISPayment(orderId, order.total_idr);

        if (!qrisResult.success) {
            console.error('[ORDER] QRIS creation failed:', qrisResult.error);
            try { await ctx.deleteMessage(); } catch (e) { }
            const errMsg = lang === 'en'
                ? '❌ Failed to create QRIS payment. Please try again.'
                : '❌ Gagal membuat pembayaran QRIS. Silakan coba lagi.';
            await ctx.reply(errMsg);
            return;
        }

        // Generate QR image URL from QR string
        const { generateQRImageUrl, checkQRISStatus, cancelQRISPayment } = require('../payments/qris');
        const { generateQRISTwibbon } = require('../utils/qris_twibbon');
        const qrImageUrl = generateQRImageUrl(qrisResult.data.qris_string);

        const productName = lang === 'en' ? order.name_en : order.name_id; // Need to fetch product name if not in order object
        // Fetch product name again to be sure
        const product = db.getProductById(order.product_id);
        const prodName = lang === 'en' ? product.name_en : product.name_id;

        const title = lang === 'en' ? '🧾 *ORDER INVOICE*' : '🧾 *INVOICE PESANAN*';
        const l = lang === 'en' ? {
            orderId: 'Order ID',
            prod: 'Product',
            qty: 'Quantity',
            total: 'TOTAL PAYMENT',
            status: 'Status   : Waiting for QRIS payment',
            valid: 'Valid for'
        } : {
            orderId: 'Order ID',
            prod: 'Produk',
            qty: 'Jumlah',
            total: 'TOTAL BAYAR',
            status: 'Status   : Menunggu pembayaran QRIS',
            valid: 'Berlaku'
        };
        // Format total in user's currency
        const totalAmount = qrisResult.data.total_payment || order.total_idr;
        const totalDisplay = lang === 'en'
            ? `$${formatUSD(order.total_usd || totalAmount / 16000)}`
            : `Rp ${formatIDR(totalAmount)}`;

        const message = `${title}

🆔 *${l.orderId}:* \`${orderId}\`
• *${l.prod}:* ${prodName}
• *${l.qty}:* ${order.quantity} pcs
• *${l.total}:* ${totalDisplay}

⏱ *${l.status}*
⏰ *${l.valid} :* 15 ${lang === 'en' ? 'minutes' : 'menit'}`;

        // Send QRIS image with twibbon template
        try {
            await ctx.deleteMessage();
        } catch (e) { }

        let sentMsg;
        try {
            // Generate twibbon composited image
            const twibbonBuffer = await generateQRISTwibbon(qrImageUrl);
            sentMsg = await ctx.replyWithPhoto({ source: twibbonBuffer }, {
                caption: message,
                parse_mode: 'Markdown',
                ...paymentPendingKeyboard(orderId, lang)
            });
        } catch (e) {
            // Fallback to plain QR if compositing fails
            console.error('[QRIS] Twibbon failed, using plain QR:', e.message);
            sentMsg = await ctx.replyWithPhoto(qrImageUrl, {
                caption: message,
                parse_mode: 'Markdown',
                ...paymentPendingKeyboard(orderId, lang)
            });
        }

        // Store message ID for later editing
        db.updateOrder(orderId, {
            message_id: sentMsg.message_id,
            pakasir_data: qrisResult.data
        });

        // Notify admin
        await notifyAdminNewOrder(ctx.telegram, orderId, order, 'QRIS');
    });

    // Check Payment Status Manually
    bot.action(/^pay_check_(.+)$/, async (ctx) => {
        const orderId = ctx.match[1];

        await ctx.answerCbQuery('Checking status...');

        const order = db.getOrderById(orderId);
        if (!order) return;

        if (order.payment_method === 'qris') {
            // QRIS payment
            const { checkQRISStatus } = require('../payments/qris');
            const result = await checkQRISStatus(orderId, order.total_idr);

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
        const lang = db.getUserLanguage(ctx.from.id.toString());
        await ctx.answerCbQuery();

        const order = db.getOrderById(orderId);
        if (!order) {
            await ctx.deleteMessage();
            return;
        }

        // If order is still in 'init' stage (at confirmation), delete it entirely
        if (order.status === 'init') {
            db.deleteOrder(orderId); // Completely remove from DB
        } else {
            // If already pending (payment method selected), release reserved stock + cancel
            db.releaseReservedStock(orderId);
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

        // Check if Saldo is enabled
        const settings = db.getSettings();
        if (settings.saldo_enabled === false) {
            await ctx.answerCbQuery(lang === 'en' ? '⚠️ Balance payment is under maintenance.' : '⚠️ Pembayaran saldo sedang maintenance.', { show_alert: true });
            return;
        }

        const order = db.getOrderById(orderId);
        if (!order || (order.status !== 'init' && order.status !== 'pending')) {
            await ctx.answerCbQuery(locale.error_order_not_found);
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

        await ctx.answerCbQuery(lang === 'en' ? '💰 Processing...' : '💰 Memproses...');

        // Check stock availability one more time before instant payment
        const product = db.getProductById(order.product_id);
        if (product && product.stock_mode !== 'unlimited') {
            const stockCount = db.getAvailableStockCount(order.product_id);
            if (stockCount < order.quantity) {
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

    // Helper: delay function
    const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    // User clicks "Pakai Voucher" button
    bot.action(/^voucher_apply_(.+)$/, async (ctx) => {
        const orderId = ctx.match[1];
        const userId = ctx.from.id.toString();
        const lang = db.getUserLanguage(userId);

        const order = db.getOrderById(orderId);
        if (!order || order.user_id !== userId) {
            await ctx.answerCbQuery('❌ Order not found');
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

        // Set voucher input state
        voucherStates.set(userId, orderId);

        const prompt = lang === 'en'
            ? '🎟️ *Apply Voucher*\n\nType your voucher code below:'
            : '🎟️ *Pakai Voucher*\n\nKetik kode voucher kamu di bawah:';

        try { await ctx.deleteMessage(); } catch (e) { }
        await ctx.reply(prompt, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [[{ text: lang === 'en' ? '❌ Cancel' : '❌ Batal', callback_data: `voucher_cancel_${orderId}` }]]
            }
        });
    });

    // Cancel voucher input
    bot.action(/^voucher_cancel_(.+)$/, async (ctx) => {
        const orderId = ctx.match[1];
        const userId = ctx.from.id.toString();
        const lang = db.getUserLanguage(userId);

        voucherStates.delete(userId);
        await ctx.answerCbQuery();

        const order = db.getOrderById(orderId);
        if (!order) return;

        const confirmMsg = await buildPaymentConfirmation(order, lang, db, convertIDRtoUSD);

        try { await ctx.deleteMessage(); } catch (e) { }
        await ctx.reply(confirmMsg, {
            parse_mode: 'HTML',
            ...paymentMethodKeyboard(orderId, lang)
        });
    });

    // Text handler for voucher code input
    bot.on('text', async (ctx, next) => {
        const userId = ctx.from.id.toString();
        const orderId = voucherStates.get(userId);

        if (!orderId) return next();

        const lang = db.getUserLanguage(userId);
        const code = ctx.message.text.trim().toUpperCase();

        // Clear state
        voucherStates.delete(userId);

        // Validate voucher
        const voucher = db.getVoucherByCode(code);

        if (!voucher || voucher.used) {
            // FAIL: show error, wait 3s, replace with original form
            const errorMsg = !voucher
                ? (lang === 'en' ? '❌ Voucher code not found.' : '❌ Kode voucher tidak ditemukan.')
                : (lang === 'en' ? '❌ This voucher has already been used.' : '❌ Voucher ini sudah digunakan.');

            const sentMsg = await ctx.reply(errorMsg);

            await delay(2000);

            try { await ctx.telegram.deleteMessage(ctx.chat.id, sentMsg.message_id); } catch (e) { }

            const order = db.getOrderById(orderId);
            const confirmMsg = await buildPaymentConfirmation(order, lang, db, convertIDRtoUSD);
            await ctx.reply(confirmMsg, {
                parse_mode: 'HTML',
                ...paymentMethodKeyboard(orderId, lang)
            });
            return;
        }

        // SUCCESS: Apply voucher!
        const order = db.getOrderById(orderId);

        const discountAmount = db.calculateDiscount(order.total_idr, voucher);
        const finalPrice = order.total_idr - discountAmount;
        const finalUSD = await convertIDRtoUSD(finalPrice);

        // Mark voucher as used
        db.useVoucher(code, userId);

        // Update order with voucher info
        db.updateOrder(orderId, {
            voucher_code: code,
            discount_amount: discountAmount,
            total_idr: finalPrice,
            total_usd: parseFloat(finalUSD.toFixed(2)),
            original_total_idr: order.total_idr,
            original_total_usd: order.total_usd
        });

        // Show success message
        const successText = lang === 'en' ? '✅ Voucher Applied!' : '✅ Voucher Berhasil!';
        const sentMsg = await ctx.reply(successText);

        // Wait 3 seconds
        await delay(2000);

        // Delete success message
        try { await ctx.telegram.deleteMessage(ctx.chat.id, sentMsg.message_id); } catch (e) { }

        // Build discount description for the voucher display
        let discountDesc;
        if (voucher.type === 'percent') {
            discountDesc = lang === 'en' ? `${voucher.value}% OFF` : `Diskon ${voucher.value}%`;
        } else {
            if (lang === 'en') {
                const discountUSD = await convertIDRtoUSD(discountAmount);
                discountDesc = `-$${formatUSD(discountUSD)}`;
            } else {
                discountDesc = `-Rp ${formatIDR(discountAmount)}`;
            }
        }

        // Replace with full payment form including voucher details
        const updatedOrder = db.getOrderById(orderId);
        const confirmMsg = await buildPaymentConfirmation(updatedOrder, lang, db, convertIDRtoUSD, {
            code: code,
            discountDesc: discountDesc
        });
        await ctx.reply(confirmMsg, {
            parse_mode: 'HTML',
            ...paymentMethodKeyboard(orderId, lang)
        });
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

module.exports = { registerOrderHandler, updateOrderMasukCompleted };
