const db = require('../models/db');
const { formatIDR, formatUSD, formatDateWIB, formatStockForUser, formatStockForFile, replacePlaceholders, notifyAdmins, escapeHtml, safeHtmlSnk } = require('../utils/helpers');
const { convertIDRtoUSD } = require('../payments/exchange');
const log = require('../utils/logger');

const getDeliveryProductName = (product, lang) => lang === 'en'
    ? (product.name_en || product.name_id || '-')
    : (product.name_id || product.name_en || '-');

const buildTermsMessage = (product, lang = 'id') => {
    const raw = lang === 'en'
        ? (product.warranty_en || product.terms_en || '')
        : (product.warranty_id || product.terms_id || '');
    if (!String(raw).trim()) return '';
    const content = safeHtmlSnk(raw, product.terms_format === 'html');
    const title = lang === 'en' ? 'Warranty/Terms' : 'Garansi/SnK';
    return `<b>≡ ${title}:</b>\n\n${content}`;
};

const buildDeliveryFile = (product, stocks) => stocks
    .map(stock => formatStockForFile(product.stock_type, stock.data))
    .join('\n\n');

const buildDeliveryReceipt = (order, product, stocks, lang = 'id', fileMode = false) => {
    const en = lang === 'en';
    const title = en ? '🎉 Payment Successful' : '🎉 Pembayaran Berhasil';
    const productName = escapeHtml(getDeliveryProductName(product, lang));
    const labels = en
        ? { product: 'Product', qty: 'Quantity', data: '≡ Account Data ━━━', thanks: 'Thank you for your purchase!', file: 'Account data is sent via TXT file.' }
        : { product: 'Produk', qty: 'Jumlah', data: '≡ Data Akun ━━━', thanks: 'Terima kasih atas pembeliannya!', file: 'Data akun dikirim melalui file TXT.' };
    let message = `<blockquote><b>${title}</b></blockquote>\n`;
    message += `┊ <b>Order ID:</b> <code>${escapeHtml(order.id)}</code>\n`;
    message += `┊ <b>${labels.product}:</b> <b>${productName}</b>\n`;
    message += `┊ <b>${labels.qty}:</b> ${order.quantity} pcs\n\n`;
    if (fileMode) return `${message}${labels.file}`;
    const accounts = stocks.map(stock => formatStockForUser(product.stock_type, stock.data, lang)).join('\n\n');
    return `${message}<b>${labels.data}</b>\n${accounts}\n━━━━━━━━━━━━━━━\n${labels.thanks}`;
};

/**
 * Deliver order to user
 * @param {Object} bot - Telegraf bot instance
 * @param {string} orderId - Order ID
 * @returns {Promise<boolean>} - Success status
 */
