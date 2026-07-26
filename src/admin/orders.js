/**
 * Admin — Order Management
 * Extracted from panel.js
 */
const { Markup } = require('telegraf');
const fs = require('fs');
const path = require('path');
const db = require('../models/db');
const { formatIDR, formatDateWIB, getWIBToday, escapeMarkdown } = require('../utils/helpers');
const escMd = (t) => t ? escapeMarkdown(String(t)) : '';
const {
    ordersListKeyboard,
    orderDetailKeyboard,
    orderDeleteConfirmKeyboard,
    orderRefundConfirmKeyboard,
    orderReplaceConfirmKeyboard,
    navButtons
} = require('../utils/keyboard');

const ADMIN_IDS = (process.env.ADMIN_ID || '').split(',').map(id => id.trim()).filter(Boolean);

function registerOrderHandlers(bot, { isAdmin, adminStates }) {

    const ORDERS_PER_PAGE = 5;

    const showOrderList = async (ctx, filter = 'all', page = 1) => {
        let allOrders = db.getOrders().reverse();

        const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
        allOrders = allOrders.filter(o => new Date(o.created_at).getTime() > sevenDaysAgo);

        if (filter !== 'all') {
            const statusMap = { pending: 'pending', done: 'delivered', expired: 'expired', cancelled: 'cancelled' };
            allOrders = allOrders.filter(o => o.status === (statusMap[filter] || filter));
        }

        const totalPages = Math.max(1, Math.ceil(allOrders.length / ORDERS_PER_PAGE));
        page = Math.min(page, totalPages);
        const start = (page - 1) * ORDERS_PER_PAGE;
        const pageOrders = allOrders.slice(start, start + ORDERS_PER_PAGE);

        const enriched = pageOrders.map(o => {
            if (o.product_id === 'TOPUP') {
                return { ...o, product_name: '💰 Topup Saldo' };
            }
            const prod = db.getProductById(o.product_id);
            return { ...o, product_name: prod?.name_id || '?' };
        });

        if (allOrders.length === 0) {
            await ctx.editMessageText(`📦 Tidak ada order (${filter}).`, {
                parse_mode: 'Markdown',
                ...ordersListKeyboard([], 1, 1, filter)
            });
            return;
        }

        const msg = `🧾 *Orders* (${filter}) — ${allOrders.length} total`;

        await ctx.editMessageText(msg, {
            parse_mode: 'Markdown',
            ...ordersListKeyboard(enriched, page, totalPages, filter)
        });
    };

    // Main orders entry
    bot.action('adm_orders', async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        await ctx.answerCbQuery();
        await showOrderList(ctx, 'all', 1);
    });

    // Filter
    bot.action(/^adm_orders_f_(\w+)_(\d+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        await ctx.answerCbQuery();
        const filter = ctx.match[1];
        const page = parseInt(ctx.match[2]);
        await showOrderList(ctx, filter, page);
    });

    // Pagination
    bot.action(/^adm_orders_p_(\w+)_(\d+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        await ctx.answerCbQuery();
        const filter = ctx.match[1];
        const page = parseInt(ctx.match[2]);
        await showOrderList(ctx, filter, page);
    });

    // Export Orders as CSV
    bot.action('adm_orders_export', async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        await ctx.answerCbQuery('Generating CSV...');

        const orders = db.getOrders();
        if (orders.length === 0) {
            await ctx.reply('❌ Tidak ada order untuk di-export.');
            return;
        }

        const headers = ['ID', 'User ID', 'Username', 'Product', 'Qty', 'Total IDR', 'Total USD', 'Payment', 'Status', 'Created', 'Paid', 'Delivered'];
        const rows = orders.map(o => {
            const user = db.getUser(o.user_id);
            const prodName = o.product_id === 'TOPUP' ? 'Topup Saldo' : (db.getProductById(o.product_id)?.name_id || '-');
            return [
                o.id,
                o.user_id,
                user?.username || '-',
                prodName,
                o.quantity || 1,
                o.total_idr || 0,
                o.total_usd || 0,
                o.payment_method || '-',
                o.status,
                o.created_at ? formatDateWIB(o.created_at) : '-',
                o.paid_at ? formatDateWIB(o.paid_at) : '-',
                o.delivered_at ? formatDateWIB(o.delivered_at) : '-'
            ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',');
        });

        const csv = [headers.join(','), ...rows].join('\n');
        const tmpPath = path.join(__dirname, '..', 'database', `orders_export_${Date.now()}.csv`);
        fs.writeFileSync(tmpPath, csv, 'utf8');

        await ctx.replyWithDocument({ source: tmpPath, filename: `orders_${getWIBToday()}.csv` }, {
            caption: `📥 Export ${orders.length} orders`
        });

        try { fs.unlinkSync(tmpPath); } catch (e) { /* ignore */ }
    });

    // Order Detail View
    bot.action(/^adm_order_view_(.+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        await ctx.answerCbQuery();

        const orderId = ctx.match[1];
        const order = db.getOrderById(orderId);
        if (!order) {
            await ctx.editMessageText('❌ Order tidak ditemukan.', {
                reply_markup: { inline_keyboard: navButtons('adm_orders') }
            });
            return;
        }

        const prod = db.getProductById(order.product_id);
        const user = db.getUser(order.user_id);
        const statusIcon = { pending: '⏳', delivered: '✅', expired: '❌', cancelled: '🚫', refunded: '💸' };

        let msg = `📋 *ORDER DETAIL*\n`;
        msg += `┏━━━━━━━━━━━━━━━━━━\n`;
        msg += `┣ *ID:* \`${order.id}\`\n`;
        msg += `┣ *Status:* ${statusIcon[order.status] || '❓'} ${order.status}\n`;
        msg += `┣ *Created:* ${formatDateWIB(order.created_at)}\n`;
        if (order.paid_at) msg += `┣ *Paid:* ${formatDateWIB(order.paid_at)}\n`;
        if (order.delivered_at) msg += `┣ *Delivered:* ${formatDateWIB(order.delivered_at)}\n`;
        msg += `┃\n`;
        msg += `┣ 👤 *User:* ${escMd(user?.first_name || 'Unknown')} (\`${order.user_id}\`)\n`;
        if (user?.username) msg += `┣ 📎 @${escMd(user.username)}\n`;
        if (order.product_id === 'TOPUP') {
            msg += `┣ 📦 *Product:* 💰 Topup Saldo\n`;
        } else {
            msg += `┣ 📦 *Product:* ${prod?.name_id || '?'}\n`;
            msg += `┣ 📊 *Qty:* ${order.quantity}\n`;
        }
        msg += `┃\n`;
        msg += `┣ 💰 *Total:* Rp ${formatIDR(order.total_idr)} (~$${order.total_usd})\n`;

        if (order.payment_method === 'qris') {
            msg += `┣ 💳 *Payment:* QRIS\n`;
        } else if (order.payment_method === 'saldo') {
            msg += `┣ 💳 *Payment:* Saldo (Balance)\n`;
        } else {
            msg += `┣ 💳 *Payment:* ${order.payment_method || '-'}\n`;
        }

        if (order.delivered_data && order.delivered_data.length > 0) {
            msg += `┃\n┣ 📋 *Delivered Data:*\n`;
            order.delivered_data.forEach((d, i) => {
                msg += `┣ ${i + 1}. \`${d}\`\n`;
            });
        }

        msg += `┗━━━━━━━━━━━━━━━━━━`;

        await ctx.editMessageText(msg, {
            parse_mode: 'Markdown',
            ...orderDetailKeyboard(orderId, order.status)
        });
    });

    // Redeliver
    bot.action(/^adm_order_redeliver_(.+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        await ctx.answerCbQuery();

        const orderId = ctx.match[1];
        const order = db.getOrderById(orderId);
        if (!order || !order.delivered_data || order.delivered_data.length === 0) {
            await ctx.answerCbQuery('❌ Tidak ada data untuk dikirim ulang', { show_alert: true });
            return;
        }

        const prod = db.getProductById(order.product_id);
        const user = db.getUser(order.user_id);
        const lang = user?.language || 'id';
        const prodName = lang === 'en' ? prod?.name_en : prod?.name_id;

        let redeliverMsg = `🔄 *REDELIVER*\n`;
        redeliverMsg += `┏━━━━━━━━━━━━━━━━\n`;
        redeliverMsg += `┣ Order: \`${orderId}\`\n`;
        redeliverMsg += `┣ Product: ${prodName || '?'}\n`;
        redeliverMsg += `┗ Qty: ${order.quantity}\n\n`;
        redeliverMsg += `📋 *YOUR ACCOUNT(S):*\n`;

        order.delivered_data.forEach((d, i) => {
            redeliverMsg += `\n━━━ ${lang === 'en' ? 'Account' : 'Akun'} ${i + 1} ━━━\n`;
            const lines = d.split('|').map(l => l.trim());
            if (prod?.stock_type === 'vcc') {
                redeliverMsg += `💳 Card: \`${lines[0] || '-'}\`\n`;
                if (lines[1]) redeliverMsg += `📅 Expiry: ${lines[1]}\n`;
                if (lines[2]) redeliverMsg += `🔒 CVV: ${lines[2]}\n`;
            } else {
                lines.forEach(l => { redeliverMsg += `\`${l}\`\n`; });
            }
        });

        try {
            await ctx.telegram.sendMessage(order.chat_id, redeliverMsg, { parse_mode: 'Markdown' });
            await ctx.answerCbQuery('✅ Berhasil dikirim ulang ke user!');
        } catch (err) {
            await ctx.answerCbQuery(`❌ Gagal kirim: ${err.message}`, { show_alert: true });
        }
    });

    // Replace Account (Step 1: Confirm)
    bot.action(/^adm_order_replace_(.+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        await ctx.answerCbQuery();

        const orderId = ctx.match[1];
        const order = db.getOrderById(orderId);
        if (!order) return;

        const prod = db.getProductById(order.product_id);
        if (!prod) {
            await ctx.answerCbQuery('❌ Produk tidak ditemukan', { show_alert: true });
            return;
        }

        const availableStock = db.getStockByProduct(order.product_id).filter(s => !s.sold && !s.reserved_by);

        if (availableStock.length === 0) {
            await ctx.answerCbQuery('❌ Stok habis! Tidak bisa replace.', { show_alert: true });
            return;
        }

        await ctx.editMessageText(`⚠️ *Replace akun order \`${orderId}\`?*\n\nAkun baru akan diambil dari stok ${prod.name_id} (${availableStock.length} tersedia).\nAkun baru akan dikirim ke user.`, {
            parse_mode: 'Markdown',
            ...orderReplaceConfirmKeyboard(orderId)
        });
    });

    // Replace Account (Step 2: Execute)
    bot.action(/^adm_order_confirm_replace_(.+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        await ctx.answerCbQuery();

        const orderId = ctx.match[1];
        const order = db.getOrderById(orderId);
        if (!order) return;

        const prod = db.getProductById(order.product_id);
        if (!prod) {
            await ctx.editMessageText('❌ Produk tidak ditemukan.', {
                reply_markup: { inline_keyboard: [[{ text: '⬅️ Back', callback_data: `adm_order_view_${orderId}` }]] }
            });
            return;
        }

        const availableStock = db.getStockByProduct(order.product_id).filter(s => !s.sold && !s.reserved_by);

        if (availableStock.length === 0) {
            await ctx.editMessageText('❌ Stok habis! Tidak bisa replace.', {
                reply_markup: { inline_keyboard: [[{ text: '⬅️ Back', callback_data: `adm_order_view_${orderId}` }]] }
            });
            return;
        }

        const newStock = availableStock[0];
        db.markStockAsSold([newStock.id], order.user_id, orderId);

        // Low stock alert
        const remainingAfterReplace = db.getStockByProduct(order.product_id).length;
        if (remainingAfterReplace < 3) {
            try {
                const icon = remainingAfterReplace === 0 ? '🔴' : '🟡';
                for (const aid of ADMIN_IDS) {
                    await ctx.telegram.sendMessage(aid,
                        `${icon} *LOW STOCK ALERT*\n\n📦 ${prod.name_id}\n📊 Sisa stok: *${remainingAfterReplace}*\n\n${remainingAfterReplace === 0 ? '⛔ STOK HABIS!' : '⚠️ Segera restock!'}`,
                        { parse_mode: 'Markdown' }
                    );
                }
            } catch (e) { /* ignore */ }
        }

        const user = db.getUser(order.user_id);
        const lang = user?.language || 'id';
        const prodName = lang === 'en' ? prod?.name_en : prod?.name_id;

        let replaceMsg = `🔁 *REPLACEMENT ACCOUNT*\n`;
        replaceMsg += `┏━━━━━━━━━━━━━━━━\n`;
        replaceMsg += `┣ Order: \`${orderId}\`\n`;
        replaceMsg += `┣ Product: ${prodName || '?'}\n`;
        replaceMsg += `┗ Replacement for troubled account\n\n`;
        replaceMsg += `📋 *NEW ACCOUNT:*\n`;
        replaceMsg += `\n━━━ ${lang === 'en' ? 'Replacement' : 'Pengganti'} ━━━\n`;

        const stockData = newStock.data;
        const lines = stockData.split('|').map(l => l.trim());
        if (prod.stock_type === 'vcc') {
            replaceMsg += `💳 Card: \`${lines[0] || '-'}\`\n`;
            if (lines[1]) replaceMsg += `📅 Expiry: ${lines[1]}\n`;
            if (lines[2]) replaceMsg += `🔒 CVV: ${lines[2]}\n`;
        } else {
            lines.forEach(l => { replaceMsg += `\`${l}\`\n`; });
        }

        const warranty = lang === 'en'
            ? (prod.warranty_en || prod.terms_en)
            : (prod.warranty_id || prod.terms_id);
        if (warranty) {
            replaceMsg += `\n📜 *${lang === 'en' ? 'Warranty/Terms' : 'Garansi/S&K'}:*\n${warranty}\n`;
        }

        replaceMsg += `\n🙏 ${lang === 'en' ? 'Sorry for the inconvenience!' : 'Mohon maaf atas ketidaknyamanan!'}`;

        try {
            await ctx.telegram.sendMessage(order.chat_id, replaceMsg, { parse_mode: 'Markdown' });

            const updatedDelivered = [...(order.delivered_data || []), stockData];
            const updatedStockIds = [...(order.stock_ids || []), newStock.id];
            db.updateOrder(orderId, {
                delivered_data: updatedDelivered,
                stock_ids: updatedStockIds,
                replaced_at: new Date().toISOString()
            });

            const remaining = availableStock.length - 1;
            const successMsg = '✅ Replace berhasil!\n\nAkun baru dikirim ke user.\nStok ' + prod.name_id + ': ' + remaining + ' tersisa';
            await ctx.editMessageText(successMsg, {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '⬅️ Back', callback_data: `adm_order_view_${orderId}` }]] }
            });
        } catch (err) {
            await ctx.editMessageText('❌ Gagal kirim: ' + err.message, {
                reply_markup: { inline_keyboard: [[{ text: '⬅️ Back', callback_data: `adm_order_view_${orderId}` }]] }
            });
        }
    });

    // Refund (Step 1: Confirm)
    bot.action(/^adm_order_refund_(.+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        await ctx.answerCbQuery();

        const orderId = ctx.match[1];
        const order = db.getOrderById(orderId);
        if (!order) return;

        await ctx.editMessageText(`⚠️ *Refund order \`${orderId}\`?*\n\nStok akan dikembalikan (${order.stock_ids?.length || 0} item).\nUser akan diberi notifikasi refund.`, {
            parse_mode: 'Markdown',
            ...orderRefundConfirmKeyboard(orderId)
        });
    });

    // Refund (Step 2: Execute)
    bot.action(/^adm_order_confirm_refund_(.+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        await ctx.answerCbQuery();

        const orderId = ctx.match[1];
        const order = db.getOrderById(orderId);
        if (!order) return;

        if (order.stock_ids && order.stock_ids.length > 0) {
            db.restoreStock(order.stock_ids);
        }

        db.updateOrder(orderId, {
            status: 'refunded',
            refunded_at: new Date().toISOString()
        });

        if (order.delivery_message_id && (order.chat_id || order.user_id)) {
            try {
                await ctx.telegram.deleteMessage(order.chat_id || order.user_id, order.delivery_message_id);
            } catch (e) { /* message may already be deleted */ }
        }

        try {
            const prodLabel = order.product_id === 'TOPUP' ? '💰 Topup Saldo' : (db.getProductById(order.product_id)?.name_id || '?');
            await ctx.telegram.sendMessage(order.chat_id || order.user_id,
                `💰 *REFUND NOTICE*\n\nOrder \`${orderId}\` (${prodLabel}) has been refunded by admin.\nPlease contact admin for payment refund details.`,
                { parse_mode: 'Markdown' }
            );
        } catch (e) { /* user may have blocked bot */ }

        await ctx.editMessageText(`✅ Order \`${orderId}\` berhasil di-refund.\n\nStok dikembalikan: ${order.stock_ids?.length || 0} item`, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '⬅️ Back', callback_data: `adm_order_view_${orderId}` }]] }
        });
    });

    // Delete Order (Step 1: Confirm)
    bot.action(/^adm_order_delete_(.+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        await ctx.answerCbQuery();

        const orderId = ctx.match[1];
        await ctx.editMessageText(`⚠️ *Hapus order \`${orderId}\`?*\n\nAksi ini tidak bisa dibatalkan!`, {
            parse_mode: 'Markdown',
            ...orderDeleteConfirmKeyboard(orderId)
        });
    });

    // Delete Order (Step 2: Execute)
    bot.action(/^adm_order_confirm_delete_(.+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        await ctx.answerCbQuery();

        const orderId = ctx.match[1];
        db.releaseReservedStock(orderId);
        db.deleteOrder(orderId);

        await ctx.editMessageText(`🗑 Order \`${orderId}\` berhasil dihapus.`, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '⬅️ Back to Orders', callback_data: 'adm_orders' }]] }
        });
    });
}

module.exports = { registerOrderHandlers };
