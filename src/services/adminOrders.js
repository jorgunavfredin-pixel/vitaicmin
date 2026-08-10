const db = require('../models/db');

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const productLabel = (order) => order.product_id === 'TOPUP' ? 'Topup Saldo' : (db.getProductById(order.product_id)?.name_id || order.product_id);
const md = (value) => String(value ?? '-').replace(/([_*`\[])/g, '\\$1');
const accountMd = (data, type) => {
    const p = String(data).split('|').map(md);
    if (type === 'code') return `🔑 Code: \`${p[0]}\`\n`;
    if (type === 'email_pass') return `📧 Email: \`${p[0]}\`\n🔐 Password: \`${p[1]}\`\n`;
    if (type === 'email_pass_key') return `📧 Email: \`${p[0]}\`\n🔐 Password: \`${p[1]}\`\n🔑 Key: \`${p[2]}\`\n`;
    if (type === 'vcc') return `💳 Card: \`${p[0]}\`\n${p[1] ? `📅 Expiry: \`${p[1]}\`\n` : ''}${p[2] ? `🔒 CVV: \`${p[2]}\`\n` : ''}`;
    return p.map(x => `📋 \`${x}\``).join('\n') + '\n';
};

const redeliverOrder = async ({ telegram, orderId }) => {
    const order = db.getOrderById(orderId);
    if (!order) fail('Order tidak ditemukan', 404);
    if (!order.delivered_data?.length) fail('Tidak ada data untuk dikirim ulang');
    const prod = db.getProductById(order.product_id);
    const user = db.getUser(order.user_id); const lang = user?.language || 'id';
    let text = `🔄 *REDELIVER*\nOrder: \`${md(order.id)}\`\nProduct: ${md(lang === 'en' ? prod?.name_en : prod?.name_id)}\n\n`;
    order.delivered_data.forEach((data, i) => { text += `*${lang === 'en' ? 'Account' : 'Akun'} ${i + 1}*\n${accountMd(data, prod?.stock_type)}\n`; });
    await telegram.sendMessage(order.chat_id || order.user_id, text, { parse_mode: 'Markdown' });
    return { order, message: 'Akun berhasil dikirim ulang ke user' };
};

const replaceOrderAccount = async ({ telegram, orderId, count = 1 }) => {
    const order = db.getOrderById(orderId); if (!order) fail('Order tidak ditemukan', 404);
    if (order.status === 'refunded') fail('Order refunded tidak dapat di-replace');
    const prod = db.getProductById(order.product_id); if (!prod) fail('Produk tidak ditemukan');
    const qty = Math.max(1, Number.parseInt(count, 10) || 1);
    const before = db.getAvailableStockCount(order.product_id);
    const selected = db.claimReplacementStock(order.product_id, qty, order.user_id, order.id);
    if (!selected) fail(`Stok tidak cukup! Hanya tersedia ${before} stok.`);
    const ids = selected.map(x => x.id);
    const user = db.getUser(order.user_id); const lang = user?.language || 'id';
    let text = `🔁 *REPLACEMENT ACCOUNT*\nOrder: \`${md(order.id)}\`\nProduct: ${md(lang === 'en' ? prod.name_en : prod.name_id)}\n`;
    selected.forEach((s, i) => { text += `\n*${lang === 'en' ? 'Replacement' : 'Pengganti'} ${i + 1}*\n${accountMd(s.data, prod.stock_type)}`; });
    try {
        await telegram.sendMessage(order.chat_id || order.user_id, text, { parse_mode: 'Markdown' });
    } catch (error) {
        db.restoreStock(ids);
        throw Object.assign(new Error(`Gagal kirim: ${error.message}`), { status: 502 });
    }
    db.updateOrder(order.id, { delivered_data: [...(order.delivered_data || []), ...selected.map(s => s.data)], stock_ids: [...(order.stock_ids || []), ...ids] }, 'replace');
    return { order: db.getOrderById(order.id), replaced: qty, remaining: Math.max(0, before - qty) };
};

const refundOrder = async ({ telegram, orderId }) => {
    const order = db.getOrderById(orderId); if (!order) fail('Order tidak ditemukan', 404);
    if (order.status === 'refunded') fail('Order ini sudah di-refund');
    const ids = order.stock_ids || [];
    if (ids.length) db.restoreStock(ids);
    db.releaseReservedStock(order.id);
    db.updateOrder(order.id, { status: 'refunded', stock_ids: [], delivered_data: [] }, 'refund');

    // Kalau order dibayar pakai SALDO, kembalikan uangnya ke saldo buyer (+ catat history).
    // Tanpa ini, refund order saldo bikin uang buyer hilang.
    let balanceRefunded = 0;
    if (order.payment_method === 'saldo' && Number(order.total_idr) > 0) {
        try {
            const { addBalance } = require('../payments/balance');
            addBalance(order.user_id, Number(order.total_idr), 'refund', `Refund order ${order.id}`, order.id);
            balanceRefunded = Number(order.total_idr);
        } catch (e) {
            // jangan gagalkan seluruh refund kalau pengembalian saldo error; laporkan saja
            console.error('[refundOrder] gagal refund saldo:', e.message);
        }
    }

    const chatId = order.chat_id || order.user_id;
    for (const messageId of [order.delivery_message_id, order.delivery_terms_message_id, order.delivery_file_message_id].filter(Boolean)) {
        try { await telegram.deleteMessage(chatId, messageId); } catch (_) {}
    }
    const refundLine = balanceRefunded > 0 ? `\n\n💵 Saldo Rp ${balanceRefunded.toLocaleString('id-ID')} telah dikembalikan ke akun kamu.` : '';
    try { await telegram.sendMessage(chatId, `💰 *REFUND NOTICE*\n\nOrder \`${md(order.id)}\` (${md(productLabel(order))}) has been refunded by admin.${refundLine}`, { parse_mode: 'Markdown' }); } catch (_) {}
    return { order: db.getOrderById(order.id), restored: ids.length, balanceRefunded };
};

module.exports = { redeliverOrder, replaceOrderAccount, refundOrder };