const deliverOrder = async (bot, orderId) => {
    try {
        const order = db.getOrderById(orderId);
        if (!order) {
            log.error(`Order ${orderId} not found`);
            return false;
        }

        if (order.status !== 'paid') {
            log.error(`Order ${orderId} is not paid, status: ${order.status}`);
            return false;
        }

        const product = db.getProductById(order.product_id);
        if (!product) {
            log.error(`Product ${order.product_id} not found`);
            return false;
        }

        // Get stock — prefer reserved for this order, fallback to available
        let stockToDeliver;
        const reservedStock = db.getReservedStock(orderId);
        if (reservedStock.length >= order.quantity) {
            stockToDeliver = reservedStock.slice(0, order.quantity);
        } else {
            // Fallback: unlimited mode or legacy orders without reservation.
            // Use unreserved stock only, so a saldo order never grabs another order's reserved items.
            const availableStock = db.getUnsoldUnreservedStock(order.product_id);
            if (availableStock.length < order.quantity) {
                log.error(`Not enough stock for order ${orderId}`);
                await notifyAdminStockIssue(bot, orderId, product, order.quantity, availableStock.length);
                return false;
            }
            stockToDeliver = availableStock.slice(0, order.quantity);
        }
        const stockIds = stockToDeliver.map(s => s.id);

        // Mark stock as sold
        db.markStockAsSold(stockIds, order.user_id, orderId);

        // Low stock alert — notify admin if remaining stock < 3
        const remainingStock = db.getStockByProduct(order.product_id).length;
        if (remainingStock < 3) {
            try {
                const icon = remainingStock === 0 ? '🔴' : '🟡';
                await notifyAdmins(bot.telegram,
                    `${icon} *LOW STOCK ALERT*\n\n📦 ${product.name_id}\n📊 Sisa stok: *${remainingStock}*\n\n${remainingStock === 0 ? '⛔ STOK HABIS!' : '⚠️ Segera restock!'}`,
                    { parse_mode: 'Markdown' }
                );
            } catch (e) { /* ignore */ }
        }

        // Get user language
        const lang = db.getUserLanguage(order.user_id);
        const locale = require(`../locales/${lang}`);

        const FILE_THRESHOLD = 20;
        const destination = order.chat_id || order.user_id;
        const termsMessage = buildTermsMessage(product, lang);

        if (order.quantity > FILE_THRESHOLD) {
            const fs = require('fs');
            const path = require('path');
            const txtContent = buildDeliveryFile(product, stockToDeliver, lang);
            const tmpDir = path.join(__dirname, '../../tmp');
            if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
            const filePath = path.join(tmpDir, `${orderId}.txt`);
            fs.writeFileSync(filePath, txtContent, 'utf8');
            try {
                await bot.telegram.sendMessage(destination, buildDeliveryReceipt(order, product, stockToDeliver, lang, true), { parse_mode: 'HTML' });
                if (termsMessage) await bot.telegram.sendMessage(destination, termsMessage, { parse_mode: 'HTML' });
                await bot.telegram.sendDocument(destination, { source: filePath, filename: `${orderId}.txt` });
            } finally {
                try { fs.unlinkSync(filePath); } catch (_) { }
            }
        } else {
            await bot.telegram.sendMessage(destination, buildDeliveryReceipt(order, product, stockToDeliver, lang, false), { parse_mode: 'HTML' });
            if (termsMessage) await bot.telegram.sendMessage(destination, termsMessage, { parse_mode: 'HTML' });
        }

        // Update order status
        db.updateOrder(orderId, {
            status: 'delivered',
            stock_ids: stockIds,
            delivered_data: stockToDeliver.map(s => s.data),
            delivered_at: new Date().toISOString()
        });

        // Notify admin
        await notifyAdminDelivery(bot, orderId, order, product, stockToDeliver);

        log.info(`Order ${orderId} delivered successfully`);
        return true;
    } catch (error) {
        log.error(`Delivery error for order ${orderId}:`, error);
        return false;
    }
};

/**
 * Notify admin about successful delivery
 */
const notifyAdminDelivery = async (bot, orderId, order, product, stockDelivered) => {
    try {
        const locale = require('../locales/id');

        const accountsInfo = stockDelivered.map((s, i) => `${i + 1}. ${s.data}`).join('\n');

        const message = replacePlaceholders(locale.admin_notif_delivered, {
            order_id: orderId,
            user_id: order.user_id,
            product: product.name_id,
            accounts: accountsInfo
        });

        await notifyAdmins(bot.telegram, message, { parse_mode: 'Markdown' });
    } catch (error) {
        log.error('Admin notification error:', error);
    }
};

/**
 * Notify admin about stock issue
 */
const notifyAdminStockIssue = async (bot, orderId, product, required, available) => {
    try {
        const message = `⚠️ *Stok Tidak Cukup!*

📦 Order: \`${orderId}\`
🛍️ Produk: ${product.name_id}
❌ Dibutuhkan: ${required}
📦 Tersedia: ${available}

Segera tambahkan stok untuk menyelesaikan order ini.`;

        await notifyAdmins(bot.telegram, message, { parse_mode: 'Markdown' });
    } catch (error) {
        log.error('Admin stock notification error:', error);
    }
};

/**
 * Handle payment success and trigger delivery
 * @param {Object} bot - Telegraf bot instance
 * @param {string} orderId - Order ID
 * @param {Object} paymentData - Payment data (optional, for logging)
 */
