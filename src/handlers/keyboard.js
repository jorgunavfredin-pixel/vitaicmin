const db = require('../models/db');
const { formatIDR, formatUSD, convertIDRtoUSD, notifyAdmins } = require('../utils/helpers');
const { Markup } = require('telegraf');
const { replyWithBanner, editBannerCaption } = require('../utils/banner');
const { getBalance, getBalanceHistory } = require('../payments/balance');
const { createQRISPayment, generateQRImageUrl, checkQRISStatus } = require('../payments/qris');
const { addBalance } = require('../payments/balance');
const { cancelOrder } = require('../services/reminder');
const {
    mainMenuKeyboard,
    languageKeyboard,
    backToMenuKeyboard,
    topupNominalKeyboard
} = require('../utils/keyboard');

// Items per page for pagination
const ITEMS_PER_PAGE = 10;

/**
 * Generate category list message with pagination
 */
const generateCategoryListMsg = (categories, page, lang) => {
    const total = categories.length;
    const totalPages = Math.ceil(total / ITEMS_PER_PAGE);
    const start = page * ITEMS_PER_PAGE;
    const end = Math.min(start + ITEMS_PER_PAGE, total);
    const items = categories.slice(start, end);

    // Payment info header
    // Simple welcome message
    const storeName = process.env.STORE_NAME || 'Store';
    let msg = `👋 Hiiii.....\nWelcome to <b>${storeName}</b>\n\n`;

    // Show active flash sales
    const activeFS = db.getActiveFlashSales();
    if (activeFS.length > 0) {
        for (const fs of activeFS) {
            const name = lang === 'en' ? fs.name_en : fs.name_id;
            const disc = Math.round((1 - fs.flash_price / fs.price_idr) * 100);
            const endStr = new Date(fs.flash_end).toLocaleString(lang === 'en' ? 'en-US' : 'id-ID', { timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
            msg += `╭─⚡ <b>FLASH SALE</b> ⚡─╮\n`;
            msg += `│ 🏷 <b>${name}</b>\n`;
            msg += `│ 💵 <s>Rp ${formatIDR(fs.price_idr)}</s> → <b>Rp ${formatIDR(fs.flash_price)}</b> (-${disc}%) 🔥\n`;
            msg += `│ ⏰ ${lang === 'en' ? 'Ends' : 'Berakhir'}: ${endStr} WIB\n`;
            msg += `╰─────────────────╯\n\n`;
        }
    }

    msg += '╭─────────────────\n';
    msg += lang === 'en'
        ? `┊ <b>Total Categories:</b> ${total}\n┊ <b>Page</b> ${page + 1}/${totalPages}\n`
        : `┊ <b>Total Kategori:</b> ${total}\n┊ <b>Halaman</b> ${page + 1}/${totalPages}\n`;
    msg += '┊ - - - - - - - - - - -\n';

    items.forEach((cat, idx) => {
        const num = start + idx + 1;
        const name = lang === 'en' ? cat.name_en : cat.name_id;
        msg += `┊ [ ${num} ] <b>${name.toUpperCase()}</b>\n`;
    });

    msg += '╰─────────────────\n\n';
    msg += lang === 'en'
        ? '<i>Select number below to view product:</i>'
        : '<i>Pilih nomor yang ada di bawah untuk melihat produk:</i>';

    return msg;
};

/**
 * Generate category number buttons with pagination
 */
const generateCategoryButtons = (categories, page, lang) => {
    const total = categories.length;
    const totalPages = Math.ceil(total / ITEMS_PER_PAGE);
    const start = page * ITEMS_PER_PAGE;
    const end = Math.min(start + ITEMS_PER_PAGE, total);
    const items = categories.slice(start, end);

    const buttons = [];

    // Number buttons in rows of 5
    let row = [];
    items.forEach((cat, idx) => {
        const num = start + idx + 1;
        row.push(Markup.button.callback(`${num}`, `catnum_${cat.id}`));
        if (row.length === 5) {
            buttons.push(row);
            row = [];
        }
    });
    if (row.length > 0) buttons.push(row);

    // Pagination buttons
    const navRow = [];
    if (page > 0) {
        navRow.push(Markup.button.callback('⬅️ Prev', `catpage_${page - 1}`));
    }
    if (page < totalPages - 1) {
        navRow.push(Markup.button.callback('Next ➡️', `catpage_${page + 1}`));
    }
    if (navRow.length > 0) buttons.push(navRow);

    return Markup.inlineKeyboard(buttons);
};

/**
 * Register keyboard text handlers for Reply Keyboard
 * @param {Object} bot - Telegraf bot instance
 */
const registerKeyboardHandler = (bot) => {
    // Store topup input states (userId -> true). Declared up-front so the menu
    // navigation handlers below can clear it when the user leaves the Saldo menu.
    const topupInputStates = new Map();
    // H4: drop stale topup state whenever the user taps another menu button,
    // so a leaked state never swallows voucher/admin text input later.
    const clearTopupState = (ctx) => { if (ctx.from) topupInputStates.delete(ctx.from.id.toString()); };

    // List Produk - show numbered category list
    bot.hears(['🛒 List Produk', '🛒 Products'], async (ctx) => {
        clearTopupState(ctx);
        const userId = ctx.from.id.toString();
        const lang = db.getUserLanguage(userId);

        const categories = db.getCategories().filter(c => c.active !== false);

        if (categories.length === 0) {
            const noCategories = lang === 'en' ? 'No categories available.' : 'Belum ada kategori.';
            await ctx.reply(noCategories);
            return;
        }

        const msg = generateCategoryListMsg(categories, 0, lang);
        const keyboard = generateCategoryButtons(categories, 0, lang);

        await replyWithBanner(ctx, msg, keyboard);
    });

    // Category page navigation
    bot.action(/^catpage_(\d+)$/, async (ctx) => {
        const page = parseInt(ctx.match[1]);
        const userId = ctx.from.id.toString();
        const lang = db.getUserLanguage(userId);

        const categories = db.getCategories().filter(c => c.active !== false);

        await ctx.answerCbQuery();

        const msg = generateCategoryListMsg(categories, page, lang);
        const keyboard = generateCategoryButtons(categories, page, lang);

        // Category list uses HTML tags (<b>/<i>) — must render as HTML, not Markdown,
        // otherwise the tags leak as raw text. Use editBannerCaption for consistency
        // with the initial render (replyWithBanner) and back_to_categories.
        await editBannerCaption(ctx, msg, keyboard);
    });

    // Helper: build product list page
    const PRODUCTS_PER_PAGE = 4;

    const buildProductPage = async (products, page, lang, catId) => {
        const labels = lang === 'en' ? {
            restock: 'Restock', price: 'Price', stock: 'Stock', sold: 'Sold', desc: 'Description',
            buy_btn: '🛒 Buy', remind_btn: '🔔 Remind',
            warning: '⚠️ Out of stock? Click remind to get notified when restocked',
            back: '⬅️ Back to Categories'
        } : {
            restock: 'Restok', price: 'Harga', stock: 'Stok', sold: 'Terjual', desc: 'Deskripsi',
            buy_btn: '🛒 Beli', remind_btn: '🔔 Ingatkan',
            warning: '⚠️ Stok habis? Klik ingatkan untuk mendapatkan notif saat produk restok',
            back: '⬅️ Kembali ke Kategori'
        };

        const totalPages = Math.ceil(products.length / PRODUCTS_PER_PAGE);
        const start = page * PRODUCTS_PER_PAGE;
        const pageProducts = products.slice(start, start + PRODUCTS_PER_PAGE);

        const hasOutOfStock = pageProducts.some(p => {
            if (p.stock_mode === 'unlimited') return false;
            return db.getAvailableStockCount(p.id) === 0;
        });
        let msg = hasOutOfStock ? `${labels.warning}\n\n` : '';

        if (totalPages > 1) {
            msg += `📄 ${page + 1}/${totalPages}\n\n`;
        }

        const buttons = [];

        for (const prod of pageProducts) {
            const name = lang === 'en' ? prod.name_en : prod.name_id;
            const desc = lang === 'en' ? (prod.description_en || '-') : (prod.description_id || '-');
            const stock = prod.stock_mode === 'unlimited' ? '♾ Unlimited' : db.getAvailableStockCount(prod.id);

            let priceText;
            const isFlash = db.isFlashSaleActive(prod);
            const effectivePrice = db.getEffectivePrice(prod);

            if (lang === 'en') {
                const usdPrice = await convertIDRtoUSD(effectivePrice);
                priceText = `$${formatUSD(usdPrice)}`;
                if (isFlash) {
                    const origUsd = await convertIDRtoUSD(prod.price_idr);
                    const disc = Math.round((1 - effectivePrice / prod.price_idr) * 100);
                    priceText = `<s>$${formatUSD(origUsd)}</s> → <b>$${formatUSD(usdPrice)}</b> (-${disc}%) 🔥`;
                }
            } else {
                priceText = `Rp${formatIDR(effectivePrice)}`;
                if (isFlash) {
                    const disc = Math.round((1 - effectivePrice / prod.price_idr) * 100);
                    priceText = `<s>Rp${formatIDR(prod.price_idr)}</s> → <b>Rp${formatIDR(effectivePrice)}</b> (-${disc}%) 🔥`;
                }
            }

            const allOrders = db.getOrders();
            const soldCount = allOrders
                .filter(o => o.product_id === prod.id && (o.status === 'delivered' || o.status === 'paid'))
                .reduce((sum, o) => sum + o.quantity, 0);

            const stockItems = db.getStockByProduct(prod.id);
            let restokTime = '-';
            if (stockItems.length > 0) {
                const lastAdded = stockItems.sort((a, b) => new Date(b.added_at) - new Date(a.added_at))[0];
                if (lastAdded?.added_at) {
                    const d = new Date(lastAdded.added_at);
                    restokTime = lang === 'en'
                        ? d.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' })
                        : d.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
                }
            }

            const displayName = isFlash ? `⚡ ${name.toUpperCase()}` : name.toUpperCase();
            msg += `╭─〔 <b>${displayName}</b> 〕─\n`;
            msg += `┊🔄 <b>${labels.restock}:</b> ${restokTime}\n`;
            msg += `┊💵 <b>${labels.price}:</b> ${priceText}\n`;
            msg += `┊📦 <b>${labels.stock}:</b> ${stock}\n`;
            msg += `┊📉 <b>${labels.sold}:</b> ${soldCount}\n`;

            // Show discount info if set and not on flash sale
            if (!isFlash && prod.qty_discounts) {
                try {
                    const tiers = JSON.parse(prod.qty_discounts);
                    if (Array.isArray(tiers) && tiers.length > 0) {
                        const first = tiers.sort((a, b) => a.min_qty - b.min_qty)[0];
                        const minLabel = lang === 'en' ? 'Min.' : 'Minbel.';
                        msg += `┊💰 <b>Disc.:</b> ${first.percent}% (${minLabel} ${first.min_qty})\n`;
                    }
                } catch (e) { }
            }

            msg += `┊🗒 <b>${labels.desc}:</b> ${desc}\n`;
            if (isFlash) {
                const endStr = new Date(prod.flash_end).toLocaleString(lang === 'en' ? 'en-US' : 'id-ID', { timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
                msg += `┊⏰ <b>Flash Sale ${lang === 'en' ? 'ends' : 'berakhir'}:</b> ${endStr} WIB\n`;
            }
            msg += '╰─────\n\n';

            const isOutOfStock = stock !== '♾ Unlimited' && stock === 0;
            if (isOutOfStock) {
                buttons.push([Markup.button.callback(`${labels.remind_btn} ${name}`, `remind_${prod.id}`)]);
            } else {
                buttons.push([Markup.button.callback(`${labels.buy_btn} ${name}`, `prod_${prod.id}`)]);
            }
        }

        // Pagination buttons
        if (totalPages > 1) {
            const navBtns = [];
            if (page > 0) navBtns.push(Markup.button.callback('[ ◄◄ PREV ]', `catpage_${catId}_${page - 1}`));
            if (page < totalPages - 1) navBtns.push(Markup.button.callback('[ NEXT ►► ]', `catpage_${catId}_${page + 1}`));
            buttons.push(navBtns);
        }

        buttons.push([Markup.button.callback(labels.back, 'back_to_categories')]);

        return { msg, buttons };
    };

    // Category number selected - show products in category
    bot.action(/^catnum_(.+)$/, async (ctx) => {
        const catId = ctx.match[1];
        const userId = ctx.from.id.toString();
        const lang = db.getUserLanguage(userId);

        const products = db.getProductsByCategory(catId).filter(p => p.active !== false);

        if (products.length === 0) {
            const noProducts = lang === 'en'
                ? '📭 No products available yet. Please contact admin.'
                : '📭 Produk belum tersedia. Silakan hubungi admin.';
            await ctx.answerCbQuery(noProducts, { show_alert: true });
            return;
        }

        await ctx.answerCbQuery();

        const { msg, buttons } = await buildProductPage(products, 0, lang, catId);

        await editBannerCaption(ctx, msg, {
            reply_markup: { inline_keyboard: buttons }
        });
    });

    // Product list pagination
    bot.action(/^catpage_(.+)_(\d+)$/, async (ctx) => {
        const catId = ctx.match[1];
        const page = parseInt(ctx.match[2]);
        const userId = ctx.from.id.toString();
        const lang = db.getUserLanguage(userId);

        const products = db.getProductsByCategory(catId).filter(p => p.active !== false);

        await ctx.answerCbQuery();

        const { msg, buttons } = await buildProductPage(products, page, lang, catId);

        await editBannerCaption(ctx, msg, {
            reply_markup: { inline_keyboard: buttons }
        });
    });

    // Remove legacy prodview handler since we use vertical list now
    // Product navigation (REMOVED)

    // Show product detail helper (REMOVED)

    // Remind me when restocked
    bot.action(/^remind_(.+)$/, async (ctx) => {
        const prodId = ctx.match[1];
        const userId = ctx.from.id.toString();
        const lang = db.getUserLanguage(userId);

        // Save reminder (simplified - just acknowledge for now)
        await ctx.answerCbQuery(lang === 'en' ? '🔔 You will be notified when restocked!' : '🔔 Kamu akan dinotif saat restok!');
    });

    // Back to categories
    bot.action('back_to_categories', async (ctx) => {
        const userId = ctx.from.id.toString();
        const lang = db.getUserLanguage(userId);

        const categories = db.getCategories().filter(c => c.active !== false);

        await ctx.answerCbQuery();

        const msg = generateCategoryListMsg(categories, 0, lang);
        const keyboard = generateCategoryButtons(categories, 0, lang);

        await editBannerCaption(ctx, msg, keyboard);
    });

    // Cek Stok — paginated (5 categories per page)
    const STOCK_PER_PAGE = 5;

    /**
     * Build stock data: returns array of category objects with their ready products
     */
    const buildStockData = () => {
        const categories = db.getCategories().filter(c => c.active !== false);
        const stockCategories = [];
        let totalProd = 0;

        for (const cat of categories) {
            const products = db.getProductsByCategory(cat.id).filter(p => p.active !== false);
            if (products.length === 0) continue;

            const readyProducts = products.filter(p => {
                if (p.stock_mode === 'unlimited') return true;
                return db.getAvailableStockCount(p.id) > 0;
            });

            if (readyProducts.length === 0) continue;

            stockCategories.push({ cat, readyProducts });
            totalProd += readyProducts.length;
        }

        return { stockCategories, totalCat: stockCategories.length, totalProd };
    };

    /**
     * Build stock message for a specific page
     */
    const buildStockMsg = (stockCategories, totalCat, totalProd, page, lang) => {
        const totalPages = Math.max(1, Math.ceil(stockCategories.length / STOCK_PER_PAGE));
        const start = page * STOCK_PER_PAGE;
        const pageItems = stockCategories.slice(start, start + STOCK_PER_PAGE);

        const now = new Date();
        const dateStr = now.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

        const header = lang === 'en' ? '📦 *Stock Status*' : '📦 *Status Stok*';
        const timeLabel = 'Update';
        const summaryLabel = lang === 'en'
            ? `📊 *Total: ${totalCat} Category • ${totalProd} Products Ready*`
            : `📊 *Total: ${totalCat} Kategori • ${totalProd} Produk Ready*`;

        let msg = `${header}\n🕐 _${timeLabel}: ${dateStr}_\n`;

        for (const { cat, readyProducts } of pageItems) {
            const catName = lang === 'en' ? cat.name_en : cat.name_id;
            msg += `\n*${catName}*\n`;
            for (const prod of readyProducts) {
                const stock = prod.stock_mode === 'unlimited' ? '♾' : db.getAvailableStockCount(prod.id);
                const name = lang === 'en' ? prod.name_en : prod.name_id;
                const unit = stock === '♾' ? '' : ' pcs';
                msg += `↳  ${name}: ${stock}${unit}\n`;
            }
        }

        msg += `━━━━━━━━━━━━━\n${summaryLabel}`;
        if (totalPages > 1) {
            const dots = Array.from({ length: totalPages }, (_, i) => i === page ? '●' : '○').join(' ');
            msg += `\n${dots}`;
        }

        // Buttons
        const navRow = [];
        if (page > 0) navRow.push(Markup.button.callback('👈 Prev', `stock_page_${page - 1}`));
        navRow.push(Markup.button.callback('⟳ Refresh', 'stock_refresh'));
        if (page < totalPages - 1) navRow.push(Markup.button.callback('Next 👉', `stock_page_${page + 1}`));

        const buttons = [navRow, [Markup.button.callback(lang === 'en' ? '✘ Close' : '✘ Tutup', 'stock_close')]];

        return { msg, buttons };
    };

    bot.hears(['📦 Cek Stok', '📦 Check Stock'], async (ctx) => {
        clearTopupState(ctx);
        const userId = ctx.from.id.toString();
        const lang = db.getUserLanguage(userId);

        const { stockCategories, totalCat, totalProd } = buildStockData();

        if (totalProd === 0) {
            const empty = lang === 'en' ? '📦 All products are currently out of stock.' : '📦 Semua produk sedang kosong.';
            await ctx.reply(empty);
            return;
        }

        const { msg, buttons } = buildStockMsg(stockCategories, totalCat, totalProd, 0, lang);
        await ctx.reply(msg, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: buttons } });
    });

    // Stock page navigation
    bot.action(/^stock_page_(\d+)$/, async (ctx) => {
        const page = parseInt(ctx.match[1]);
        const userId = ctx.from.id.toString();
        const lang = db.getUserLanguage(userId);

        const { stockCategories, totalCat, totalProd } = buildStockData();
        const { msg, buttons } = buildStockMsg(stockCategories, totalCat, totalProd, page, lang);

        await ctx.answerCbQuery();
        await ctx.editMessageText(msg, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: buttons } });
    });

    // Stock refresh
    bot.action('stock_refresh', async (ctx) => {
        const userId = ctx.from.id.toString();
        const lang = db.getUserLanguage(userId);

        const { stockCategories, totalCat, totalProd } = buildStockData();
        const { msg, buttons } = buildStockMsg(stockCategories, totalCat, totalProd, 0, lang);

        await ctx.answerCbQuery('⟳ Refresh');
        try {
            await ctx.editMessageText(msg, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: buttons } });
        } catch (e) { /* message unchanged */ }
    });

    // Stock close
    bot.action('stock_close', async (ctx) => {
        await ctx.answerCbQuery();
        try { await ctx.deleteMessage(); } catch (e) { }
    });

    // Riwayat Transaksi
    const HISTORY_PER_PAGE = 3;
    const MAX_HISTORY = 10;

    const buildHistoryMsg = (orders, page, lang) => {
        const totalPages = Math.ceil(orders.length / HISTORY_PER_PAGE);
        const start = page * HISTORY_PER_PAGE;
        const items = orders.slice(start, start + HISTORY_PER_PAGE);

        let msg = lang === 'en'
            ? `📜 *Transaction History*\n\n`
            : `📜 *Riwayat Transaksi*\n\n`;

        items.forEach(order => {
            const statusMap = {
                pending: '⏳ PENDING',
                paid: '💰 PAID',
                delivered: '✅ SUCCESS',
                cancelled: '❌ CANCELLED',
                expired: '⏰ EXPIRED'
            };
            const statusText = statusMap[order.status] || '❓ UNKNOWN';

            let itemName;
            if (order.product_id === 'TOPUP') {
                itemName = lang === 'en' ? 'Balance Top Up' : 'Topup Saldo';
            } else {
                const product = db.getProductById(order.product_id);
                itemName = `${product?.name_id || 'Unknown'} ×${order.quantity}`;
            }

            const priceDisplay = (lang === 'en' && order.total_usd)
                ? `$${formatUSD(order.total_usd)}`
                : `Rp ${formatIDR(order.total_idr)}`;

            msg += `╭─ \`${order.id}\`\n`;
            msg += `│ Status : ${statusText}\n`;
            msg += `│ Item   : ${itemName}\n`;
            msg += `│ Total  : ${priceDisplay}\n`;
            msg += `╰───────────────\n\n`;
        });

        msg += `📄 ${page + 1}/${totalPages}`;
        return { msg, totalPages };
    };

    bot.hears(['🧾 Riwayat', '🧾 History'], async (ctx) => {
        clearTopupState(ctx);
        const userId = ctx.from.id.toString();
        const lang = db.getUserLanguage(userId);
        const locale = require(`../locales/${lang}`);

        const orders = db.getOrdersByUser(userId).slice(0, MAX_HISTORY);

        if (orders.length === 0) {
            await ctx.reply(locale.no_transactions || (lang === 'en' ? 'No transactions yet.' : 'Belum ada transaksi.'));
            return;
        }

        const { msg, totalPages } = buildHistoryMsg(orders, 0, lang);
        const buttons = [];
        if (totalPages > 1) {
            buttons.push([
                { text: '▶ Next', callback_data: 'history_page_1' }
            ]);
        }

        await ctx.reply(msg, {
            parse_mode: 'Markdown',
            reply_markup: buttons.length ? { inline_keyboard: buttons } : undefined
        });
    });

    // History pagination
    bot.action(/^history_page_(\d+)$/, async (ctx) => {
        const page = parseInt(ctx.match[1]);
        const userId = ctx.from.id.toString();
        const lang = db.getUserLanguage(userId);
        const orders = db.getOrdersByUser(userId).slice(0, MAX_HISTORY);

        const { msg, totalPages } = buildHistoryMsg(orders, page, lang);
        const buttons = [];
        const row = [];
        if (page > 0) row.push({ text: '◀ Prev', callback_data: `history_page_${page - 1}` });
        if (page < totalPages - 1) row.push({ text: '▶ Next', callback_data: `history_page_${page + 1}` });
        if (row.length) buttons.push(row);

        await ctx.editMessageText(msg, {
            parse_mode: 'Markdown',
            reply_markup: buttons.length ? { inline_keyboard: buttons } : undefined
        });
        await ctx.answerCbQuery();
    });

    // Ganti Bahasa
    bot.hears(['🌐 Bahasa', '🌐 Language'], async (ctx) => {
        clearTopupState(ctx);
        const localeId = require('../locales/id');
        await ctx.reply(localeId.select_language, {
            parse_mode: 'Markdown',
            ...languageKeyboard()
        });
    });

    // Customer Service
    bot.hears(['📞 CS', '📞 Customer Service'], async (ctx) => {
        clearTopupState(ctx);
        const userId = ctx.from.id.toString();
        const lang = db.getUserLanguage(userId);
        const locale = require(`../locales/${lang}`);

        await ctx.reply(locale.support_message, { parse_mode: 'Markdown' });
    });

    // ==================== SALDO / BALANCE ====================

    const storeName = process.env.STORE_NAME || 'Store';

    // Saldo Menu - show balance + topup nominals directly
    bot.hears(/^💰 (Saldo|Balance)/, async (ctx) => {
        const userId = ctx.from.id.toString();
        const lang = db.getUserLanguage(userId);

        const balance = getBalance(userId);
        let balanceDisplay;
        if (lang === 'en') {
            const usd = await convertIDRtoUSD(balance);
            balanceDisplay = `$${formatUSD(usd)}`;
        } else {
            balanceDisplay = `Rp ${formatIDR(balance)}`;
        }

        topupInputStates.set(userId, true);

        const minDisplay = lang === 'en' ? '$0.06' : 'Rp 1.000';

        const msg = lang === 'en'
            ? `💰 *Your Balance at ${storeName}*\n\n💵 Your current balance: *${balanceDisplay}*\n\n📥 *Want to top up?*\n• Select a nominal below\n• Or type an amount directly (min. $0.1):`
            : `💰 *Detail Saldo Anda di ${storeName}*\n\n💵 Saldo Anda saat ini: *${balanceDisplay}*\n\n📥 *Mau isi saldo?*\n• Silakan pilih nominal dibawah ini\n• Atau langsung ketik angka (min. ${minDisplay}):`;

        await ctx.reply(msg, {
            parse_mode: 'Markdown',
            ...topupNominalKeyboard(lang)
        });
    });

    // Topup - USD nominal selected (English) → convert to IDR and confirm
    bot.action(/^topup_usd_(.+)$/, async (ctx) => {
        const usdAmount = parseFloat(ctx.match[1]);
        const userId = ctx.from.id.toString();
        const lang = db.getUserLanguage(userId);
        topupInputStates.delete(userId);

        // Convert USD to IDR
        const { convertUSDtoIDR } = require('../payments/exchange');
        const idrAmount = await convertUSDtoIDR(usdAmount);
        const roundedIDR = Math.round(idrAmount / 100) * 100; // Round to nearest 100

        await ctx.answerCbQuery();
        await showTopupConfirmation(ctx, userId, roundedIDR, lang);
    });

    // Topup - IDR nominal selected → show confirmation
    bot.action(/^topup_(5000|10000|25000|50000)$/, async (ctx) => {
        const amount = parseInt(ctx.match[1]);
        const userId = ctx.from.id.toString();
        const lang = db.getUserLanguage(userId);
        topupInputStates.delete(userId);

        await ctx.answerCbQuery();
        await showTopupConfirmation(ctx, userId, amount, lang);
    });

    // Topup cancel
    bot.action('topup_cancel', async (ctx) => {
        const userId = ctx.from.id.toString();
        const lang = db.getUserLanguage(userId);
        topupInputStates.delete(userId);
        await ctx.answerCbQuery();
        try { await ctx.deleteMessage(); } catch (e) { }

        const cancelMsg = lang === 'en' ? '❌ Top up cancelled.' : '❌ Topup dibatalkan.';
        await ctx.reply(cancelMsg, { ...mainMenuKeyboard(lang, userId) });
    });

    // Text handler for custom topup amount
    bot.on('text', async (ctx, next) => {
        const userId = ctx.from.id.toString();

        if (!topupInputStates.has(userId)) return next();

        const lang = db.getUserLanguage(userId);

        if (lang === 'en') {
            // English: accept USD input
            const input = ctx.message.text.trim().replace(/[^0-9.]/g, '');
            const usdAmount = parseFloat(input);

            if (isNaN(usdAmount) || usdAmount < 0.1) {
                // Keep state active so user can retry
                await ctx.reply('❌ Invalid amount. Minimum is $0.10.\n\nPlease type a valid amount:');
                return;
            }

            topupInputStates.delete(userId);
            const { convertUSDtoIDR } = require('../payments/exchange');
            const idrAmount = await convertUSDtoIDR(usdAmount);
            const roundedIDR = Math.round(idrAmount / 100) * 100;
            await showTopupConfirmation(ctx, userId, roundedIDR, lang);
        } else {
            // Indonesian: accept IDR input
            const input = ctx.message.text.trim().replace(/[^0-9]/g, '');
            const amount = parseInt(input);

            if (isNaN(amount) || amount < 1000) {
                // Keep state active so user can retry
                await ctx.reply('❌ Nominal tidak valid. Minimal Rp 1.000.\n\nSilakan ketik ulang nominal:');
                return;
            }

            topupInputStates.delete(userId);
            await showTopupConfirmation(ctx, userId, amount, lang);
        }
    });

    // Confirmation step - invoice style
    async function showTopupConfirmation(ctx, userId, amount, lang) {
        const currentBalance = getBalance(userId);
        const afterBalance = currentBalance + amount;

        let currentDisplay, afterDisplay;
        if (lang === 'en') {
            const curUsd = await convertIDRtoUSD(currentBalance);
            const afterUsd = await convertIDRtoUSD(afterBalance);
            currentDisplay = `$${formatUSD(curUsd)}`;
            afterDisplay = `$${formatUSD(afterUsd)}`;
        } else {
            currentDisplay = `Rp ${formatIDR(currentBalance)}`;
            afterDisplay = `Rp ${formatIDR(afterBalance)}`;
        }

        let nominalDisplay;
        if (lang === 'en') {
            const nominalUsd = await convertIDRtoUSD(amount);
            nominalDisplay = `$${formatUSD(nominalUsd)}`;
        } else {
            nominalDisplay = `Rp ${formatIDR(amount)}`;
        }

        const msg = lang === 'en'
            ? `🧾 *INVOICE TOPUP*\n\n━━━━━━━━━━━━━━\n💰 *Nominal :* ${nominalDisplay}\n📱 *Method  :* QRIS\n💵 *Balance :* ${currentDisplay} → ${afterDisplay}\n━━━━━━━━━━━━━━`
            : `🧾 *INVOICE TOPUP*\n\n━━━━━━━━━━━━━━\n💰 *Nominal :* ${nominalDisplay}\n📱 *Metode  :* QRIS\n💵 *Saldo   :* ${currentDisplay} → ${afterDisplay}\n━━━━━━━━━━━━━━`;

        try { await ctx.deleteMessage(); } catch (e) { }

        await ctx.reply(msg, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: lang === 'en' ? '✅ Pay Now' : '✅ Bayar Sekarang', callback_data: `topup_confirm_${amount}` }],
                    [{ text: lang === 'en' ? '◀️ Back' : '◀️ Kembali', callback_data: 'saldo_back_new' }]
                ]
            }
        });
    }

    // Confirmed - now create QRIS
    bot.action(/^topup_confirm_(\d+)$/, async (ctx) => {
        const amount = parseInt(ctx.match[1]);
        const userId = ctx.from.id.toString();
        const lang = db.getUserLanguage(userId);

        await ctx.answerCbQuery(lang === 'en' ? 'Creating QRIS...' : 'Membuat QRIS...');
        await processTopup(ctx, userId, amount, lang);
    });

    // Deposit History
    bot.action('saldo_history', async (ctx) => {
        const userId = ctx.from.id.toString();
        const lang = db.getUserLanguage(userId);
        await ctx.answerCbQuery();

        const history = getBalanceHistory(userId, 10);
        const balance = getBalance(userId);

        let balanceDisplay;
        if (lang === 'en') {
            const usd = await convertIDRtoUSD(balance);
            balanceDisplay = `$${formatUSD(usd)}`;
        } else {
            balanceDisplay = `Rp ${formatIDR(balance)}`;
        }

        if (history.length === 0) {
            const emptyMsg = lang === 'en'
                ? `📜 *Deposit History*\n\n📭 No history yet.\n\n💰 Balance: ${balanceDisplay}`
                : `📜 *Riwayat Deposit*\n\n📭 Belum ada riwayat.\n\n💰 Saldo: ${balanceDisplay}`;
            await ctx.editMessageText(emptyMsg, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [[{ text: lang === 'en' ? '◀️ Back' : '◀️ Kembali', callback_data: 'saldo_back' }]]
                }
            });
            return;
        }

        const title = lang === 'en' ? '📜 *Deposit History*\n' : '📜 *Riwayat Deposit*\n';
        let msg = title;

        history.forEach(h => {
            const icon = h.amount >= 0 ? '➕' : '➖';
            const absAmount = Math.abs(h.amount);
            const date = new Date(h.created_at).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
            msg += `\n${icon} Rp ${formatIDR(absAmount)} — ${date}`;
            if (h.note) msg += `\n    _${h.note}_`;
        });

        msg += `\n\n💰 ${lang === 'en' ? 'Balance' : 'Saldo'}: ${balanceDisplay}`;

        await ctx.editMessageText(msg, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [[{ text: lang === 'en' ? '◀️ Back' : '◀️ Kembali', callback_data: 'saldo_back' }]]
            }
        });
    });

    // Back to saldo menu from history
    bot.action('saldo_back', async (ctx) => {
        const userId = ctx.from.id.toString();
        const lang = db.getUserLanguage(userId);
        await ctx.answerCbQuery();

        const balance = getBalance(userId);
        let balanceDisplay;
        if (lang === 'en') {
            const usd = await convertIDRtoUSD(balance);
            balanceDisplay = `$${formatUSD(usd)}`;
        } else {
            balanceDisplay = `Rp ${formatIDR(balance)}`;
        }

        topupInputStates.set(userId, true);

        const minDisplay = lang === 'en' ? '$0.06' : 'Rp 1.000';

        const msg = lang === 'en'
            ? `💰 *Your Balance at ${storeName}*\n\n💵 Your current balance: *${balanceDisplay}*\n\n📥 *Want to top up?*\n• Select a nominal below\n• Or type an amount directly (min. $0.1):`
            : `💰 *Detail Saldo Anda di ${storeName}*\n\n💵 Saldo Anda saat ini: *${balanceDisplay}*\n\n📥 *Mau isi saldo?*\n• Silakan pilih nominal dibawah ini\n• Atau langsung ketik angka (min. ${minDisplay}):`;

        await ctx.editMessageText(msg, {
            parse_mode: 'Markdown',
            ...topupNominalKeyboard(lang)
        });
    });

    // Back to saldo menu from confirmation (uses reply since confirmation was a new message)
    bot.action('saldo_back_new', async (ctx) => {
        const userId = ctx.from.id.toString();
        const lang = db.getUserLanguage(userId);
        await ctx.answerCbQuery();

        const balance = getBalance(userId);
        let balanceDisplay;
        if (lang === 'en') {
            const usd = await convertIDRtoUSD(balance);
            balanceDisplay = `$${formatUSD(usd)}`;
        } else {
            balanceDisplay = `Rp ${formatIDR(balance)}`;
        }

        topupInputStates.set(userId, true);

        const minDisplay = lang === 'en' ? '$0.06' : 'Rp 1.000';

        const msg = lang === 'en'
            ? `💰 *Your Balance at ${storeName}*\n\n💵 Your current balance: *${balanceDisplay}*\n\n📥 *Want to top up?*\n• Select a nominal below\n• Or type an amount directly (min. $0.1):`
            : `💰 *Detail Saldo Anda di ${storeName}*\n\n💵 Saldo Anda saat ini: *${balanceDisplay}*\n\n📥 *Mau isi saldo?*\n• Silakan pilih nominal dibawah ini\n• Atau langsung ketik angka (min. ${minDisplay}):`;

        try { await ctx.deleteMessage(); } catch (e) { }
        await ctx.reply(msg, {
            parse_mode: 'Markdown',
            ...topupNominalKeyboard(lang)
        });
    });
    bot.action(/^topup_check_(.+)$/, async (ctx) => {
        const topupId = ctx.match[1];
        const userId = ctx.from.id.toString();
        const lang = db.getUserLanguage(userId);

        await ctx.answerCbQuery(lang === 'en' ? 'Checking...' : 'Mengecek...');

        // Check QRIS status
        const topupOrder = db.getOrderById(topupId);
        if (!topupOrder) return;

        const result = await checkQRISStatus(topupId, topupOrder.total_idr);

        if (result.success && result.status === 'completed') {
            // Add balance
            addBalance(userId, topupOrder.total_idr, 'qris', `Topup via QRIS`, topupId);
            db.updateOrder(topupId, { status: 'delivered', paid_at: new Date().toISOString() });

            try { await ctx.deleteMessage(); } catch (e) { }

            const balance = getBalance(userId);
            let balanceDisplay = lang === 'en'
                ? `$${formatUSD(await convertIDRtoUSD(balance))}`
                : `Rp ${formatIDR(balance)}`;

            const topupAmtDisplay = lang === 'en'
                ? `$${formatUSD(await convertIDRtoUSD(topupOrder.total_idr))}`
                : `Rp ${formatIDR(topupOrder.total_idr)}`;

            const successMsg = lang === 'en'
                ? `✅ *Top Up Successful!*\n\n💰 +${topupAmtDisplay}\n💵 New balance: ${balanceDisplay}`
                : `✅ *Topup Berhasil!*\n\n💰 +${topupAmtDisplay}\n💵 Saldo baru: ${balanceDisplay}`;

            await ctx.reply(successMsg, { parse_mode: 'Markdown', ...mainMenuKeyboard(lang, userId) });

            // Notify admin
            try {
                await notifyAdmins(ctx.telegram,
                    `💰 *TOPUP SALDO*\n\n👤 User: \`${userId}\`\n💵 Amount: Rp ${formatIDR(topupOrder.total_idr)}\n📦 ID: \`${topupId}\``,
                    { parse_mode: 'Markdown' }
                );
            } catch (e) { }
        } else if (result.success && result.status === 'expired') {
            try { await ctx.deleteMessage(); } catch (e) { }
            db.updateOrder(topupId, { status: 'expired' });
            const expMsg = lang === 'en' ? '❌ Topup invoice expired. Please try again.' : '❌ Invoice topup kedaluwarsa. Silakan coba lagi.';
            await ctx.reply(expMsg, { ...mainMenuKeyboard(lang, userId) });
        } else {
            const pendingMsg = lang === 'en'
                ? '⏳ Payment not detected yet. Please wait a moment after paying.'
                : '⏳ Belum ada pembayaran masuk. Mohon tunggu sebentar setelah membayar.';
            await ctx.answerCbQuery(pendingMsg, { show_alert: true });
        }
    });

    // Topup cancel order
    bot.action(/^topup_cancel_order_(.+)$/, async (ctx) => {
        const topupId = ctx.match[1];
        const userId = ctx.from.id.toString();
        const lang = db.getUserLanguage(userId);

        await ctx.answerCbQuery();
        await cancelOrder(topupId);

        const msg = lang === 'en' ? '❌ Top up cancelled.' : '❌ Topup dibatalkan.';
        await ctx.reply(msg, { ...mainMenuKeyboard(lang, userId) });
    });

    /**
     * Process topup - generate QRIS and show to user
     */
    async function processTopup(ctx, userId, amount, lang) {
        // Convert to USD for display
        const usdAmount = await convertIDRtoUSD(amount);

        // Create a topup order in DB
        const topupOrder = db.createOrder({
            user_id: userId,
            product_id: 'TOPUP',
            quantity: 1,
            total_idr: amount,
            total_usd: parseFloat(usdAmount.toFixed(2)),
            payment_method: 'qris',
            chat_id: ctx.chat.id,
            status: 'pending',
            expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString()
        });

        // Create QRIS payment
        const qrisResult = await createQRISPayment(topupOrder.id, amount);

        if (!qrisResult.success) {
            try { await ctx.deleteMessage(); } catch (e) { }
            const errMsg = lang === 'en'
                ? '❌ Failed to create QRIS. Please try again.'
                : '❌ Gagal membuat QRIS. Silakan coba lagi.';
            await ctx.reply(errMsg, { ...mainMenuKeyboard(lang, userId) });
            return;
        }

        let amountDisplay;
        if (lang === 'en') {
            const amtUsd = await convertIDRtoUSD(amount);
            amountDisplay = `$${formatUSD(amtUsd)}`;
        } else {
            amountDisplay = `Rp ${formatIDR(amount)}`;
        }

        const title = lang === 'en' ? '📥 *TOP UP BALANCE*' : '📥 *TOPUP SALDO*';
        const message = `${title}\n\n💰 *Amount:* ${amountDisplay}\n🆔 *ID:* \`${topupOrder.id}\`\n⏰ *${lang === 'en' ? 'Valid for' : 'Berlaku'}:* 15 ${lang === 'en' ? 'minutes' : 'menit'}\n\n⏳ ${lang === 'en' ? 'Waiting for QRIS payment...' : 'Menunggu pembayaran QRIS...'}`;

        try { await ctx.deleteMessage(); } catch (e) { }

        let sentMsg;
        try {
            const { generateQRISTwibbon } = require('../utils/qris_twibbon');
            const qrImageUrl = generateQRImageUrl(qrisResult.data.qris_string);
            const twibbonBuffer = await generateQRISTwibbon(qrImageUrl);
            sentMsg = await ctx.replyWithPhoto({ source: twibbonBuffer }, {
                caption: message,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: lang === 'en' ? '🔄 Check Status' : '🔄 Cek Status', callback_data: `topup_check_${topupOrder.id}` }],
                        [{ text: lang === 'en' ? '❌ Cancel' : '❌ Batal', callback_data: `topup_cancel_order_${topupOrder.id}` }]
                    ]
                }
            });
        } catch (e) {
            const qrImageUrl = generateQRImageUrl(qrisResult.data.qris_string);
            sentMsg = await ctx.replyWithPhoto(qrImageUrl, {
                caption: message,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: lang === 'en' ? '🔄 Check Status' : '🔄 Cek Status', callback_data: `topup_check_${topupOrder.id}` }],
                        [{ text: lang === 'en' ? '❌ Cancel' : '❌ Batal', callback_data: `topup_cancel_order_${topupOrder.id}` }]
                    ]
                }
            });
        }

        db.updateOrder(topupOrder.id, {
            message_id: sentMsg.message_id,
            pakasir_data: qrisResult.data
        });
    }
};

module.exports = { registerKeyboardHandler };
