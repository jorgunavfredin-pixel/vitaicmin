/**
 * Order management endpoints for the web admin panel.
 * Mirrors the chat admin actions (list / detail / redeliver / replace / refund / delete / export),
 * reusing the same db + bot.telegram so behavior stays identical.
 */
const db = require('../../models/db');
const { formatIDR, formatDateWIB, getWIBToday } = require('../../utils/helpers');
const { requireAuth } = require('../auth');

const ADMIN_IDS = (process.env.ADMIN_ID || '').split(',').map(id => id.trim()).filter(Boolean);
const STATUSES = ['pending', 'delivered', 'expired', 'cancelled', 'refunded'];

const productLabel = (o) =>
    o.product_id === 'TOPUP' ? '💰 Topup Saldo' : (db.getProductById(o.product_id)?.name_id || o.product_id);

// Format one stock account into Markdown (same style as chat redeliver)
const formatAccountMd = (data, stockType) => {
    const lines = String(data).split('|').map(l => l.trim());
    if (stockType === 'vcc') {
        let s = `💳 Card: \`${lines[0] || '-'}\`\n`;
        if (lines[1]) s += `📅 Expiry: ${lines[1]}\n`;
        if (lines[2]) s += `🔒 CVV: ${lines[2]}\n`;
        return s;
    }
    return lines.map(l => `\`${l}\``).join('\n') + '\n';
};

const notifyLowStock = async (bot, prod) => {
    const remaining = db.getStockByProduct(prod.id).length;
    if (remaining >= 3) return;
    const icon = remaining === 0 ? '🔴' : '🟡';
    for (const aid of ADMIN_IDS) {
        try {
            await bot.telegram.sendMessage(aid,
                `${icon} *LOW STOCK ALERT*\n\n📦 ${prod.name_id}\n📊 Sisa stok: *${remaining}*\n\n${remaining === 0 ? '⛔ STOK HABIS!' : '⚠️ Segera restock!'}`,
                { parse_mode: 'Markdown' });
        } catch (e) { /* ignore */ }
    }
};

// ---- GET /orders ----
const listOrders = (req, res) => {
    try {
        const status = (req.query.status || 'all').toLowerCase();
        const q = (req.query.q || '').trim().toLowerCase();
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const pageSize = Math.min(100, Math.max(5, parseInt(req.query.pageSize) || 20));

        let orders = db.getOrders().sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));

        // Enrich for display + search
        const enriched = orders.map(o => {
            const user = db.getUser(o.user_id);
            return {
                id: o.id,
                user_id: o.user_id,
                username: user?.username || null,
                first_name: user?.first_name || null,
                product: productLabel(o),
                quantity: o.quantity,
                total_idr: o.total_idr,
                total_usd: o.total_usd,
                status: o.status,
                method: o.payment_method,
                created_at: o.created_at,
                paid_at: o.paid_at,
                delivered_at: o.delivered_at
            };
        });

        // Counts per status (whole set)
        const counts = { all: enriched.length };
        STATUSES.forEach(s => { counts[s] = 0; });
        enriched.forEach(o => { if (o.status in counts) counts[o.status]++; });

        let filtered = enriched;
        if (status !== 'all') filtered = filtered.filter(o => o.status === status);
        if (q) {
            filtered = filtered.filter(o =>
                o.id.toLowerCase().includes(q) ||
                String(o.user_id).toLowerCase().includes(q) ||
                (o.username || '').toLowerCase().includes(q) ||
                (o.first_name || '').toLowerCase().includes(q) ||
                (o.product || '').toLowerCase().includes(q)
            );
        }

        const total = filtered.length;
        const totalPages = Math.max(1, Math.ceil(total / pageSize));
        const start = (Math.min(page, totalPages) - 1) * pageSize;
        const pageItems = filtered.slice(start, start + pageSize);

        res.json({ orders: pageItems, total, page: Math.min(page, totalPages), pageSize, totalPages, counts });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