const handlePaymentSuccess = async (bot, orderId, paymentData = {}) => {
    let claimed = false;
    try {
        // Webhook, polling, dan manual check bisa datang bersamaan. Hanya satu menang.
        claimed = db.claimOrderForDelivery(orderId);
        if (!claimed) return false;
        const order = db.getOrderById(orderId);
        if (!order) {
            db.releaseOrderDeliveryClaim(orderId);
            return false;
        }

        // ==================== TOPUP SALDO ====================
        if (order.product_id === 'TOPUP') {
            const { getBalance } = require('../payments/balance');
            const userId = order.user_id;
            const lang = db.getUserLanguage(userId);

            // Credit saldo + history + delivered atomically; safe across races/restarts.
            if (!db.completeTopupOrder(orderId)) return false;

            // Delete QRIS invoice message
            if (order.message_id && order.chat_id) {
                try {
                    await bot.telegram.deleteMessage(order.chat_id, order.message_id);
                } catch (e) { }
            }

            // Notify user
            const balance = getBalance(userId);
            const balanceDisplay = lang === 'en'
                ? `$${formatUSD(await convertIDRtoUSD(balance))}`
                : `Rp ${formatIDR(balance)}`;
            const topupAmtDisplay = lang === 'en'
                ? `$${formatUSD(await convertIDRtoUSD(order.total_idr))}`
                : `Rp ${formatIDR(order.total_idr)}`;

            const successMsg = lang === 'en'
                ? `✅ *Top Up Successful!*\n\n💰 +${topupAmtDisplay}\n💵 New balance: ${balanceDisplay}`
                : `✅ *Topup Berhasil!*\n\n💰 +${topupAmtDisplay}\n💵 Saldo baru: ${balanceDisplay}`;

            await bot.telegram.sendMessage(order.chat_id || userId, successMsg, { parse_mode: 'Markdown' });

            // Notify admin
            try {
                await notifyAdmins(bot.telegram,
                    `💰 *TOPUP SALDO*\n\n👤 User: \`${userId}\`\n💵 Amount: Rp ${formatIDR(order.total_idr)}\n📦 ID: \`${orderId}\``,
                    { parse_mode: 'Markdown' }
                );
            } catch (e) { }

            log.info(`Order ${orderId} topup saldo success`);
            return true;
        }

        const product = db.getProductById(order.product_id);
        if (!product) {
            log.error(`Product ${order.product_id} not found`);
            db.releaseOrderDeliveryClaim(orderId);
            return false;
        }

        // Get stock — prefer reserved for this order, fallback to available
        let stockToDeliver;
        const reservedStock = db.getReservedStock(orderId);
        if (reservedStock.length >= order.quantity) {
            stockToDeliver = reservedStock.slice(0, order.quantity);
        } else {
            // Fallback: unlimited mode or legacy orders without reservation.
            // Use unreserved stock only, so a saldo order never grabs another order's reserved items.
            const availableStock = db.getUnsoldUnreservedStock(order.product_id);
            if (availableStock.length < order.quantity && product.stock_mode !== 'unlimited') {
                log.error(`Not enough stock for order ${orderId}`);
                await notifyAdminStockIssue(bot, orderId, product, order.quantity, availableStock.length);
                db.releaseOrderDeliveryClaim(orderId);
                return false;
            }
            if (product.stock_mode !== 'unlimited') {
                const reserved = db.reserveStock(order.product_id, order.quantity, orderId);
                if (!reserved) {
                    db.releaseOrderDeliveryClaim(orderId);
                    return false;
                }
                stockToDeliver = db.getReservedStock(orderId).slice(0, order.quantity);
            } else {
                stockToDeliver = availableStock.slice(0, order.quantity);
            }
        }
        const stockIds = stockToDeliver.map(s => s.id);

        // Get user language
        const lang = db.getUserLanguage(order.user_id);

        // Delete old QRIS message if exists
        if (order.message_id && order.chat_id) {
            try {
                await bot.telegram.deleteMessage(order.chat_id, order.message_id);
            } catch (e) {
                log.info('Could not delete QRIS message:', e.message);
            }
        }

        const FILE_THRESHOLD = 20;
        const destination = order.chat_id || order.user_id;
        const termsMessage = buildTermsMessage(product, lang);

        // Telegram receipt prevents duplicate credential delivery after a completed send.
        if (!order.delivery_message_id && order.quantity > FILE_THRESHOLD) {
            const fs = require('fs');
            const path = require('path');
            const txtContent = buildDeliveryFile(product, stockToDeliver, lang);
            const tmpDir = path.join(__dirname, '../../tmp');
            if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
            const filePath = path.join(tmpDir, `${orderId}.txt`);
            fs.writeFileSync(filePath, txtContent, 'utf8');
            try {
                const receipt = buildDeliveryReceipt(order, product, stockToDeliver, lang, true);
                const sentReceipt = await bot.telegram.sendMessage(destination, receipt, { parse_mode: 'HTML', message_effect_id: '5046509860389126442' });
                if (termsMessage) await bot.telegram.sendMessage(destination, termsMessage, { parse_mode: 'HTML' });
                await bot.telegram.sendDocument(destination, { source: filePath, filename: `${orderId}.txt` });
                db.updateOrder(orderId, { delivery_message_id: sentReceipt.message_id });
            } finally {
                try { fs.unlinkSync(filePath); } catch (_) { }
            }
        } else if (!order.delivery_message_id) {
            const receipt = buildDeliveryReceipt(order, product, stockToDeliver, lang, false);
            const sentDelivery = await bot.telegram.sendMessage(destination, receipt, { parse_mode: 'HTML', message_effect_id: '5046509860389126442' });
            if (termsMessage) await bot.telegram.sendMessage(destination, termsMessage, { parse_mode: 'HTML' });
            db.updateOrder(orderId, { delivery_message_id: sentDelivery.message_id });
        }

        const settled = db.completeProductOrder(
            orderId,
            stockIds,
            stockToDeliver.map(s => s.data),
            paymentData.txHash || paymentData.transaction_id || null
        );
        if (!settled) throw new Error('PRODUCT_SETTLEMENT_FAILED');

        // Voucher hold → redemption is committed inside completeProductOrder().

        // Update ORDER MASUK status to ✅ Completed
        const { updateOrderMasukCompleted } = require('../handlers/order');
        await updateOrderMasukCompleted(bot.telegram, orderId);

        // Notify admin with compact invoice
        await notifyAdminPaymentComplete(bot, orderId, order, product, stockToDeliver);

        log.info(`[PAYMENT] event=delivered order=${orderId} product=${order.product_id} quantity=${order.quantity}`);
        return true;
    } catch (error) {
        // Jika side effect belum committed sebagai delivered, izinkan retry berikutnya.
        if (claimed) db.releaseOrderDeliveryClaim(orderId);
        log.error(`Payment success handling error for ${orderId}:`, error);
        return false;
    }
};

