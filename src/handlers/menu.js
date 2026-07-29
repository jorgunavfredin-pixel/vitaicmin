const db = require('../models/db');
const { formatIDR, formatUSD, replacePlaceholders, buildPaymentConfirmation } = require('../utils/helpers');
const { convertIDRtoUSD } = require('../payments/exchange');
const { createQRISPayment, generateQRImageUrl } = require('../payments/qris');
const { getExpirationTime } = require('../services/invoice');
const {
    categoriesKeyboard,
    productsKeyboard,
    quantityKeyboard,
    mainMenuKeyboard,
    backToMenuKeyboard
} = require('../utils/keyboard');

async function generateCheckoutMessage(product, quantity, lang) {
    const effectivePrice = db.getEffectivePrice(product);
    let totalIDR = effectivePrice * quantity;
    let discountPercent = 0;
    let discountAmount = 0;
    let discountMinQty = 0;

    // Apply qty discount only if NOT flash sale
    if (!db.isFlashSaleActive(product) && product.qty_discounts) {
        try {
            const tiers = JSON.parse(product.qty_discounts);
            if (Array.isArray(tiers) && tiers.length > 0) {
                const sorted = tiers.sort((a, b) => b.min_qty - a.min_qty);
                const match = sorted.find(t => quantity >= t.min_qty);
                if (match) {
                    discountPercent = match.percent;
                    discountMinQty = match.min_qty;
                    discountAmount = Math.floor(totalIDR * discountPercent / 100);
                    totalIDR = totalIDR - discountAmount;
                }
            }
        } catch (e) { }
    }

    const name = lang === 'en' ? product.name_en : product.name_id;
    const desc = lang === 'en' ? (product.description_en || '-') : (product.description_id || '-');
    const stock = product.stock_mode === 'unlimited' ? '♾ Unlimited' : db.getAvailableStockCount(product.id);

    // Show price in USD for English, IDR for Indonesian
    let priceText, totalText, discountText = '';
    if (lang === 'en') {
        const usdPrice = await convertIDRtoUSD(effectivePrice);
        const usdTotal = await convertIDRtoUSD(totalIDR);
        priceText = `$${formatUSD(usdPrice)}`;
        totalText = `$${formatUSD(usdTotal)}`;
        if (discountPercent > 0) {
            const usdSaved = await convertIDRtoUSD(discountAmount);
            discountText = `\n• <b>Discount:</b>  -${discountPercent}% (buy ${discountMinQty}+) = -$${formatUSD(usdSaved)}`;
        }
    } else {
        priceText = `Rp ${formatIDR(effectivePrice)}`;
        totalText = `Rp ${formatIDR(totalIDR)}`;
        if (discountPercent > 0) {
            discountText = `\n• <b>Diskon:</b>  -${discountPercent}% (Min. ${discountMinQty}) = -Rp ${formatIDR(discountAmount)}`;
        }
    }

    const savingsText = discountPercent > 0
        ? (lang === 'en' ? ` (saved $${formatUSD(await convertIDRtoUSD(discountAmount))})` : ` (hemat Rp ${formatIDR(discountAmount)})`)
        : '';

    const title = lang === 'en' ? '🧾 CHECKOUT PRODUCT' : '🧾 CHECKOUT PRODUK';
    const l = lang === 'en' ? {
        prod: 'Product',
        price: 'Price',
        stock: 'Stock',
        qty: 'Quantity',
        total: 'Total',
        desc: 'Description',
        prompt: 'Adjust quantity then proceed to payment:'
    } : {
        prod: 'Produk',
        price: 'Harga',
        stock: 'Stock',
        qty: 'Jumlah',
        total: 'Total',
        desc: 'Deskripsi',
        prompt: 'Atur jumlah lalu lanjut ke pembayaran:'
    };

    return `<b>${title}</b>

• <b>${l.prod}:</b>  ${name}
• <b>${l.price}:</b>   ${priceText} / pcs
• <b>${l.stock}:</b>  ${stock}

━━━━━━━━━━━━━━
• <b>${l.qty}:</b>  ${quantity} pcs${discountText}
• <b>${l.total}:</b>   <b>${totalText}</b>${savingsText}
• <b>${l.desc}:</b> ${desc}    
━━━━━━━━━━━━━━

<i>${l.prompt}</i>`;
}

