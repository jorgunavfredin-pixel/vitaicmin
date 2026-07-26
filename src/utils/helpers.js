const axios = require('axios');
const exchange = require('../payments/exchange');

// Format currency to IDR
const formatIDR = (amount) => {
    return new Intl.NumberFormat('id-ID').format(amount);
};

// Format currency to USD
const formatUSD = (amount) => {
    return amount.toFixed(2);
};

// Delegate exchange rate functions to exchange.js (single source of truth)
const getExchangeRate = () => exchange.getExchangeRate();
const convertIDRtoUSD = (amountIDR) => exchange.convertIDRtoUSD(amountIDR);
const convertUSDtoIDR = (amountUSD) => exchange.convertUSDtoIDR(amountUSD);



// Format date to WIB
const formatDateWIB = (date) => {
    return new Date(date).toLocaleString('id-ID', {
        timeZone: 'Asia/Jakarta',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
};

// Get today's date string in WIB (YYYY-MM-DD format)
const getWIBToday = () => {
    const now = new Date();
    // Convert to WIB by adding 7 hours offset
    const wib = new Date(now.getTime() + (7 * 60 * 60 * 1000));
    return wib.toISOString().split('T')[0];
};

// Get WIB date ranges for filtering (returns ISO strings)
const getWIBDateRange = () => {
    const now = new Date();
    const wibOffset = 7 * 60 * 60 * 1000;
    const wibNow = new Date(now.getTime() + wibOffset);

    // Today start in WIB (00:00 WIB = 17:00 UTC previous day)
    const todayWIB = wibNow.toISOString().split('T')[0];
    const todayStart = new Date(todayWIB + 'T00:00:00+07:00').toISOString();

    // Week start (7 days ago at 00:00 WIB)
    const weekAgo = new Date(wibNow.getTime() - (7 * 24 * 60 * 60 * 1000));
    const weekDate = weekAgo.toISOString().split('T')[0];
    const weekStart = new Date(weekDate + 'T00:00:00+07:00').toISOString();

    // Month start (1st of current month at 00:00 WIB)
    const monthDate = todayWIB.substring(0, 7) + '-01';
    const monthStart = new Date(monthDate + 'T00:00:00+07:00').toISOString();

    return { todayStart, weekStart, monthStart, todayWIB };
};

// Get remaining time string
const getRemainingTime = (expiresAt) => {
    const now = new Date();
    const expires = new Date(expiresAt);
    const diff = expires - now;

    if (diff <= 0) return '0 menit';

    const minutes = Math.floor(diff / 60000);
    const seconds = Math.floor((diff % 60000) / 1000);

    if (minutes > 0) {
        return `${minutes} menit ${seconds} detik`;
    }
    return `${seconds} detik`;
};

// Parse stock data based on type
const parseStockData = (stockType, data) => {
    switch (stockType) {
        case 'code':
            return { code: data };
        case 'email_pass':
            const [email, pass] = data.split('|').map(s => s.trim());
            return { email, password: pass };
        case 'email_pass_key':
            const [email2, pass2, key] = data.split('|').map(s => s.trim());
            return { email: email2, password: pass2, key };
        case 'vcc':
            const [cardNum, expiry, cvv] = data.split('|').map(s => s.trim());
            return { cardNumber: cardNum, expiry, cvv };
        case 'custom':
            return { custom: data };
        default:
            return { raw: data };
    }
};

// Format stock for display to user
const formatStockForUser = (stockType, data, lang = 'id') => {
    const parsed = parseStockData(stockType, data);

    switch (stockType) {
        case 'code':
            return `🔑 Code: <code>${escapeHtml(parsed.code)}</code>`;
        case 'email_pass':
            return `📧 Email: <code>${escapeHtml(parsed.email)}</code>\n🔐 Password: <code>${escapeHtml(parsed.password)}</code>`;
        case 'email_pass_key':
            return `📧 Email: <code>${escapeHtml(parsed.email)}</code>\n🔐 Password: <code>${escapeHtml(parsed.password)}</code>\n🔑 Key: <code>${escapeHtml(parsed.key)}</code>`;
        case 'vcc':
            return `💳 Card: <code>${escapeHtml(parsed.cardNumber)}</code>\n📅 Expiry: <code>${escapeHtml(parsed.expiry)}</code>\n🔒 CVV: <code>${escapeHtml(parsed.cvv)}</code>`;
        case 'custom':
            return parsed.custom.split('|').map(s => escapeHtml(s.trim())).join('\n');
        default:
            return `📋 Data: <code>${escapeHtml(parsed.raw)}</code>`;
    }
};

// Format stock for a plain-text file (.txt delivery) — NO HTML tags, no escaping
const formatStockForFile = (stockType, data) => {
    const parsed = parseStockData(stockType, data);

    switch (stockType) {
        case 'code':
            return `🔑 Code: ${parsed.code}`;
        case 'email_pass':
            return `📧 Email: ${parsed.email}\n🔐 Password: ${parsed.password}`;
        case 'email_pass_key':
            return `📧 Email: ${parsed.email}\n🔐 Password: ${parsed.password}\n🔑 Key: ${parsed.key}`;
        case 'vcc':
            return `💳 Card: ${parsed.cardNumber}\n📅 Expiry: ${parsed.expiry}\n🔒 CVV: ${parsed.cvv}`;
        case 'custom':
            return parsed.custom.split('|').map(s => s.trim()).join('\n');
        default:
            return `📋 Data: ${parsed.raw}`;
    }
};

// Template string replacer
const replacePlaceholders = (template, data) => {
    let result = template;
    for (const [key, value] of Object.entries(data)) {
        result = result.replace(new RegExp(`{${key}}`, 'g'), value);
    }
    return result;
};

// Escape markdown special characters
const escapeMarkdown = (text) => {
    // Markdown v1 only needs: _ * ` [
    return text.replace(/[_*`\[]/g, '\\$&');
};



/**
 * Build Payment Confirmation message (shared between menu.js and order.js)
 * @param {Object} order - Order object from DB
 * @param {string} lang - Language code ('en' or 'id')
 * @param {Object} db - Database module
 * @param {Function} convertFn - convertIDRtoUSD function
 * @param {Object|null} voucherData - Voucher info { code, discountDesc } or null
 * @returns {Promise<string>} Formatted message
 */
const buildPaymentConfirmation = async (order, lang, db, convertFn, voucherData = null) => {
    const product = db.getProductById(order.product_id);
    const productName = lang === 'en' ? product.name_en : product.name_id;
    const isFlash = db.isFlashSaleActive(product);
    const effectivePrice = db.getEffectivePrice(product);

    // Derive voucher display from the persisted order when not explicitly provided,
    // so re-renders (remove / cancel / re-select) stay consistent with the applied voucher.
    if (!voucherData && order.voucher_code) {
        const v = db.getVoucherByCode(order.voucher_code);
        let discountDesc;
        if (v && v.type === 'percent') {
            discountDesc = lang === 'en' ? `${v.value}% OFF` : `Diskon ${v.value}%`;
        } else if (lang === 'en') {
            discountDesc = `-$${formatUSD(await convertFn(order.discount_amount || 0))}`;
        } else {
            discountDesc = `-Rp ${formatIDR(order.discount_amount || 0)}`;
        }
        voucherData = { code: order.voucher_code, discountDesc };
    }

    const l = lang === 'en' ? {
        title: '🧾 <b>Payment Confirmation</b>',
        status: 'Status: Waiting for payment ⏳',
        orderId: 'Order ID',
        prod: 'Product',
        price: 'Price',
        qty: 'Quantity',
        subtotal: 'Subtotal',
        total: 'Total',
        method: 'Payment Method',
        select: 'Select one of the methods below:',
        voucherApplied: '🎟 <b>Voucher Applied</b> ✅',
        codeVoucher: 'Code Voucher'
    } : {
        title: '🧾 <b>Konfirmasi Pembayaran</b>',
        status: 'Status: Menunggu pembayaran ⏳',
        orderId: 'Order ID',
        prod: 'Produk',
        price: 'Harga',
        qty: 'Jumlah',
        subtotal: 'Subtotal',
        total: 'Total',
        method: 'Metode Pembayaran',
        select: 'Pilih salah satu metode di bawah:',
        voucherApplied: '🎟 <b>Voucher Berhasil</b> ✅',
        codeVoucher: 'Kode Voucher'
    };

    // Price in user's currency
    let priceText, totalText;
    if (lang === 'en') {
        const usdPrice = await convertFn(effectivePrice);
        totalText = `$${formatUSD(order.total_usd)}`;
        if (isFlash) {
            const origUsd = await convertFn(product.price_idr);
            const disc = Math.round((1 - effectivePrice / product.price_idr) * 100);
            priceText = `<s>$${formatUSD(origUsd)}</s> → <b>$${formatUSD(usdPrice)}</b> (-${disc}%) 🔥`;
        } else {
            priceText = `$${formatUSD(usdPrice)}`;
        }
    } else {
        totalText = `Rp ${formatIDR(order.total_idr)}`;
        if (isFlash) {
            const disc = Math.round((1 - effectivePrice / product.price_idr) * 100);
            priceText = `<s>Rp ${formatIDR(product.price_idr)}</s> → <b>Rp ${formatIDR(effectivePrice)}</b> (-${disc}%) 🔥`;
        } else {
            priceText = `Rp ${formatIDR(effectivePrice)}`;
        }
    }

    let msg = `${l.title}\n\n`;
    msg += `<b>${l.status}</b>\n`;
    msg += `<b>${l.orderId}:</b> <code>${order.id}</code>\n`;
    msg += `• <b>${l.prod}:</b> ${productName}\n`;
    msg += `• <b>${l.price}:</b> ${priceText} / pcs\n`;
    msg += `• <b>${l.qty}:</b> ${order.quantity} pcs\n`;

    // Show qty discount info if applicable
    if (!isFlash && product.qty_discounts) {
        try {
            const tiers = JSON.parse(product.qty_discounts);
            if (Array.isArray(tiers) && tiers.length > 0) {
                const sorted = tiers.sort((a, b) => b.min_qty - a.min_qty);
                const match = sorted.find(t => order.quantity >= t.min_qty);
                if (match) {
                    const subtotal = effectivePrice * order.quantity;
                    const discountAmount = Math.floor(subtotal * match.percent / 100);
                    if (lang === 'en') {
                        const usdSaved = await convertFn(discountAmount);
                        msg += `• <b>Discount:</b> -${match.percent}% (buy ${match.min_qty}+) = -$${formatUSD(usdSaved)}\n`;
                    } else {
                        msg += `• <b>Diskon:</b> -${match.percent}% (Minbel. ${match.min_qty}) = -Rp ${formatIDR(discountAmount)}\n`;
                    }
                }
            }
        } catch (e) { }
    }


    if (voucherData) {
        // With voucher: show Subtotal (original price), Voucher info, then new Total
        let subtotalText;
        if (lang === 'en') {
            const originalUSD = order.original_total_usd || await convertFn(order.original_total_idr || order.total_idr);
            subtotalText = `$${formatUSD(originalUSD)}`;
        } else {
            const originalIDR = order.original_total_idr || order.total_idr;
            subtotalText = `Rp ${formatIDR(originalIDR)}`;
        }
        msg += `<b>${l.subtotal}:</b> ${subtotalText}\n`;
        msg += `${l.voucherApplied}\n`;
        msg += `• <b>${l.codeVoucher}:</b> ${voucherData.code} (${voucherData.discountDesc})\n\n`;
        msg += `<b>${l.total}:</b> ${totalText}\n`;
    } else {
        // Without voucher: just Total
        msg += `<b>${l.total}:</b> ${totalText}\n`;
    }

    msg += `\n<b>${l.method}</b>\n${l.select}`;
    return msg;
};

/**
 * Get all admin IDs from env (comma-separated)
 * @returns {string[]} Array of admin IDs
 */
const getAdminIds = () => {
    return (process.env.ADMIN_ID || '').split(',').map(id => id.trim()).filter(Boolean);
};

/**
 * Send message to all admins
 * @param {Object} bot - Telegraf bot instance (or bot.telegram)
 * @param {string} message - Message text
 * @param {Object} opts - sendMessage options
 */
const notifyAdmins = async (telegram, message, opts = {}) => {
    const ids = getAdminIds();
    for (const id of ids) {
        try {
            await telegram.sendMessage(id, message, opts);
        } catch (e) {
            console.error(`Failed to notify admin ${id}:`, e.message);
        }
    }
};


/**
 * Escape HTML special chars for Telegram HTML parse_mode
 */
const escapeHtml = (text) => {
    return String(text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
};

/**
 * Convert Telegram message text + entities to HTML string
 * Supports: bold, italic, underline, strikethrough, code, pre, spoiler, text_link
 */
const entitiesToHtml = (text, entities) => {
    if (!entities || entities.length === 0) return escapeHtml(text);

    const tagMap = {
        bold: ['<b>', '</b>'],
        italic: ['<i>', '</i>'],
        underline: ['<u>', '</u>'],
        strikethrough: ['<s>', '</s>'],
        code: ['<code>', '</code>'],
        pre: ['<pre>', '</pre>'],
        spoiler: ['<tg-spoiler>', '</tg-spoiler>'],
        blockquote: ['<blockquote>', '</blockquote>'],
        expandable_blockquote: ['<blockquote expandable>', '</blockquote>'],
    };

    // Build entity info with open/close tags
    const entityList = [];
    for (const entity of entities) {
        const start = entity.offset;
        const end = entity.offset + entity.length;
        if (entity.type === 'text_link') {
            entityList.push({ start, end, open: `<a href="${entity.url}">`, close: '</a>' });
        } else if (entity.type === 'custom_emoji') {
            entityList.push({ start, end, open: `<tg-emoji emoji-id="${entity.custom_emoji_id}">`, close: '</tg-emoji>' });
        } else if (entity.type === 'pre' && entity.language) {
            entityList.push({ start, end, open: `<pre><code class="language-${entity.language}">`, close: '</code></pre>' });
        } else if (tagMap[entity.type]) {
            entityList.push({ start, end, open: tagMap[entity.type][0], close: tagMap[entity.type][1] });
        }
        // mention, url, email, hashtag, etc. — no HTML wrapping needed, text shows as-is
    }

    if (entityList.length === 0) return escapeHtml(text);

    // Collect all boundary positions and split text into segments
    const positions = new Set([0, text.length]);
    for (const e of entityList) {
        positions.add(e.start);
        positions.add(e.end);
    }
    const sorted = [...positions].sort((a, b) => a - b);

    let result = '';
    for (let i = 0; i < sorted.length - 1; i++) {
        const segStart = sorted[i];
        const segEnd = sorted[i + 1];
        const segment = escapeHtml(text.substring(segStart, segEnd));

        // Find which entities cover this entire segment
        const active = entityList.filter(e => e.start <= segStart && e.end >= segEnd);

        // Open tags, add text, close in reverse (guarantees proper nesting)
        for (const e of active) result += e.open;
        result += segment;
        for (let j = active.length - 1; j >= 0; j--) result += active[j].close;
    }

    return result;
};

/**
 * Safely render S&K text in HTML parse_mode.
 * @param {string} text - The S&K text
 * @param {boolean} isHtml - Whether the text was saved as HTML (from entitiesToHtml)
 */
const safeHtmlSnk = (text, isHtml) => {
    if (!text) return '-';
    // Explicitly marked as HTML (saved via entitiesToHtml)
    if (isHtml) return text;
    // Auto-detect HTML tags from legacy data (old products without terms_format)
    if (/<(b|i|u|s|a|code|pre)>/.test(text)) return text;
    // Plain text — escape for HTML mode
    return escapeHtml(text);
};

module.exports = {
    formatIDR,
    formatUSD,
    getExchangeRate,
    convertIDRtoUSD,
    convertUSDtoIDR,
    formatDateWIB,
    getWIBToday,
    getWIBDateRange,
    getRemainingTime,
    parseStockData,
    formatStockForUser,
    formatStockForFile,
    replacePlaceholders,
    escapeMarkdown,
    escapeHtml,
    entitiesToHtml,
    safeHtmlSnk,
    buildPaymentConfirmation,
    getAdminIds,
    notifyAdmins
};