/**
 * Notify admin about payment received
 */
const notifyAdminPayment = async (bot, orderId, order, product) => {
    try {
        const locale = require('../locales/id');

        const message = replacePlaceholders(locale.admin_notif_paid, {
            order_id: orderId,
            user_id: order.user_id,
            product: product.name_id,
            amount: formatIDR(order.total_idr)
        });

        await notifyAdmins(bot.telegram, message, { parse_mode: 'Markdown' });
    } catch (error) {
        log.error('Admin payment notification error:', error);
    }
};

/**
 * Notify admin about completed order with compact invoice
 */
const notifyAdminPaymentComplete = async (bot, orderId, order, product, stockDelivered) => {
    try {
        const { Markup } = require('telegraf');
        const user = db.getUser(order.user_id);
        const username = user?.username ? `@${escapeHtml(user.username)}` : '-';
        const userDisplay = `${username} (<code>${order.user_id}</code>)`;

        const completedAt = new Date().toLocaleString('id-ID', {
            timeZone: 'Asia/Jakarta',
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit', second: '2-digit'
        }) + ' WIB';

        const maxShow = 20;
        let accountsInfo;
        if (stockDelivered.length > maxShow) {
            accountsInfo = `<i>(${stockDelivered.length} akun dikirim via file .txt)</i>`;
        } else {
            accountsInfo = stockDelivered.map((s, i) => `${i + 1}. <code>${escapeHtml(s.data)}</code>`).join('\n');
        }

        const message = `✅ <b>ORDER SELESAI</b>
<blockquote>🆔 <b>Order ID:</b> <code>${orderId}</code>
👤 <b>User:</b> ${userDisplay}
📦 <b>Produk:</b> ${escapeHtml(product.name_id)}
🔢 <b>Jumlah:</b> ${order.quantity} pcs
💳 <b>Metode:</b> ${order.payment_method?.toUpperCase() || '-'}
⏰ <b>Selesai:</b> ${completedAt}</blockquote>

📋 <b>Akun Terkirim:</b>
${accountsInfo}`;

        const buttons = [
            [
                Markup.button.url('👤 Profil Buyer', `tg://user?id=${order.user_id}`),
                Markup.button.callback('📜 Transaksi', `adm_user_info_${order.user_id}`)
            ]
        ];

        await notifyAdmins(bot.telegram, message, {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: buttons }
        });
    } catch (error) {
        log.error('Admin payment complete notification error:', error);
    }
};

module.exports = {
    buildDeliveryReceipt,
    buildTermsMessage,
    buildDeliveryFile,
    deliverOrder,
    handlePaymentSuccess,
    notifyAdminDelivery,
    notifyAdminPayment,
    notifyAdminPaymentComplete
};
