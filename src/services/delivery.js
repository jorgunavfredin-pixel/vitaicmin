const db = require('../models/db');
const { formatIDR, formatUSD, formatDateWIB, formatStockForUser, formatStockForFile, replacePlaceholders, notifyAdmins, escapeHtml, safeHtmlSnk } = require('../utils/helpers');
const { convertIDRtoUSD } = require('../payments/exchange');
const log = require('../utils/logger');

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

        // Format account data for display
        const accountsFormatted = stockToDeliver.map((stock, index) => {
            const formatted = formatStockForUser(product.stock_type, stock.data, lang);
            return `\n━━━ ${lang === 'en' ? 'Account' : 'Akun'} ${index + 1} ━━━\n${formatted}`;
        }).join('\n');

        // Get warranty/terms text (admin stores S&K in terms_id/terms_en)
        const warranty = lang === 'en'
            ? (product.warranty_en || product.terms_en)
            : (product.warranty_id || product.terms_id);
        const productName = lang === 'en' ? product.name_en : product.name_id;
        const warrantyHtml = safeHtmlSnk(warranty, product.terms_format === 'html');

        const FILE_THRESHOLD = 20;

        if (order.quantity > FILE_THRESHOLD) {
            // === LARGE ORDER: send accounts as .txt file ===
            const fs = require('fs');
            const path = require('path');

            const txtContent = stockToDeliver.map((stock, index) => {
                const formatted = formatStockForFile(product.stock_type, stock.data);
                return `━━━ ${lang === 'en' ? 'Account' : 'Akun'} ${index + 1} ━━━\n${formatted}`;
            }).join('\n\n');

            const tmpDir = path.join(__dirname, '../../tmp');
            if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
            const filePath = path.join(tmpDir, `${orderId}.txt`);
            fs.writeFileSync(filePath, txtContent, 'utf8');

            const locale_msg = replacePlaceholders(locale.delivery_message_file, {
                order_id: orderId,
                product: productName,
                quantity: order.quantity,
                warranty: warrantyHtml
            });

            await bot.telegram.sendMessage(order.user_id, locale_msg || `🎉 <b>ORDER DELIVERED</b>\n\n<b>Order ID:</b> <code>${orderId}</code>\n<b>Produk:</b> ${escapeHtml(productName)}\n<b>Jumlah:</b> ${order.quantity} pcs\n\n📎 Data akun dikirim dalam file di bawah 👇\n\n📜 <b>Garansi/S&amp;K:</b>\n${warrantyHtml}`, { parse_mode: 'HTML' });

            await bot.telegram.sendDocument(order.user_id, {
                source: filePath,
                filename: `${orderId}.txt`
            });

            try { fs.unlinkSync(filePath); } catch (e) { }
        } else {
            // === NORMAL ORDER: send in message ===
            const message = replacePlaceholders(locale.delivery_message, {
                order_id: orderId,
                product: productName,
                quantity: order.quantity,
                accounts: accountsFormatted,
                warranty: warranty || '-'
            });

            await bot.telegram.sendMessage(order.user_id, message, { parse_mode: 'HTML' });
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

        // Format account data for display
        const accountsFormatted = stockToDeliver.map((stock, index) => {
            const formatted = formatStockForUser(product.stock_type, stock.data, lang);
            return `\n━━━ ${lang === 'en' ? 'Account' : 'Akun'} ${index + 1} ━━━\n${formatted}`;
        }).join('\n');

        // Get warranty/terms text (admin stores S&K in terms_id/terms_en)
        const warranty = lang === 'en'
            ? (product.warranty_en || product.terms_en)
            : (product.warranty_id || product.terms_id);
        const productName = lang === 'en' ? product.name_en : product.name_id;

        // S&K: safely handle both old plain text and new HTML format
        const warrantyHtml = safeHtmlSnk(warranty, product.terms_format === 'html');

        const FILE_THRESHOLD = 20;

        // Telegram receipt prevents duplicate credential delivery after a crash/retry.
        if (!order.delivery_message_id && order.quantity > FILE_THRESHOLD) {
            // === LARGE ORDER: send accounts as .txt file ===
            const fs = require('fs');
            const path = require('path');

            // Build .txt content (accounts only)
            const txtContent = stockToDeliver.map((stock, index) => {
                const formatted = formatStockForFile(product.stock_type, stock.data);
                return `━━━ ${lang === 'en' ? 'Account' : 'Akun'} ${index + 1} ━━━\n${formatted}`;
            }).join('\n\n');

            // Write temp file
            const tmpDir = path.join(__dirname, '../../tmp');
            if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
            const filePath = path.join(tmpDir, `${orderId}.txt`);
            fs.writeFileSync(filePath, txtContent, 'utf8');

            // Send chat message (order info + S&K, without accounts)
            const title = lang === 'en' ? '🎉 <b>PAYMENT SUCCESSFUL</b>' : '🎉 <b>PEMBAYARAN BERHASIL</b>';
            const l = lang === 'en' ? {
                orderId: 'Order ID', prod: 'Product', qty: 'Quantity',
                fileNote: '📎 Account data sent in the file below 👇',
                warranty: 'Warranty/Terms', thanks: 'Thank you for your purchase!'
            } : {
                orderId: 'Order ID', prod: 'Produk', qty: 'Jumlah',
                fileNote: '📎 Data akun dikirim dalam file di bawah 👇',
                warranty: 'Garansi/S&amp;K', thanks: 'Terima kasih atas pembeliannya!'
            };

            const chatMessage = `${title}
┏━━━━━━━━━━━━━━━━
┣ <b>${l.orderId}:</b> <code>${orderId}</code>
┣ <b>${l.prod}:</b> ${escapeHtml(productName)}
┗ <b>${l.qty}:</b> ${order.quantity} pcs

${l.fileNote}

📜 <b>${l.warranty}:</b>
${warrantyHtml}

🙏 ${l.thanks}`;

            await bot.telegram.sendMessage(order.chat_id || order.user_id, chatMessage, { parse_mode: 'HTML', message_effect_id: '5046509860389126442' });

            // Send .txt file and persist Telegram receipt before final DB settlement.
            const sentDocument = await bot.telegram.sendDocument(order.chat_id || order.user_id, {
                source: filePath,
                filename: `${orderId}.txt`
            });
            db.updateOrder(orderId, { delivery_message_id: sentDocument.message_id });

            // Cleanup temp file
            try { fs.unlinkSync(filePath); } catch (e) { }

        } else if (!order.delivery_message_id) {
            // === NORMAL ORDER: send accounts in message ===
            const title = lang === 'en' ? '🎉 <b>PAYMENT SUCCESSFUL</b>' : '🎉 <b>PEMBAYARAN BERHASIL</b>';
            const l = lang === 'en' ? {
                orderId: 'Order ID', prod: 'Product', qty: 'Quantity',
                accounts: 'YOUR ACCOUNT(S)', warranty: 'Warranty/Terms',
                thanks: 'Thank you for your purchase!'
            } : {
                orderId: 'Order ID', prod: 'Produk', qty: 'Jumlah',
                accounts: 'AKUN KAMU', warranty: 'Garansi/S&amp;K',
                thanks: 'Terima kasih atas pembeliannya!'
            };

            const combinedMessage = `${title}
┏━━━━━━━━━━━━━━━━
┣ <b>${l.orderId}:</b> <code>${orderId}</code>
┣ <b>${l.prod}:</b> ${escapeHtml(productName)}
┗ <b>${l.qty}:</b> ${order.quantity} pcs

📋 <b>${l.accounts}:</b>
${accountsFormatted}

📜 <b>${l.warranty}:</b>
${warrantyHtml}

🙏 ${l.thanks}`;

            const sentDelivery = await bot.telegram.sendMessage(order.chat_id || order.user_id, combinedMessage, { parse_mode: 'HTML', message_effect_id: '5046509860389126442' });
            db.updateOrder(orderId, { delivery_message_id: sentDelivery.message_id });
        }

        const settled = db.completeProductOrder(
            orderId,
            stockIds,
            stockToDeliver.map(s => s.data),
            paymentData.txHash || paymentData.transaction_id || null
        );
        if (!settled) throw new Error('PRODUCT_SETTLEMENT_FAILED');

        // Record voucher redemption only after Telegram delivery + DB settlement.
        if (order.voucher_code) db.redeemVoucher(order.voucher_code, order.user_id, orderId);

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
    deliverOrder,
    handlePaymentSuccess,
    notifyAdminDelivery,
    notifyAdminPayment,
    notifyAdminPaymentComplete
};