// ---- GET /orders/export.csv ----
const exportOrders = (req, res) => {
    try {
        const orders = db.getOrders();
        const headers = ['ID', 'User ID', 'Username', 'Product', 'Qty', 'Total IDR', 'Total USD', 'Payment', 'Status', 'Created', 'Paid', 'Delivered'];
        const rows = orders.map(o => {
            const user = db.getUser(o.user_id);
            return [
                o.id, o.user_id, user?.username || '-', productLabel(o),
                o.quantity || 1, o.total_idr || 0, o.total_usd || 0,
                o.payment_method || '-', o.status,
                o.created_at ? formatDateWIB(o.created_at) : '-',
                o.paid_at ? formatDateWIB(o.paid_at) : '-',
                o.delivered_at ? formatDateWIB(o.delivered_at) : '-'
            ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',');
        });
        const csv = [headers.join(','), ...rows].join('\n');
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="orders_${getWIBToday()}.csv"`);
        res.send('﻿' + csv); // BOM for Excel
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

// ---- GET /orders/:id ----
const getOrder = (req, res) => {
    const order = db.getOrderById(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order tidak ditemukan' });
    const prod = db.getProductById(order.product_id);
    const user = db.getUser(order.user_id);
    let availableStock = 0;
    if (prod) availableStock = db.getStockByProduct(order.product_id).filter(s => !s.sold && !s.reserved_by).length;
    res.json({
        ...order,
        product_name: productLabel(order),
        stock_type: prod?.stock_type || null,
        available_stock: availableStock,
        user: user ? { id: order.user_id, username: user.username, first_name: user.first_name, language: user.language } : null
    });
};

// ---- POST /orders/:id/redeliver ----
const redeliver = (bot) => async (req, res) => {
    const order = db.getOrderById(req.params.id);
    if (!order || !order.delivered_data || order.delivered_data.length === 0) {
        return res.status(400).json({ error: 'Tidak ada data untuk dikirim ulang' });
    }
    const prod = db.getProductById(order.product_id);
    const user = db.getUser(order.user_id);
    const lang = user?.language || 'id';
    const prodName = lang === 'en' ? prod?.name_en : prod?.name_id;

    let msg = `🔄 *REDELIVER*\n┏━━━━━━━━━━━━━━━━\n┣ Order: \`${order.id}\`\n┣ Product: ${prodName || '?'}\n┗ Qty: ${order.quantity}\n\n📋 *YOUR ACCOUNT(S):*\n`;
    order.delivered_data.forEach((d, i) => {
        msg += `\n━━━ ${lang === 'en' ? 'Account' : 'Akun'} ${i + 1} ━━━\n` + formatAccountMd(d, prod?.stock_type);
    });

    try {
        await bot.telegram.sendMessage(order.chat_id || order.user_id, msg, { parse_mode: 'Markdown' });
        res.json({ ok: true, message: 'Akun berhasil dikirim ulang ke user' });
    } catch (e) {
        res.status(500).json({ error: 'Gagal kirim: ' + e.message });
    }
};

// ---- POST /orders/:id/replace ----
const replaceAccount = (bot) => async (req, res) => {
    const order = db.getOrderById(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order tidak ditemukan' });
    const prod = db.getProductById(order.product_id);
    if (!prod) return res.status(400).json({ error: 'Produk tidak ditemukan' });

    const availableStock = db.getStockByProduct(order.product_id).filter(s => !s.sold && !s.reserved_by);
    if (availableStock.length === 0) return res.status(400).json({ error: 'Stok habis! Tidak bisa replace.' });

    const newStock = availableStock[0];
    db.markStockAsSold([newStock.id], order.user_id, order.id);
    await notifyLowStock(bot, prod);

    const user = db.getUser(order.user_id);
    const lang = user?.language || 'id';
    const prodName = lang === 'en' ? prod?.name_en : prod?.name_id;

    let msg = `🔁 *REPLACEMENT ACCOUNT*\n┏━━━━━━━━━━━━━━━━\n┣ Order: \`${order.id}\`\n┣ Product: ${prodName || '?'}\n┗ Replacement for troubled account\n\n📋 *NEW ACCOUNT:*\n`;
    msg += `\n━━━ ${lang === 'en' ? 'Replacement' : 'Pengganti'} ━━━\n` + formatAccountMd(newStock.data, prod.stock_type);
    const warranty = lang === 'en' ? (prod.warranty_en || prod.terms_en) : (prod.warranty_id || prod.terms_id);
    if (warranty) msg += `\n📜 *${lang === 'en' ? 'Warranty/Terms' : 'Garansi/S&K'}:*\n${warranty}\n`;
    msg += `\n🙏 ${lang === 'en' ? 'Sorry for the inconvenience!' : 'Mohon maaf atas ketidaknyamanan!'}`;

    try {
        await bot.telegram.sendMessage(order.chat_id || order.user_id, msg, { parse_mode: 'Markdown' });
        db.updateOrder(order.id, {
            delivered_data: [...(order.delivered_data || []), newStock.data],
            stock_ids: [...(order.stock_ids || []), newStock.id],
            replaced_at: new Date().toISOString()
        });
        res.json({ ok: true, message: `Akun pengganti dikirim. Sisa stok: ${availableStock.length - 1}` });
    } catch (e) {
        res.status(500).json({ error: 'Gagal kirim: ' + e.message });
    }
};

// ---- POST /orders/:id/refund ----
const refund = (bot) => async (req, res) => {
    const order = db.getOrderById(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order tidak ditemukan' });

    if (order.stock_ids && order.stock_ids.length > 0) db.restoreStock(order.stock_ids);
    db.updateOrder(order.id, { status: 'refunded', refunded_at: new Date().toISOString() });

    if (order.delivery_message_id && (order.chat_id || order.user_id)) {
        try { await bot.telegram.deleteMessage(order.chat_id || order.user_id, order.delivery_message_id); } catch (e) { /* ignore */ }
    }
    try {
        await bot.telegram.sendMessage(order.chat_id || order.user_id,
            `💰 *REFUND NOTICE*\n\nOrder \`${order.id}\` (${productLabel(order)}) has been refunded by admin.\nPlease contact admin for payment refund details.`,
            { parse_mode: 'Markdown' });
    } catch (e) { /* user may have blocked bot */ }

    res.json({ ok: true, message: `Order di-refund. Stok dikembalikan: ${order.stock_ids?.length || 0} item` });
};

// ---- DELETE /orders/:id ----
const remove = (req, res) => {
    const order = db.getOrderById(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order tidak ditemukan' });
    db.releaseReservedStock(order.id);
    db.deleteOrder(order.id);
    res.json({ ok: true, message: 'Order dihapus' });
};

const registerOrderRoutes = (api, bot) => {
    api.get('/orders', requireAuth, listOrders);
    api.get('/orders/export.csv', requireAuth, exportOrders); // before :id
    api.get('/orders/:id', requireAuth, getOrder);
    api.post('/orders/:id/redeliver', requireAuth, redeliver(bot));
    api.post('/orders/:id/replace', requireAuth, replaceAccount(bot));
    api.post('/orders/:id/refund', requireAuth, refund(bot));
    api.delete('/orders/:id', requireAuth, remove);
};

module.exports = { registerOrderRoutes };
