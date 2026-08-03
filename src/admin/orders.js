/**
 * Admin — Order Management
 * Extracted from panel.js
 */
const { Markup } = require('telegraf');
const fs = require('fs');
const path = require('path');
const db = require('../models/db');
const { formatIDR, formatDateWIB, getWIBToday, escapeMarkdown } = require('../utils/helpers');
const { safeCsvCell } = require('../utils/csv');
const escMd = (t) => t ? escapeMarkdown(String(t)) : '';
const { redeliverOrder, replaceOrderAccount, refundOrder } = require('../services/adminOrders');
const {
    ordersListKeyboard,
    orderDetailKeyboard,

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
            ].map(safeCsvCell).join(',');
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

    // Shared redeliver
    bot.action(/^adm_order_redeliver_(.+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        await ctx.answerCbQuery();
        try {
            await redeliverOrder({ telegram: ctx.telegram, orderId: ctx.match[1] });
            await ctx.reply('✅ Berhasil dikirim ulang ke user!');
        } catch (e) { await ctx.reply(`❌ ${e.message}`); }
    });
    bot.action(/^adm_order_replace_(.+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        const orderId = ctx.match[1];
        const order = db.getOrderById(orderId);
        if (!order) return ctx.answerCbQuery('Order tidak ditemukan', { show_alert: true });
        const available = db.getUnsoldUnreservedStock(order.product_id).length;
        await ctx.answerCbQuery();
        if (!available) return ctx.answerCbQuery('Stok habis!', { show_alert: true });
        await ctx.editMessageText(`⚠️ *Replace akun order \`${orderId}\`?*\n\nTersedia: ${available} stok.`, { parse_mode: 'Markdown', ...orderReplaceConfirmKeyboard(orderId) });
    });

    bot.action(/^adm_order_confirm_replace_(.+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        await ctx.answerCbQuery();
        const orderId = ctx.match[1];
        try {
            const result = await replaceOrderAccount({ telegram: ctx.telegram, orderId, count: 1 });
            await ctx.editMessageText(`✅ Replace berhasil!\n\nSisa stok: ${result.remaining}`, { reply_markup: { inline_keyboard: [[{ text: '‹ Kembali', callback_data: `adm_order_view_${orderId}` }]] } });
        } catch (e) { await ctx.editMessageText(`❌ ${e.message}`, { reply_markup: { inline_keyboard: [[{ text: '‹ Kembali', callback_data: `adm_order_view_${orderId}` }]] } }); }
    });
    bot.action(/^adm_order_refund_(.+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        const orderId = ctx.match[1];
        const order = db.getOrderById(orderId);
        await ctx.answerCbQuery();
        if (!order) return;
        await ctx.editMessageText(`⚠️ *Refund order \`${orderId}\`?*\n\nStok akan ditarik kembali dan seluruh pesan delivery dibersihkan.`, { parse_mode: 'Markdown', ...orderRefundConfirmKeyboard(orderId) });
    });

    bot.action(/^adm_order_confirm_refund_(.+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        await ctx.answerCbQuery();
        const orderId = ctx.match[1];
        try {
            const result = await refundOrder({ telegram: ctx.telegram, orderId });
            await ctx.editMessageText(`✅ Order \`${orderId}\` berhasil di-refund.\n\nStok dikembalikan: ${result.restored} item`, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '‹ Kembali', callback_data: `adm_order_view_${orderId}` }]] } });
        } catch (e) { await ctx.editMessageText(`❌ ${e.message}`, { reply_markup: { inline_keyboard: [[{ text: '‹ Kembali', callback_data: `adm_order_view_${orderId}` }]] } }); }
    });


}

module.exports = { registerOrderHandlers };
