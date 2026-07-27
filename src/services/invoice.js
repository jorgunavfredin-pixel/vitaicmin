const db = require('../models/db');
const { formatDateWIB } = require('../utils/helpers');

/**
 * Generate new invoice ID
 * Format: VTC-YYYYMMDD-XXXX
 * @returns {string} - New invoice ID
 */
const generateInvoiceId = () => {
    return db.generateOrderId();
};

/**
 * Format invoice for display
 * @param {Object} order - Order object
 * @param {string} lang - Language code
 * @returns {string} - Formatted invoice text
 */
const formatInvoice = (order, lang = 'id') => {
    const product = db.getProductById(order.product_id);
    const productName = lang === 'en' ? product.name_en : product.name_id;
    const statusTexts = {
        id: {
            pending: '⏳ Menunggu Pembayaran',
            paid: '✅ Dibayar',
            delivered: '📦 Terkirim',
            cancelled: '❌ Dibatalkan',
            expired: '⏰ Kadaluarsa'
        },
        en: {
            pending: '⏳ Pending Payment',
            paid: '✅ Paid',
            delivered: '📦 Delivered',
            cancelled: '❌ Cancelled',
            expired: '⏰ Expired'
        }
    };

    const status = statusTexts[lang][order.status] || order.status;

    if (lang === 'en') {
        return `📋 *Invoice*

📦 Order ID: \`${order.id}\`
🛍️ Product: ${productName}
🔢 Quantity: ${order.quantity}
💰 Total: $${order.total_usd?.toFixed(2) || 'N/A'}

📊 Status: ${status}
📅 Date: ${formatDateWIB(order.created_at)}`;
    }

    return `📋 *Invoice*

📦 Order ID: \`${order.id}\`
🛍️ Produk: ${productName}
🔢 Jumlah: ${order.quantity}
💰 Total: Rp ${new Intl.NumberFormat('id-ID').format(order.total_idr)}

📊 Status: ${status}
📅 Tanggal: ${formatDateWIB(order.created_at)}`;
};

/**
 * Get invoice expiration time
 * @param {string} paymentMethod - 'qris' | 'saldo'
 * @returns {Date} - Expiration date
 */
const getExpirationTime = (paymentMethod) => {
    const now = new Date();
    // Timeout QRIS bisa diatur dari panel (payment_timeout_minutes), default 15 menit.
    // Saldo instan, tapi tetap pakai nilai ini biar konsisten.
    const db = require('../models/db');
    let minutes = parseInt(db.getConfig('payment_timeout_minutes', null, 15));
    if (isNaN(minutes) || minutes < 1) minutes = 15;
    return new Date(now.getTime() + minutes * 60 * 1000);
};

module.exports = {
    generateInvoiceId,
    formatInvoice,
    getExpirationTime
};