/**
 * Register menu handlers
 * @param {Object} bot - Telegraf bot instance
 */
const registerMenuHandler = (bot) => {
    // Quantity typing states: userId -> { productId, chatId, checkoutMessageId, promptMessageId, categoryId }
    // Set when the user taps the "✍️ Ketik" button on the checkout screen.
    const qtyInputStates = new Map();

    // Remove a pending "type quantity" prompt (delete the prompt message + clear state)
    const clearQtyPrompt = async (ctx) => {
        if (!ctx.from) return;
        const st = qtyInputStates.get(ctx.from.id.toString());
        if (!st) return;
        qtyInputStates.delete(ctx.from.id.toString());
        if (st.promptMessageId) {
            try { await ctx.telegram.deleteMessage(st.chatId, st.promptMessageId); } catch (e) { }
        }
    };

    // Show categories / List Produk
    bot.action('menu_categories', async (ctx) => {
        const userId = ctx.from.id.toString();
        const lang = db.getUserLanguage(userId);
        const locale = require(`../locales/${lang}`);

        const categories = db.getCategories();

        await ctx.answerCbQuery();

        if (categories.length === 0) {
            await ctx.editMessageText(locale.no_categories, {
                parse_mode: 'Markdown',
                ...mainMenuKeyboard(lang)
            });
            return;
        }

        await ctx.editMessageText(locale.select_category, {
            parse_mode: 'Markdown',
            ...categoriesKeyboard(categories, lang)
        });
    });

    // Cek Stok - show all products with stock info
    bot.action('menu_stock', async (ctx) => {
        const userId = ctx.from.id.toString();
        const lang = db.getUserLanguage(userId);

        await ctx.answerCbQuery();

        const categories = db.getCategories().filter(c => c.active !== false);

        if (categories.length === 0) {
            const noStock = lang === 'en' ? 'No products available.' : 'Belum ada produk.';
            await ctx.editMessageText(noStock, {
                ...mainMenuKeyboard(lang)
            });
            return;
        }

        let stockMsg = lang === 'en' ? '📦 *Stock Status*\n\n' : '📦 *Status Stok*\n\n';

        for (const cat of categories) {
            const products = db.getProductsByCategory(cat.id).filter(p => p.active !== false);
            if (products.length === 0) continue;

            const emoji = cat.emoji || '📁';
            stockMsg += `${emoji} *${lang === 'en' ? cat.name_en : cat.name_id}*\n`;

            for (const prod of products) {
                const stock = prod.stock_mode === 'unlimited' ? '♾' : db.getAvailableStockCount(prod.id);
                const name = lang === 'en' ? prod.name_en : prod.name_id;
                const status = stock === '♾' || stock > 0 ? '✅' : '❌';
                stockMsg += `${status} ${name}: ${stock}\n`;
            }
            stockMsg += '\n';
        }

        await ctx.editMessageText(stockMsg, {
            parse_mode: 'Markdown',
            ...backToMenuKeyboard(lang)
        });
    });

    // Category selected - show products
    bot.action(/^cat_(.+)$/, async (ctx) => {
        const categoryId = ctx.match[1];
        const userId = ctx.from.id.toString();
        const lang = db.getUserLanguage(userId);
        const locale = require(`../locales/${lang}`);

        const category = db.getCategories().find(c => c.id === categoryId);
        if (!category) {
            await ctx.answerCbQuery(locale.error_general);
            return;
        }

        const products = db.getProductsByCategory(categoryId);

        await ctx.answerCbQuery();

        if (products.length === 0) {
            await ctx.editMessageText(locale.no_products, {
                parse_mode: 'Markdown',
                ...categoriesKeyboard(db.getCategories(), lang)
            });
            return;
        }

        // Add stock info to products for display (only active)
        const productsWithStock = products
            .filter(p => p.active !== false)
            .map(prod => {
                const stockCount = db.getAvailableStockCount(prod.id);
                return {
                    ...prod,
                    stockCount
                };
            });

        await ctx.editMessageText(locale.select_product, {
            parse_mode: 'Markdown',
            ...productsKeyboard(productsWithStock, lang)
        });

        // Store category in session for back navigation
        ctx.session = ctx.session || {};
        ctx.session.currentCategory = categoryId;
    });

    // Product selected - show checkout
    bot.action(/^prod_(.+)$/, async (ctx) => {
        const productId = ctx.match[1];
        const userId = ctx.from.id.toString();
        const lang = db.getUserLanguage(userId);
        const locale = require(`../locales/${lang}`);

        const product = db.getProductById(productId);
        if (!product) {
            await ctx.answerCbQuery(locale.error_general);
            return;
        }

        const stockCount = db.getAvailableStockCount(productId);
        if (stockCount === 0 && product.stock_mode !== 'unlimited') {
            await ctx.answerCbQuery(locale.out_of_stock);
            return;
        }

        await ctx.answerCbQuery();

        // Initial quantity = 1
        const message = await generateCheckoutMessage(product, 1, lang);
        const maxQty = product.stock_mode === 'unlimited' ? 999 : stockCount;

        try { await ctx.deleteMessage(); } catch (e) { }
        await ctx.reply(message, {
            parse_mode: 'HTML',
            ...quantityKeyboard(maxQty, productId, 1, product.category_id, lang)
        });
    });

    // Increase Quantity
    bot.action(/^qty_inc_(.+)_(.+)$/, async (ctx) => {
        const productId = ctx.match[1];
        const currentQty = parseInt(ctx.match[2]);
        const nextQty = currentQty + 1;
        const userId = ctx.from.id.toString();
        const lang = db.getUserLanguage(userId);
        clearQtyPrompt(ctx);

        const product = db.getProductById(productId);
        const stockCount = db.getAvailableStockCount(productId);
        const maxQty = product.stock_mode === 'unlimited' ? 999 : Math.min(stockCount, 999);

        if (nextQty > maxQty) {
            await ctx.answerCbQuery('Max quantity reached');
            return;
        }

        await ctx.answerCbQuery();
        const message = await generateCheckoutMessage(product, nextQty, lang);

        try {
            await ctx.editMessageText(message, {
                parse_mode: 'HTML',
                ...quantityKeyboard(maxQty, productId, nextQty, product.category_id, lang)
            });
        } catch (e) {
            // Ignore 'message is not modified' error
        }
    });

    // Decrease Quantity
    bot.action(/^qty_dec_(.+)_(.+)$/, async (ctx) => {
        const productId = ctx.match[1];
        const currentQty = parseInt(ctx.match[2]);
        const nextQty = currentQty - 1;
        const userId = ctx.from.id.toString();
        const lang = db.getUserLanguage(userId);
        clearQtyPrompt(ctx);

        if (nextQty < 1) {
            await ctx.answerCbQuery('Min quantity is 1');
            return;
        }

        const product = db.getProductById(productId);
        const stockCount = db.getAvailableStockCount(productId);
        const maxQty = product.stock_mode === 'unlimited' ? 999 : Math.min(stockCount, 999);

        await ctx.answerCbQuery();
        const message = await generateCheckoutMessage(product, nextQty, lang);

        try {
            await ctx.editMessageText(message, {
                parse_mode: 'HTML',
                ...quantityKeyboard(maxQty, productId, nextQty, product.category_id, lang)
            });
        } catch (e) {
            // Ignore 'message is not modified' error
        }
    });

    // Increase Quantity by 5
    bot.action(/^qty_inc5_(.+)_(.+)$/, async (ctx) => {
        const productId = ctx.match[1];
        const currentQty = parseInt(ctx.match[2]);
        const nextQty = currentQty + 5;
        const userId = ctx.from.id.toString();
        const lang = db.getUserLanguage(userId);
        clearQtyPrompt(ctx);

        const product = db.getProductById(productId);
        const stockCount = db.getAvailableStockCount(productId);
        const maxQty = product.stock_mode === 'unlimited' ? 999 : Math.min(stockCount, 999);

        if (nextQty > maxQty) {
            await ctx.answerCbQuery('Max quantity reached');
            return;
        }

        await ctx.answerCbQuery();
        const message = await generateCheckoutMessage(product, nextQty, lang);

        try {
            await ctx.editMessageText(message, {
                parse_mode: 'HTML',
                ...quantityKeyboard(maxQty, productId, nextQty, product.category_id, lang)
            });
        } catch (e) { }
    });

    // Decrease Quantity by 5
    bot.action(/^qty_dec5_(.+)_(.+)$/, async (ctx) => {
        const productId = ctx.match[1];
        const currentQty = parseInt(ctx.match[2]);
        const nextQty = currentQty - 5;
        const userId = ctx.from.id.toString();
        const lang = db.getUserLanguage(userId);
        clearQtyPrompt(ctx);

        if (nextQty < 1) {
            await ctx.answerCbQuery('Min quantity is 1');
            return;
        }

        const product = db.getProductById(productId);
        const stockCount = db.getAvailableStockCount(productId);
        const maxQty = product.stock_mode === 'unlimited' ? 999 : Math.min(stockCount, 999);

        await ctx.answerCbQuery();
        const message = await generateCheckoutMessage(product, nextQty, lang);

        try {
            await ctx.editMessageText(message, {
                parse_mode: 'HTML',
                ...quantityKeyboard(maxQty, productId, nextQty, product.category_id, lang)
            });
        } catch (e) { }
    });

    // Payment Confirmation
    bot.action(/^pay_confirm_(.+)_(.+)$/, async (ctx) => {
        const productId = ctx.match[1];
        const quantity = parseInt(ctx.match[2]);
        const userId = ctx.from.id.toString();
        const lang = db.getUserLanguage(userId);
        const locale = require(`../locales/${lang}`);
        clearQtyPrompt(ctx);

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
        const userInfo = db.getUser(userId);
        if (userInfo && userInfo.banned) {
            await ctx.answerCbQuery(lang === 'en' ? '🚫 Your account has been suspended.' : '🚫 Akun Anda telah disuspend.', { show_alert: true });
            return;
        }

        const product = db.getProductById(productId);
        if (!product || product.active === false) {
            await ctx.answerCbQuery(locale.error_general, { show_alert: true });
            return;
        }

        // Check stock again
        const stockCount = db.getAvailableStockCount(productId);
        if (product.stock_mode !== 'unlimited' && stockCount < quantity) {
            await ctx.answerCbQuery(locale.error_no_stock);
            return;
        }

        await ctx.answerCbQuery();

        const effectivePrice = db.getEffectivePrice(product);
        let totalIDR = effectivePrice * quantity;

        // Apply qty discount only if NOT flash sale
        if (!db.isFlashSaleActive(product) && product.qty_discounts) {
            try {
                const tiers = JSON.parse(product.qty_discounts);
                if (Array.isArray(tiers) && tiers.length > 0) {
                    const sorted = tiers.sort((a, b) => b.min_qty - a.min_qty);
                    const match = sorted.find(t => quantity >= t.min_qty);
                    if (match) {
                        const discountAmount = Math.floor(totalIDR * match.percent / 100);
                        totalIDR = totalIDR - discountAmount;
                    }
                }
            } catch (e) { }
        }

        const totalUSD = await convertIDRtoUSD(totalIDR);

        // Create order without expiry (user is still deciding payment method)
        // Status = 'init' to indicate order created but not yet committed
        const order = db.createOrder({
            user_id: userId,
            product_id: productId,
            quantity: quantity,
            total_idr: totalIDR,
            total_usd: parseFloat(totalUSD.toFixed(2)),
            payment_method: null, // Not selected yet
            chat_id: ctx.chat.id,
            status: 'init' // Not pending yet - user can cancel freely
        });

        const msg = await buildPaymentConfirmation(order, lang, db, convertIDRtoUSD);

        await ctx.editMessageText(msg, {
            parse_mode: 'HTML',
            ...require('../utils/keyboard').paymentMethodKeyboard(order.id, lang)
        });
    });

    // ===== TYPE QUANTITY (repurposed "Max" button) =====

    // User taps "✍️ Ketik" — send a force-reply prompt; the checkout form stays intact above
    bot.action(/^qtytype_(.+)_(\d+)$/, async (ctx) => {
        const productId = ctx.match[1];
        const userId = ctx.from.id.toString();
        const lang = db.getUserLanguage(userId);

        const product = db.getProductById(productId);
        if (!product) { await ctx.answerCbQuery(); return; }
        const stockCount = db.getAvailableStockCount(productId);
        const maxQty = product.stock_mode === 'unlimited' ? 999 : Math.min(stockCount, 999);

        await ctx.answerCbQuery();

        // Drop any previous pending prompt first
        await clearQtyPrompt(ctx);

        const checkoutMessageId = ctx.callbackQuery.message.message_id;
        const promptText = lang === 'en'
            ? `✍️ Type the quantity you want (1-${maxQty}):`
            : `✍️ Ketik jumlah yang mau dibeli (1-${maxQty}):`;

        let promptMsg;
        try {
            promptMsg = await ctx.reply(promptText, {
                reply_markup: {
                    force_reply: true,
                    input_field_placeholder: lang === 'en' ? 'e.g. 3' : 'contoh: 3'
                }
            });
        } catch (e) { return; }

        qtyInputStates.set(userId, {
            productId,
            chatId: ctx.chat.id,
            checkoutMessageId,
            promptMessageId: promptMsg.message_id,
            categoryId: product.category_id,
            expiresAt: Date.now() + 10 * 60 * 1000
        });
    });

    // Capture the typed number, clean up both messages, and edit the checkout form above
    bot.on('text', async (ctx, next) => {
        const userId = ctx.from.id.toString();
        const state = qtyInputStates.get(userId);
        if (!state) return next();
        const isPromptReply = ctx.message.reply_to_message?.message_id === state.promptMessageId;
        if (state.expiresAt <= Date.now()) {
            qtyInputStates.delete(userId);
            return next();
        }
        if (String(ctx.chat.id) !== String(state.chatId) || !isPromptReply) return next();

        const raw = ctx.message.text.trim();
        // Only consume pure numbers; anything else falls through to other handlers
        if (!/^\d+$/.test(raw)) return next();

        const lang = db.getUserLanguage(userId);
        const qty = parseInt(raw, 10);

        const deleteReply = async () => { try { await ctx.deleteMessage(); } catch (e) { } };
        const deletePrompt = async () => {
            if (state.promptMessageId) { try { await ctx.telegram.deleteMessage(state.chatId, state.promptMessageId); } catch (e) { } }
        };

        const product = db.getProductById(state.productId);
        if (!product) { qtyInputStates.delete(userId); await deleteReply(); await deletePrompt(); return; }
        const stockCount = db.getAvailableStockCount(state.productId);
        const maxQty = product.stock_mode === 'unlimited' ? 999 : Math.min(stockCount, 999);

        if (qty < 1 || qty > maxQty) {
            // Invalid: delete the reply + old prompt, then re-ask with a fresh force-reply
            await deleteReply();
            await deletePrompt();
            const errText = lang === 'en'
                ? `⚠️ Number must be 1-${maxQty}. Type again:`
                : `⚠️ Angka harus 1-${maxQty}. Ketik lagi:`;
            try {
                const reprompt = await ctx.reply(errText, { reply_markup: { force_reply: true } });
                state.promptMessageId = reprompt.message_id;
                qtyInputStates.set(userId, state);
            } catch (e) { }
            return;
        }

        // Valid — clean up chat (delete reply AND prompt), then edit the checkout form above
        qtyInputStates.delete(userId);
        await deleteReply();
        await deletePrompt();

        const message = await generateCheckoutMessage(product, qty, lang);
        try {
            await ctx.telegram.editMessageText(state.chatId, state.checkoutMessageId, undefined, message, {
                parse_mode: 'HTML',
                ...quantityKeyboard(maxQty, state.productId, qty, product.category_id, lang)
            });
        } catch (e) { }
    });
};

module.exports = { registerMenuHandler };
