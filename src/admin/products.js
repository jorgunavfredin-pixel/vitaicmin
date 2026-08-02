/**
 * Admin — Category, Product, Stock Management + Product Stats
 * Extracted from panel.js
 */
const { Markup } = require('telegraf');
const db = require('../models/db');
const { formatIDR, entitiesToHtml, safeHtmlSnk, escapeHtml } = require('../utils/helpers');
const { normalizeBulkTiers } = require('../utils/bulkPricing');
const {
    categoryListKeyboard,
    categoryViewKeyboard,
    categoryDeleteConfirmKeyboard,
    productListKeyboard,
    productViewKeyboard,
    productStockTypeKeyboard,
    stockManageKeyboard,
    stockRemoveKeyboard,
    stockClearConfirmKeyboard,
    navButtons,
    cancelButton
} = require('../utils/keyboard');

// Helper to parse qty discount tiers from JSON string
function parseDiscountTiers(raw, basePrice = 0) {
    return normalizeBulkTiers(raw, basePrice);
}

const sortByNameId = (items) => [...items].sort((a, b) =>
    String(a.name_id || '').localeCompare(String(b.name_id || ''), 'id', { sensitivity: 'base', numeric: true })
);

const stockBackContext = new Map();
const stockContextKey = (ctx, prodId) => `${ctx.from.id}:${ctx.chat?.id ?? ''}:${prodId}`;

const renderProductSummary = (prod) => {
    const stock = db.getStockSummary(prod.id);
    const status = prod.active !== false ? '✅ Aktif' : '⏸ Nonaktif';
    const category = db.getCategories().find(c => c.id === prod.category_id);
    const typeLabels = { code: '🔑 Code', email_pass: '📧 Email|Pass', email_pass_key: '📧 Email|Pass|Key', vcc: '💳 VCC', custom: '✨ Custom' };
    const tiers = parseDiscountTiers(prod.qty_discounts, prod.price_idr);
    let text = `<blockquote>📦 <b>${escapeHtml(prod.name_id || '-')}</b></blockquote>\n` +
        `<b>English:</b> ${escapeHtml(prod.name_en || '-')}\n` +
        `<b>Kategori:</b> ${escapeHtml(category?.name_id || '-')} / ${escapeHtml(category?.name_en || '-')}\n` +
        `<b>Harga:</b> Rp ${formatIDR(prod.price_idr)}\n` +
        `<b>Stok:</b> ${stock.ready} ready · ${stock.reserved} reserved · ${stock.sold} terjual\n` +
        `<b>Status:</b> ${status}\n<b>Tipe stok:</b> ${typeLabels[prod.stock_type] || escapeHtml(prod.stock_type || '-')}\n` +
        `<b>Format S&amp;K:</b> ${escapeHtml(prod.terms_format || 'markdown')}`;
    text += `\n<b>Grosir:</b> ${tiers.length ? '✅' : '❌'}`;
    tiers.forEach(t => { text += t.type === 'fixed_price' ? `\n  ↳ ${t.min_qty}+ pcs: Rp ${formatIDR(t.price)}/pcs` : `\n  ↳ ${t.min_qty}+ pcs: ${t.percent}%`; });
    if (prod.flash_price && prod.flash_end) {
        const slots = db.getFlashSaleSlotStats(prod);
        text += `\n<b>Flash:</b> Rp ${formatIDR(prod.flash_price)} · sampai ${escapeHtml(prod.flash_end)}`;
        if (slots.limited) text += `\n  ↳ Slot: ${slots.used}/${slots.max} dipakai · ${slots.held} ditahan · ${slots.remaining} tersisa`;
    }
    return text;
};

function registerProductHandlers(bot, { isAdmin, adminStates }) {

    // ==================== KATEGORI ====================

    bot.action(/^adm_cat$|^adm_cat_page_(\d+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        await ctx.answerCbQuery();

        const page = ctx.match[1] ? parseInt(ctx.match[1]) : 1;
        const categories = db.getCategories();

        await ctx.editMessageText('📦 *Manajemen Kategori*\n\nPilih kategori atau tambah baru:', {
            parse_mode: 'Markdown',
            ...categoryListKeyboard(categories, page)
        });
    });

    // View category
    bot.action(/^adm_cat_view_(.+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        const catId = ctx.match[1];
        await ctx.answerCbQuery();

        const cat = db.getCategories().find(c => c.id === catId);
        if (!cat) return;

        const products = db.getProductsByCategory(catId);
        await ctx.editMessageText(`<blockquote>📁 <b>${escapeHtml(cat.name_id || '-')}</b></blockquote>
<b>English:</b> ${escapeHtml(cat.name_en || '-')}
<b>Produk:</b> ${products.length}

Pilih aksi:`, {
            parse_mode: 'HTML',
            ...categoryViewKeyboard(catId)
        });
    });

    // Add category
    bot.action('adm_cat_add', async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        await ctx.answerCbQuery();

        adminStates.setFor(ctx, { action: 'add_category', step: 'name_id' });

        await ctx.editMessageText('➕ *Tambah Kategori*\n\nKirim nama kategori:', {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: cancelButton() }
        });
    });

    // Edit category name
    bot.action(/^adm_cat_edit_name_(.+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        const catId = ctx.match[1];
        await ctx.answerCbQuery();

        adminStates.setFor(ctx, { action: 'edit_cat_name', catId, step: 'name_id' });

        await ctx.editMessageText('✏️ *Edit Nama*\n\nKirim nama baru (Bahasa Indonesia):', {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: cancelButton() }
        });
    });


    // Delete category - step 1
    bot.action(/^adm_cat_del_(.+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        const catId = ctx.match[1];
        await ctx.answerCbQuery();

        const cat = db.getCategories().find(c => c.id === catId);
        if (!cat) {
            await ctx.reply('❌ Kategori tidak ditemukan (mungkin sudah dihapus).', {
                reply_markup: { inline_keyboard: navButtons('adm_cat') }
            });
            return;
        }

        const products = db.getProductsByCategory(catId);

        await ctx.editMessageText(`⚠️ *Hapus Kategori "${cat.name_id}"?*

${products.length > 0 ? `◼ Kategori ini punya ${products.length} produk.` : 'Kategori ini kosong.'}`, {
            parse_mode: 'Markdown',
            ...categoryDeleteConfirmKeyboard(catId, products.length > 0)
        });
    });

    // Delete category - confirm
    bot.action(/^adm_cat_fixdel_(.+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        const catId = ctx.match[1];
        if (db.getProductsByCategory(catId).length > 0) {
            await ctx.answerCbQuery('Pindahkan produk terlebih dahulu.', { show_alert: true });
            return;
        }
        await ctx.answerCbQuery();
        db.deleteCategory(catId);

        await ctx.editMessageText('✅ Kategori berhasil dihapus!', {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: navButtons('adm_cat') }
        });
    });

    // Move products selection
    bot.action(/^adm_cat_move_products_(.+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        const sourceCatId = ctx.match[1];
        await ctx.answerCbQuery();

        const categories = db.getCategories().filter(c => c.id !== sourceCatId && c.active !== false);

        if (categories.length === 0) {
            await ctx.reply('❌ Tidak ada kategori lain untuk memindahkan produk.', {
                reply_markup: { inline_keyboard: navButtons(`adm_cat_del_${sourceCatId}`) }
            });
            return;
        }

        const buttons = categories.map(c => [
            Markup.button.callback(`📎 Pindah ke: ${c.name_id}`, `adm_cat_do_move_${sourceCatId}_${c.id}`)
        ]);
        buttons.push([Markup.button.callback('❌ Batal', `adm_cat_del_${sourceCatId}`)]);

        await ctx.editMessageText('📦 *Pilih Kategori Tujuan*\n\nSemua produk akan dipindahkan ke kategori yang dipilih:', {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: buttons }
        });
    });

    // Execute move products
    bot.action(/^adm_cat_do_move_(.+)_(.+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        const sourceCatId = ctx.match[1];
        const targetCatId = ctx.match[2];
        await ctx.answerCbQuery();

        const result = db.moveProductsAndDeleteCategory(sourceCatId, targetCatId);
        if (!result.ok) return ctx.answerCbQuery('Gagal memindahkan kategori', { show_alert: true });
        const products = { length: result.moved };
        const targetCat = db.getCategories().find(c => c.id === targetCatId);

        await ctx.editMessageText(`✅ ${products.length} produk dipindahkan ke "${targetCat?.name_id || 'Target'}"\n✅ Kategori lama dihapus.`, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: navButtons('adm_cat') }
        });
    });

    // ==================== PRODUK ====================

    bot.action(/^adm_prod_cat_(.+)$|^adm_prod_page_(.+)_(\d+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        await ctx.answerCbQuery();

        let catId, page;
        if (ctx.match[2]) {
            catId = ctx.match[2];
            page = parseInt(ctx.match[3]);
        } else {
            catId = ctx.match[1];
            page = 1;
        }

        const cat = db.getCategories().find(c => c.id === catId);
        const products = sortByNameId(db.getProductsByCategory(catId)).map(p => ({
            ...p,
            stockCount: db.getAvailableStockCount(p.id)
        }));

        if (!cat) {
            await ctx.editMessageText('❌ Kategori tidak ditemukan.', { reply_markup: { inline_keyboard: navButtons('adm_prod') } });
            return;
        }
        await ctx.editMessageText(`<blockquote>📦 <b>Produk: ${escapeHtml(cat.name_id || '-')}</b></blockquote>\n<b>Total:</b> ${products.length} produk`, {
            parse_mode: 'HTML',
            ...productListKeyboard(products, catId, page)
        });
    });

    // Produk from main menu
    bot.action('adm_prod', async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        await ctx.answerCbQuery();

        const categories = sortByNameId(db.getCategories());
        if (categories.length === 0) {
            await ctx.editMessageText('❌ Belum ada kategori. Tambah kategori dulu.', {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: navButtons('admin_home') }
            });
            return;
        }

        const buttons = categories.map(cat => {
            const prodCount = db.getProductsByCategory(cat.id).length;
            return [Markup.button.callback(`📁 ${cat.name_id} (${prodCount})`, `adm_prod_cat_${cat.id}`)];
        });
        buttons.push(...navButtons('admin_home'));

        await ctx.editMessageText('📦 *Kelola Produk*\n\nPilih kategori:', {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: buttons }
        });
    });

    // View product
    bot.action(/^adm_prod_view_(.+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        const prodId = ctx.match[1];
        await ctx.answerCbQuery();

        const prod = db.getProductById(prodId);
        if (!prod) return;

        const h = (s) => escapeHtml(s || '-');
        await ctx.editMessageText(`${renderProductSummary(prod)}
<b>Deskripsi ID:</b> ${h(prod.description_id)}
<b>Deskripsi EN:</b> ${h(prod.description_en)}
<b>S&amp;K ID:</b> ${safeHtmlSnk(prod.terms_id, prod.terms_format === 'html')}
<b>S&amp;K EN:</b> ${safeHtmlSnk(prod.terms_en, prod.terms_format === 'html')}`, {
            parse_mode: 'HTML',
            ...productViewKeyboard(prodId, prod.category_id, prod)
        });
    });

    // Add product
    bot.action(/^adm_prod_add_(.+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        const catId = ctx.match[1];
        await ctx.answerCbQuery();

        adminStates.setFor(ctx, {
            action: 'add_product',
            catId,
            step: 'name_id',
            data: { category_id: catId }
        });

        await ctx.editMessageText('➕ *Tambah Produk*\n\n*Step 1/4:* Kirim nama produk (ID):', {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: cancelButton() }
        });
    });

    // Edit product fields
    bot.action(/^adm_prod_edit_name_(.+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        const prodId = ctx.match[1];
        await ctx.answerCbQuery();

        adminStates.setFor(ctx, { action: 'edit_prod', prodId, field: 'name', step: 'name_id' });

        await ctx.editMessageText('📦 *Edit Nama*\n\nKirim nama baru (ID):', {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: cancelButton() }
        });
    });

    bot.action(/^adm_prod_edit_price_(.+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        const prodId = ctx.match[1];
        await ctx.answerCbQuery();

        adminStates.setFor(ctx, { action: 'edit_prod', prodId, field: 'price' });

        await ctx.editMessageText('💰 *Edit Harga*\n\nKirim harga baru (angka Rupiah):', {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: cancelButton() }
        });
    });

    bot.action(/^adm_prod_edit_desc_(.+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        const prodId = ctx.match[1];
        await ctx.answerCbQuery();

        adminStates.setFor(ctx, { action: 'edit_prod', prodId, field: 'desc', step: 'desc_id' });

        await ctx.editMessageText('📌 *Edit Deskripsi*\n\nKirim deskripsi baru (ID):', {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: cancelButton() }
        });
    });

    bot.action(/^adm_prod_edit_snk_(.+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        const prodId = ctx.match[1];
        await ctx.answerCbQuery();

        adminStates.setFor(ctx, { action: 'edit_prod', prodId, field: 'snk', step: 'snk_id' });

        await ctx.editMessageText('📜 *Edit S&K*\n\nKirim S&K baru (ID):', {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: cancelButton() }
        });
    });

    // Discount Qty setting
    bot.action(/^adm_prod_discount_(.+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        const prodId = ctx.match[1];
        await ctx.answerCbQuery();

        const prod = db.getProductById(prodId);
        const currentTiers = parseDiscountTiers(prod?.qty_discounts);
        let currentInfo = 'Belum ada diskon';
        if (currentTiers.length > 0) {
            currentInfo = currentTiers.map(t => `• ${t.min_qty}+ pcs: ${t.percent}%`).join('\n');
        }

        await ctx.editMessageText(`💰 *Diskon Bulk Order*\n\nDiskon saat ini:\n${currentInfo}\n\n📝 Kirim tier diskon (satu per baris):\nFormat: \`min\_qty:persen\`\n\nContoh:\n\`\`\`\n2:10\n5:20\n10:30\`\`\`\nArtinya:\n• Beli 2+ pcs → diskon 10%\n• Beli 5+ pcs → diskon 20%\n• Beli 10+ pcs → diskon 30%\n\nKirim \`0\` untuk matikan diskon.`, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[Markup.button.callback('❌ Cancel', `adm_prod_view_${prodId}`)]] }
        });

        adminStates.setFor(ctx, { action: 'edit_prod', prodId, field: 'discount' });
    });

    // Stock type selection
    bot.action(/^adm_prod_edit_stocktype_(.+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        const prodId = ctx.match[1];
        await ctx.answerCbQuery();

        const prod = db.getProductById(prodId);
        const currentType = prod?.stock_type || 'email_pass';

        await ctx.editMessageText(`📋 *Pilih Tipe Stok:*\n\nTipe saat ini: *${currentType}*`, {
            parse_mode: 'Markdown',
            ...productStockTypeKeyboard(prodId)
        });
    });

    bot.action(/^adm_prod_setstocktype_(\d)_(.+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        const typeNum = ctx.match[1];
        const prodId = ctx.match[2];
        const types = { '1': 'code', '2': 'email_pass', '3': 'email_pass_key', '4': 'vcc', '5': 'custom' };
        const type = types[typeNum] || 'email_pass';

        db.updateProduct(prodId, { stock_type: type });
        await ctx.answerCbQuery(`✅ Tipe stok: ${type}`);

        const prod = db.getProductById(prodId);
        if (!prod) return;
        await showProductView(ctx, prodId, prod);
    });

    // Toggle product status
    bot.action(/^adm_prod_toggle_(.+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        const prodId = ctx.match[1];

        const prod = db.getProductById(prodId);
        const newStatus = prod.active === false ? true : false;
        db.updateProduct(prodId, { active: newStatus });

        await ctx.answerCbQuery(newStatus ? '✅ Produk diaktifkan' : '⏸ Produk dinonaktifkan');
        await showProductView(ctx, prodId, db.getProductById(prodId));
    });

    // Delete product
    bot.action(/^adm_prod_del_(.+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        const prodId = ctx.match[1];
        await ctx.answerCbQuery();

        const prod = db.getProductById(prodId);

        if (!prod) return ctx.answerCbQuery('Produk tidak ditemukan', { show_alert: true });

        await ctx.editMessageText(`⚠️ *Hapus/Arsip Produk "${prod.name_id}"?*\n\nProduk dengan histori akan dinonaktifkan. Hard-delete hanya untuk produk baru tanpa histori.`, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [Markup.button.callback('✅ Ya, Hapus', `adm_prod_fixdel_${prodId}`)],
                    [Markup.button.callback('❌ Batal', `adm_prod_view_${prodId}`)]
                ]
            }
        });
    });

    bot.action(/^adm_prod_fixdel_(.+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        const prodId = ctx.match[1];

        const prod = db.getProductById(prodId);
        const catId = prod?.category_id;

        const result = db.deleteProduct(prodId);
        const message = !result.ok ? '❌ Produk masih dipakai order/reservasi aktif.'
            : result.archived ? '✅ Produk memiliki histori dan berhasil diarsipkan.' : '✅ Produk baru berhasil dihapus permanen.';
        await ctx.answerCbQuery(result.ok ? '✅ Selesai' : '❌ Ditolak');
        await ctx.editMessageText(message, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: navButtons(`adm_prod_cat_${catId}`) }
        });
    });

    // Preview product
    bot.action(/^adm_prod_preview_(.+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        const prodId = ctx.match[1];
        await ctx.answerCbQuery();

        const prod = db.getProductById(prodId);
        const stock = db.getAvailableStockCount(prodId);

        const preview = `👤 *PREVIEW (tampilan user)*

⚙️ *${prod.name_id}*

📌 ${prod.description_id || 'Tidak ada deskripsi'}

💰 Harga: Rp ${formatIDR(prod.price_idr)}
📦 Stok: ${prod.stock_mode === 'unlimited' ? 'Tersedia' : stock}

📜 *S&K:*
${prod.terms_id || '-'}`;

        await ctx.editMessageText(preview, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: navButtons(`adm_prod_view_${prodId}`) }
        });
    });

    // ==================== STOK ====================

    bot.action('adm_stock', async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        await ctx.answerCbQuery();

        const categories = sortByNameId(db.getCategories());
        const buttons = categories.map(cat => {
            const products = db.getProductsByCategory(cat.id);
            const totalStock = products.reduce((sum, p) => sum + db.getAvailableStockCount(p.id), 0);
            return [Markup.button.callback(`📁 ${cat.name_id} [${totalStock} ready]`, `adm_stock_cat_${cat.id}`)];
        });
        buttons.push(...navButtons('admin_home'));

        await ctx.editMessageText('🧾 *Kelola Stok*\n\nPilih kategori:', {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: buttons }
        });
    });

    bot.action(/^adm_stock_cat_(.+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        const catId = ctx.match[1];
        await ctx.answerCbQuery();

        const cat = db.getCategories().find(c => c.id === catId);
        if (!cat) {
            await ctx.editMessageText('❌ Kategori tidak ditemukan.', { reply_markup: { inline_keyboard: navButtons('adm_stock') } });
            return;
        }
        const products = sortByNameId(db.getProductsByCategory(catId));

        const buttons = products.map(p => {
            const summary = db.getStockSummary(p.id);
            return [Markup.button.callback(`${p.name_id} [${summary.ready} ready]`, `adm_stock_prod_${p.id}_sc`)];
        });
        buttons.push(...navButtons('adm_stock'));

        await ctx.editMessageText(`🧾 *Stok: ${cat?.name_id}*\n\nPilih produk:`, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: buttons }
        });
    });

    bot.action(/^adm_stock_prod_(.+?)(?:_(sc|pv))?$/, async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        const prodId = ctx.match[1];
        const origin = ctx.match[2];
        await ctx.answerCbQuery();

        const prod = db.getProductById(prodId);
        if (!prod) {
            await ctx.editMessageText('❌ Produk tidak ditemukan.', { reply_markup: { inline_keyboard: navButtons('adm_stock') } });
            return;
        }
        const summary = db.getStockSummary(prodId);
        const contextKey = stockContextKey(ctx, prodId);
        if (origin === 'sc') stockBackContext.set(contextKey, `adm_stock_cat_${prod.category_id}`);
        else if (origin === 'pv') stockBackContext.set(contextKey, `adm_prod_view_${prodId}`);
        const backCallback = stockBackContext.get(contextKey) || `adm_prod_view_${prodId}`;

        await ctx.editMessageText(`<blockquote>🧰 <b>Stok: ${escapeHtml(prod.name_id)}</b></blockquote>
📦 <b>Ready:</b> ${summary.ready}
⏳ <b>Reserved:</b> ${summary.reserved}
✅ <b>Terjual:</b> ${summary.sold}`, {
            parse_mode: 'HTML',
            ...stockManageKeyboard(prodId, backCallback)
        });
    });

    // Add stock
    bot.action(/^adm_stock_add_(.+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        const prodId = ctx.match[1];
        await ctx.answerCbQuery();

        const prod = db.getProductById(prodId);
        const typeHint = {
            'code': '1 kode per baris\n\n' +
                'Contoh input:\n' +
                'ABC123\nDEF456\n\n' +
                'Hasil ke buyer:\n' +
                '🔑 Code: ABC123',
            'email_pass': 'Email|Password per baris\n\n' +
                'Contoh input:\n' +
                'akun@gmail.com|password123\n\n' +
                'Hasil ke buyer:\n' +
                '📧 Email: akun@gmail.com\n' +
                '🔐 Password: password123',
            'email_pass_key': 'Email|Password|Key per baris\n\n' +
                'Contoh input:\n' +
                'akun@gmail.com|pass123|XXXX-YYYY-ZZZZ\n\n' +
                'Hasil ke buyer:\n' +
                '📧 Email: akun@gmail.com\n' +
                '🔐 Password: pass123\n' +
                '🔑 Key: XXXX-YYYY-ZZZZ',
            'vcc': 'Card|Expiry|CVV per baris\n\n' +
                'Contoh input:\n' +
                '5388 4105 3549 8168|02/34|004\n\n' +
                'Hasil ke buyer:\n' +
                '💳 Card: 5388 4105 3549 8168\n' +
                '📅 Expiry: 02/34\n' +
                '🔒 CVV: 004',
            'custom': 'Format bebas, include emoji & label. 1 Akun 1 Baris\n' +
                'Pisah tiap field pakai |\n\n' +
                'Contoh input:\n' +
                '👤 Profil: akun1|🔑 Pass: 123|🔗 Link: url.com\n\n' +
                'Hasil ke buyer:\n' +
                '--Akun 1--\n' +
                '👤 Profil: akun1\n' +
                '🔑 Pass: 123\n' +
                '🔗 Link: url.com'
        };

        adminStates.setFor(ctx, { action: 'add_stock', prodId });

        await ctx.editMessageText(`➕ Tambah Stok

📦 Produk: ${prod.name_id}
📝 Format: ${typeHint[prod.stock_type] || 'satu item per baris'}

Kirim data stok (bisa multi-line):`, {
            reply_markup: { inline_keyboard: cancelButton() }
        });
    });

    // View stock
    bot.action(/^adm_stock_view_(.+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        const prodId = ctx.match[1];
        await ctx.answerCbQuery();

        const stock = db.getUnsoldUnreservedStock(prodId);

        if (stock.length === 0) {
            await ctx.editMessageText('📦 Tidak ada stok tersedia.', {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: navButtons(`adm_stock_prod_${prodId}`) }
            });
            return;
        }
        // Safe truncate: respects full emoji codepoints (Array.from splits by codepoint, not UTF-16)
        const safeTruncate = (str, maxLen) => {
            const s = String(str || '').replace(/`/g, "'");
            const chars = Array.from(s); // properly split by codepoint
            if (chars.length > maxLen) return chars.slice(0, maxLen).join('') + '...';
            return s;
        };

        let msg = `📝 *Daftar Stok* (${stock.length} item)\n\n`;
        stock.slice(0, 15).forEach((s, i) => {
            const preview = safeTruncate(s.data, 30);
            msg += `${i + 1}. \`${preview || '(empty)'}\`\n`;
        });

        if (stock.length > 15) {
            msg += `\n... dan ${stock.length - 15} lainnya`;
        }

        try {
            await ctx.editMessageText(msg, {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: navButtons(`adm_stock_prod_${prodId}`) }
            });
        } catch (sendErr) {
            // Last resort: strip ALL non-ASCII except newlines
            let safeMsg = `📝 Daftar Stok (${stock.length} item)\n\n`;
            stock.slice(0, 15).forEach((s, i) => {
                const ascii = String(s.data || '').replace(/[^\x20-\x7E\n]/g, '');
                const prev = ascii.length > 25 ? ascii.substring(0, 25) + '...' : ascii;
                safeMsg += `${i + 1}. ${prev || '(data)'}\n`;
            });
            await ctx.editMessageText(safeMsg, {
                reply_markup: { inline_keyboard: navButtons(`adm_stock_prod_${prodId}`) }
            });
        }
    });

    // Remove stock menu
    bot.action(/^adm_stock_remove_(.+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        const prodId = ctx.match[1];
        await ctx.answerCbQuery();

        await ctx.editMessageText('🗑 *Remove Stock*\n\nPilih cara hapus:', {
            parse_mode: 'Markdown',
            ...stockRemoveKeyboard(prodId)
        });
    });


    // Remove by search
    bot.action(/^adm_stock_rm_search_(.+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        const prodId = ctx.match[1];
        await ctx.answerCbQuery();

        adminStates.setFor(ctx, { action: 'rm_stock_search', prodId });

        await ctx.editMessageText('🔎 *Remove by Search*\n\nKirim data stok yang mau dihapus (1 per baris).\nFormat sesuai stock type produk ini.\n\nContoh:\n`email@gmail.com|password123`\n`email2@gmail.com|password456`', {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: cancelButton() }
        });
    });

    // Clear all stock confirmation
    bot.action(/^adm_stock_clear_(.+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        const prodId = ctx.match[1];
        await ctx.answerCbQuery();

        const summary = db.getStockSummary(prodId);

        await ctx.editMessageText(`<blockquote>⚠️ <b>Clear All Ready?</b></blockquote>\nStok ready yang akan dihapus: <b>${summary.ready}</b>\nStok reserved yang dilindungi: <b>${summary.reserved}</b>\n\nAksi ini tidak bisa dibatalkan.`, {
            parse_mode: 'HTML',
            ...stockClearConfirmKeyboard(prodId)
        });
    });

    bot.action(/^adm_stock_fixclear_(.+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        const prodId = ctx.match[1];

        const result = db.clearProductStock(prodId);
        await ctx.answerCbQuery(`✅ ${result.removed} stok ready dihapus`);

        await ctx.editMessageText(`<blockquote>✅ <b>Clear All Ready selesai</b></blockquote>\nStok ready dihapus: <b>${result.removed}</b>\nStok reserved dilindungi: <b>${result.reserved}</b>`, {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: navButtons(`adm_stock_prod_${prodId}`) }
        });
    });

    // Auto-Restock (File Import)
    bot.action(/^adm_stock_import_(.+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        await ctx.answerCbQuery();

        const prodId = ctx.match[1];
        const prod = db.getProductById(prodId);

        adminStates.setFor(ctx, { action: 'import_stock', prodId });

        await ctx.editMessageText(`📁 *Import Stock dari File*\n\n📦 Produk: ${prod.name_id}\n\nKirim file .txt dengan format:\n1 item per baris`, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: cancelButton() }
        });
    });

    // ==================== FLASH SALE ====================

    // Start flash sale — choose discount type
    bot.action(/^adm_fs_start_(.+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        const prodId = ctx.match[1];
        await ctx.answerCbQuery();

        const prod = db.getProductById(prodId);
        if (!prod) return;

        await ctx.editMessageText(`⚡ *Flash Sale — ${prod.name_id}*\n\n💰 Harga normal: Rp ${formatIDR(prod.price_idr)}\n\nPilih tipe diskon:`, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [Markup.button.callback('💰 Ganti Harga (Rp)', `adm_fs_type_fixed_${prodId}`)],
                    [Markup.button.callback('📉 Potong Persen (%)', `adm_fs_type_percent_${prodId}`)],
                    ...navButtons(`adm_prod_view_${prodId}`)
                ]
            }
        });
    });

    // Flash sale — fixed price input
    bot.action(/^adm_fs_type_fixed_(.+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        const prodId = ctx.match[1];
        await ctx.answerCbQuery();

        adminStates.setFor(ctx, { action: 'fs_set_price', prodId, type: 'fixed' });

        await ctx.editMessageText('💰 *Ganti Harga Flash Sale*\n\nKetik harga baru (angka Rupiah):\n\nContoh: `30000`', {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: cancelButton() }
        });
    });

    // Flash sale — percent input
    bot.action(/^adm_fs_type_percent_(.+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        const prodId = ctx.match[1];
        await ctx.answerCbQuery();

        adminStates.setFor(ctx, { action: 'fs_set_price', prodId, type: 'percent' });

        await ctx.editMessageText('📉 *Potong Persen*\n\nKetik persen diskon:\n\nContoh: `40` (untuk 40% off)', {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: cancelButton() }
        });
    });

    // Flash sale — duration preset selection
    bot.action(/^adm_fs_duration_(.+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        const prodId = ctx.match[1];
        await ctx.answerCbQuery();

        const state = adminStates.getFor(ctx);
        if (!state || !state.flashPrice) return;

        const prod = db.getProductById(prodId);
        const discount = Math.round((1 - state.flashPrice / prod.price_idr) * 100);

        await ctx.editMessageText(`⏰ *Pilih Durasi Flash Sale*\n\n📦 ${prod.name_id}\n💰 ~Rp ${formatIDR(prod.price_idr)}~ → Rp ${formatIDR(state.flashPrice)} (-${discount}%)\n\nPilih durasi:`, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [
                        Markup.button.callback('1 Jam', `adm_fs_dur_1h_${prodId}`),
                        Markup.button.callback('3 Jam', `adm_fs_dur_3h_${prodId}`),
                        Markup.button.callback('6 Jam', `adm_fs_dur_6h_${prodId}`)
                    ],
                    [
                        Markup.button.callback('12 Jam', `adm_fs_dur_12h_${prodId}`),
                        Markup.button.callback('1 Hari', `adm_fs_dur_24h_${prodId}`),
                        Markup.button.callback('3 Hari', `adm_fs_dur_72h_${prodId}`)
                    ],
                    [
                        Markup.button.callback('7 Hari', `adm_fs_dur_168h_${prodId}`),
                        Markup.button.callback('✏️ Custom', `adm_fs_dur_custom_${prodId}`)
                    ],
                    ...navButtons(`adm_prod_view_${prodId}`)
                ]
            }
        });
    });

    // Flash sale — preset duration selected
    bot.action(/^adm_fs_dur_(\d+)h_(.+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        const hours = parseInt(ctx.match[1]);
        const prodId = ctx.match[2];
        await ctx.answerCbQuery();

        const state = adminStates.getFor(ctx);
        if (!state || !state.flashPrice) return;

        const now = new Date();
        const end = new Date(now.getTime() + hours * 60 * 60 * 1000);

        const prod = db.getProductById(prodId);
        const discount = Math.round((1 - state.flashPrice / prod.price_idr) * 100);
        const startStr = now.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
        const endStr = end.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
        const durationLabel = hours >= 24 ? `${hours / 24} hari` : `${hours} jam`;

        state.flashStart = now.toISOString();
        state.flashEnd = end.toISOString();
        state.durationLabel = durationLabel;
        adminStates.setFor(ctx, state);

        await ctx.editMessageText(`⚡ *Konfirmasi Flash Sale*\n\n📦 *${prod.name_id}*\n💰 Harga: ~Rp ${formatIDR(prod.price_idr)}~ → *Rp ${formatIDR(state.flashPrice)}* (-${discount}%)\n⏰ Durasi: ${durationLabel}\n📅 Mulai: ${startStr} WIB\n📅 Berakhir: ${endStr} WIB\n\nLanjutkan?`, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [Markup.button.callback('∞ Tanpa Batas', `adm_fs_limit_none_${prodId}`), Markup.button.callback('🔢 Batasi Transaksi', `adm_fs_limit_set_${prodId}`)],
                    [Markup.button.callback('❌ Batal', `adm_prod_view_${prodId}`)]
                ]
            }
        });
    });

    // Flash sale — custom duration input
    bot.action(/^adm_fs_dur_custom_(.+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        const prodId = ctx.match[1];
        await ctx.answerCbQuery();

        const state = adminStates.getFor(ctx);
        if (!state || !state.flashPrice) return;

        state.action = 'fs_custom_duration';
        adminStates.setFor(ctx, state);

        await ctx.editMessageText('✏️ *Custom Durasi*\n\nKetik durasi, contoh:\n• `5 jam`\n• `2 hari`', {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: cancelButton() }
        });
    });

    bot.action(/^adm_fs_limit_none_(.+)$/, async (ctx) => {
        const state = adminStates.getFor(ctx); if (!isAdmin(ctx.from.id) || !state) return;
        state.flashMaxTransactions = null; adminStates.setFor(ctx, state);
        await ctx.answerCbQuery(); await ctx.editMessageReplyMarkup({ inline_keyboard: [[Markup.button.callback('✅ Aktifkan Flash Sale', `adm_fs_confirm_${ctx.match[1]}`)], [Markup.button.callback('❌ Batal', `adm_prod_view_${ctx.match[1]}`)]] });
    });
    bot.action(/^adm_fs_limit_set_(.+)$/, async (ctx) => {
        const state = adminStates.getFor(ctx); if (!isAdmin(ctx.from.id) || !state) return;
        state.action = 'fs_set_max_transactions'; adminStates.setFor(ctx, state);
        await ctx.answerCbQuery(); await ctx.editMessageText('🔢 Kirim maksimal transaksi flash sale (minimal 1):', { reply_markup: { inline_keyboard: [[Markup.button.callback('❌ Batal', `adm_prod_view_${ctx.match[1]}`)]] } });
    });

    // Flash sale — confirm & activate
    bot.action(/^adm_fs_confirm_(?!stop_)(.+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        const prodId = ctx.match[1];
        await ctx.answerCbQuery('⚡ Flash Sale Diaktifkan!');

        const state = adminStates.getFor(ctx);
        if (!state || !state.flashPrice) return;

        db.setFlashSale(prodId, state.flashPrice, state.flashStart, state.flashEnd, state.flashMaxTransactions ?? null);
        adminStates.delete(ctx.from.id.toString());

        const prod = db.getProductById(prodId);
        await showProductView(ctx, prodId, prod);
    });

    // Flash sale — stop
    bot.action(/^adm_fs_stop_(.+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        const prodId = ctx.match[1];
        await ctx.answerCbQuery();

        const prod = db.getProductById(prodId);

        await ctx.editMessageText(`⚠️ *Stop Flash Sale "${prod.name_id}"?*\n\nHarga akan kembali ke Rp ${formatIDR(prod.price_idr)}`, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [Markup.button.callback('✅ Ya, Stop', `adm_fs_confirm_stop_${prodId}`)],
                    [Markup.button.callback('❌ Batal', `adm_prod_view_${prodId}`)]
                ]
            }
        });
    });

    bot.action(/^adm_fs_confirm_stop_(.+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        const prodId = ctx.match[1];
        await ctx.answerCbQuery('✅ Flash Sale Dihentikan');

        db.clearFlashSale(prodId);
        const prod = db.getProductById(prodId);
        await showProductView(ctx, prodId, prod);
    });

    // ==================== PRODUCT STATS ====================

    bot.action('adm_product_stats', async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        await ctx.answerCbQuery();

        const orders = db.getOrders().filter(o => ['paid', 'delivered'].includes(o.status) && o.product_id !== 'TOPUP');
        const products = db.getProducts();

        const salesMap = {};
        orders.filter(o => o.product_id !== 'TOPUP').forEach(o => {
            if (!salesMap[o.product_id]) salesMap[o.product_id] = 0;
            salesMap[o.product_id] += (o.quantity || 1);
        });

        const sorted = Object.entries(salesMap)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5);

        let msg = `📊 *Product Stats*\n\n`;
        msg += `🏆 *Best Seller (Top 5):*\n`;

        if (sorted.length === 0) {
            msg += `  _Belum ada penjualan_\n`;
        } else {
            const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'];
            sorted.forEach(([prodId, qty], i) => {
                const prod = db.getProductById(prodId);
                const name = prod?.name_id || 'Unknown';
                msg += `${medals[i]} ${name} — ${qty} terjual\n`;
            });
        }

        const lowStock = products.filter(p => {
            if (p.active === false) return false;
            if (p.stock_mode === 'unlimited') return false;
            const available = db.getAvailableStockCount(p.id);
            return available < 3;
        });

        msg += `\n⚠️ *Low Stock Alert (< 3):*\n`;

        if (lowStock.length === 0) {
            msg += `  ✅ Semua produk stok aman\n`;
        } else {
            lowStock.forEach(p => {
                const available = db.getAvailableStockCount(p.id);
                const icon = available === 0 ? '🔴' : '🟡';
                msg += `${icon} ${p.name_id} — ${available} tersisa\n`;
            });
        }

        await ctx.editMessageText(msg, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    ...navButtons('admin_home')
                ]
            }
        });
    });

    // Shared renderer: tampilan tetap identik setelah toggle/edit/flash.
    async function showProductView(ctx, prodId, prod) {
        if (!prod) {
            await ctx.editMessageText('❌ Produk tidak ditemukan.', { reply_markup: { inline_keyboard: navButtons('adm_prod') } });
            return;
        }
        const h = (s) => escapeHtml(s || '-');
        await ctx.editMessageText(`${renderProductSummary(prod)}
<b>Deskripsi ID:</b> ${h(prod.description_id)}
<b>Deskripsi EN:</b> ${h(prod.description_en)}
<b>S&amp;K ID:</b> ${safeHtmlSnk(prod.terms_id, prod.terms_format === 'html')}
<b>S&amp;K EN:</b> ${safeHtmlSnk(prod.terms_en, prod.terms_format === 'html')}`, {
            parse_mode: 'HTML',
            ...productViewKeyboard(prodId, prod.category_id, prod)
        });
    }
}

// Input handlers
async function handleAddCategory(ctx, state, text, adminStates) {
    if (state.step === 'name_id') {
        state.name_id = text;
        state.step = 'name_en';
        adminStates.setFor(ctx, state);
        await ctx.reply('Kirim nama kategori (English):');
    } else if (state.step === 'name_en') {
        state.name_en = text;
        db.addCategory({ name_id: state.name_id, name_en: state.name_en });
        adminStates.delete(ctx.from.id.toString());
        await ctx.reply('✅ Kategori berhasil dibuat!', {
            reply_markup: { inline_keyboard: navButtons('adm_cat') }
        });
    }
}

async function handleEditCatName(ctx, state, text, adminStates) {
    if (state.step === 'name_id') {
        state.name_id = text;
        state.step = 'name_en';
        adminStates.setFor(ctx, state);
        await ctx.reply('Kirim nama (English):');
    } else {
        db.updateCategory(state.catId, { name_id: state.name_id, name_en: text });
        adminStates.delete(ctx.from.id.toString());
        await ctx.reply('✅ Nama kategori diupdate!', {
            reply_markup: { inline_keyboard: navButtons(`adm_cat_view_${state.catId}`) }
        });
    }
}

async function handleAddProduct(ctx, state, text, adminStates) {
    const steps = ['name_id', 'name_en', 'price', 'stock_type'];
    const prompts = {
        name_en: '*Step 2/4:* Kirim nama produk (EN):',
        price: '*Step 3/4:* Kirim harga (angka Rupiah):',
        stock_type: '*Step 4/4:* Pilih tipe stok:\n1. Code\n2. Email|Pass\n3. Email|Pass|Key\n4. VCC (card|exp|cvv)\n5. Custom (format bebas)\n\nKirim 1/2/3/4/5:'
    };

    const currentIdx = steps.indexOf(state.step);

    if (state.step === 'price') {
        const price = Number.parseInt(text.replace(/\D/g, ''), 10);
        if (!Number.isInteger(price) || price < 0) {
            await ctx.reply('❌ Harga tidak valid. Kirim angka Rupiah, contoh: <code>15000</code>', { parse_mode: 'HTML' });
            return;
        }
        state.data.price_idr = price;
    } else if (state.step === 'stock_type') {
        const types = { '1': 'code', '2': 'email_pass', '3': 'email_pass_key', '4': 'vcc', '5': 'custom' };
        const choice = text.trim();
        if (!types[choice]) {
            await ctx.reply('❌ Pilihan tidak valid. Kirim angka <code>1</code> sampai <code>5</code>.', { parse_mode: 'HTML' });
            return;
        }
        state.data.stock_type = types[choice];
        state.data.active = true;
        state.data.stock_mode = 'limited';
    } else {
        state.data[state.step] = text;
    }

    if (currentIdx === steps.length - 1) {
        const created = db.addProduct(state.data);
        const prod = db.getProductById(created.id);
        adminStates.delete(ctx.from.id.toString());
        await ctx.reply(`✅ Produk berhasil dibuat.\n\n${renderProductSummary(prod)}`, {
            parse_mode: 'HTML',
            ...productViewKeyboard(prod.id, prod.category_id, prod)
        });
    } else {
        state.step = steps[currentIdx + 1];
        adminStates.setFor(ctx, state);
        await ctx.reply(prompts[state.step], { parse_mode: 'Markdown' });
    }
}

async function handleEditProduct(ctx, state, text, adminStates) {
    const { prodId, field, step } = state;

    if (field === 'price') {
        const price = Number.parseInt(text.replace(/\D/g, ''), 10);
        if (!Number.isInteger(price) || price < 0) {
            await ctx.reply('❌ Harga tidak valid. Kirim angka Rupiah, contoh: <code>15000</code>', { parse_mode: 'HTML' });
            return;
        }
        if (!db.getProductById(prodId)) {
            adminStates.delete(ctx.from.id.toString());
            await ctx.reply('❌ Produk tidak ditemukan.');
            return;
        }
        db.updateProduct(prodId, { price_idr: price });
        adminStates.delete(ctx.from.id.toString());
        await ctx.reply('✅ Harga diupdate!', {
            reply_markup: { inline_keyboard: navButtons(`adm_prod_view_${prodId}`) }
        });
    } else if (field === 'name') {
        if (step === 'name_id') {
            state.name_id = text;
            state.step = 'name_en';
            adminStates.setFor(ctx, state);
            await ctx.reply('Kirim nama (EN):');
        } else {
            db.updateProduct(prodId, { name_id: state.name_id, name_en: text });
            adminStates.delete(ctx.from.id.toString());
            await ctx.reply('✅ Nama diupdate!', {
                reply_markup: { inline_keyboard: navButtons(`adm_prod_view_${prodId}`) }
            });
        }
    } else if (field === 'desc') {
        if (step === 'desc_id') {
            state.desc_id = text;
            state.step = 'desc_en';
            adminStates.setFor(ctx, state);
            await ctx.reply('Kirim deskripsi (EN):');
        } else {
            db.updateProduct(prodId, { description_id: state.desc_id, description_en: text });
            adminStates.delete(ctx.from.id.toString());
            await ctx.reply('✅ Deskripsi diupdate!', {
                reply_markup: { inline_keyboard: navButtons(`adm_prod_view_${prodId}`) }
            });
        }
    } else if (field === 'snk') {
        if (step === 'snk_id') {
            // Convert admin's formatted text (bold, italic, etc.) to HTML
            const htmlText = entitiesToHtml(text, ctx.message.entities);
            state.snk_id = htmlText;
            state.step = 'snk_en';
            adminStates.setFor(ctx, state);
            await ctx.reply('Kirim S&K (EN):');
        } else {
            const htmlText = entitiesToHtml(text, ctx.message.entities);
            db.updateProduct(prodId, { terms_id: state.snk_id, terms_en: htmlText, terms_format: 'html' });
            adminStates.delete(ctx.from.id.toString());
            await ctx.reply('✅ S&K diupdate!', {
                reply_markup: { inline_keyboard: navButtons(`adm_prod_view_${prodId}`) }
            });
        }
    } else if (field === 'discount') {
        const prodId = state.prodId;

        if (text.trim() === '0') {
            db.updateProduct(prodId, { qty_discounts: '' });
            adminStates.delete(ctx.from.id.toString());
            await ctx.reply('✅ Diskon Bulk Order dimatikan', {
                reply_markup: { inline_keyboard: navButtons(`adm_prod_view_${prodId}`) }
            });
            return;
        }

        const prod = db.getProductById(prodId);
        const lines = text.split('\n').filter(l => l.trim());
        const rawTiers = lines.map(line => {
            const parts = line.split(':').map(s => s.trim());
            if (parts.length === 2) return { min_qty: parts[0], type: 'percent', percent: parts[1] };
            if (parts.length === 3 && parts[1] === 'fixed_price') return { min_qty: parts[0], type: 'fixed_price', price: parts[2] };
            if (parts.length === 3 && parts[1] === 'percent') return { min_qty: parts[0], type: 'percent', percent: parts[2] };
            return null;
        });
        const tiers = normalizeBulkTiers(rawTiers, prod?.price_idr || 0);
        if (rawTiers.some(x => !x) || tiers.length !== rawTiers.length || new Set(tiers.map(t => t.min_qty)).size !== tiers.length) {
            await ctx.reply('❌ Tier tidak valid. Gunakan `2:percent:10` atau `5:fixed_price:8000`; minimal qty harus unik.', { parse_mode: 'Markdown' });
            return;
        }
        db.updateProduct(prodId, { qty_discounts: JSON.stringify(tiers) });
        adminStates.delete(ctx.from.id.toString());

        let msg = '✅ Harga Grosir diset:\n';
        tiers.forEach(t => {
            msg += t.type === 'fixed_price' ? `• ${t.min_qty}+ pcs: Rp ${formatIDR(t.price)}/pcs\n` : `• ${t.min_qty}+ pcs: ${t.percent}%\n`;
        });

        await ctx.reply(msg, {
            reply_markup: { inline_keyboard: navButtons(`adm_prod_view_${prodId}`) }
        });
    }
}

async function handleAddStock(ctx, state, text, adminStates) {
    const lines = text.split('\n').filter(l => l.trim());
    const added = db.addBulkStock(state.prodId, lines);
    const total = db.getAvailableStockCount(state.prodId);

    adminStates.delete(ctx.from.id.toString());
    await ctx.reply(`✅ ${added.length} item ditambahkan!\nTotal stok: ${total}`, {
        reply_markup: { inline_keyboard: navButtons(`adm_stock_prod_${state.prodId}`) }
    });
}


async function handleRemoveStockSearch(ctx, state, text, adminStates) {
    const lines = text.split('\n').map(l => l.trim()).filter(l => l);
    if (lines.length === 0) {
        await ctx.reply('❌ Kirim minimal 1 baris data stok.');
        return;
    }

    const stock = db.getUnsoldUnreservedStock(state.prodId);
    let deleted = 0;
    const notFound = [];

    for (const line of lines) {
        const match = stock.find(s => s.data === line);
        if (match) {
            db.deleteStock(match.id);
            deleted++;
            const idx = stock.indexOf(match);
            stock.splice(idx, 1);
        } else {
            notFound.push(line);
        }
    }

    adminStates.delete(ctx.from.id.toString());

    let msg = `✅ ${deleted} dari ${lines.length} item dihapus!`;
    if (notFound.length > 0) {
        const preview = notFound.slice(0, 5).map(l => `• \`${l}\``).join('\n');
        msg += `\n\n❌ Tidak ditemukan (${notFound.length}):\n${preview}`;
        if (notFound.length > 5) msg += `\n... dan ${notFound.length - 5} lainnya`;
    }

    const remaining = db.getAvailableStockCount(state.prodId);
    msg += `\n\n📦 Sisa stok: ${remaining}`;

    await ctx.reply(msg, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: navButtons(`adm_stock_prod_${state.prodId}`) }
    });
}

async function handleFlashSaleInput(ctx, state, text, adminStates) {
    const { formatIDR } = require('../utils/helpers');

    if (state.action === 'fs_set_price') {
        const prod = db.getProductById(state.prodId);
        if (!prod) {
            adminStates.delete(ctx.from.id.toString());
            await ctx.reply('❌ Produk tidak ditemukan.');
            return;
        }

        let flashPrice;
        if (state.type === 'fixed') {
            flashPrice = parseInt(text.replace(/[^0-9]/g, ''));
            if (isNaN(flashPrice) || flashPrice <= 0) {
                await ctx.reply('❌ Harga tidak valid. Masukkan angka positif.');
                return;
            }
            if (flashPrice >= prod.price_idr) {
                await ctx.reply(`❌ Harga flash harus lebih murah dari harga normal (Rp ${formatIDR(prod.price_idr)})`);
                return;
            }
        } else {
            const percent = parseInt(text.replace(/[^0-9]/g, ''));
            if (isNaN(percent) || percent <= 0 || percent >= 100) {
                await ctx.reply('❌ Persen tidak valid. Masukkan angka 1-99.');
                return;
            }
            flashPrice = Math.floor(prod.price_idr * (1 - percent / 100));
        }

        state.flashPrice = flashPrice;
        state.action = 'fs_wait_duration';
        adminStates.setFor(ctx, state);

        // Trigger the duration selection menu by simulating the action
        const discount = Math.round((1 - flashPrice / prod.price_idr) * 100);
        const { navButtons } = require('../utils/keyboard');
        const { Markup } = require('telegraf');

        await ctx.reply(`✅ Harga Flash: Rp ${formatIDR(flashPrice)} (-${discount}%)\n\n⏰ *Pilih Durasi Flash Sale:*`, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [
                        Markup.button.callback('1 Jam', `adm_fs_dur_1h_${state.prodId}`),
                        Markup.button.callback('3 Jam', `adm_fs_dur_3h_${state.prodId}`),
                        Markup.button.callback('6 Jam', `adm_fs_dur_6h_${state.prodId}`)
                    ],
                    [
                        Markup.button.callback('12 Jam', `adm_fs_dur_12h_${state.prodId}`),
                        Markup.button.callback('1 Hari', `adm_fs_dur_24h_${state.prodId}`),
                        Markup.button.callback('3 Hari', `adm_fs_dur_72h_${state.prodId}`)
                    ],
                    [
                        Markup.button.callback('7 Hari', `adm_fs_dur_168h_${state.prodId}`),
                        Markup.button.callback('✏️ Custom', `adm_fs_dur_custom_${state.prodId}`)
                    ],
                    ...navButtons(`adm_prod_view_${state.prodId}`)
                ]
            }
        });

    } else if (state.action === 'fs_set_max_transactions') {
        const max = Number(text.trim());
        if (!Number.isInteger(max) || max < 1) { await ctx.reply('❌ Maksimal transaksi minimal 1.'); return; }
        state.flashMaxTransactions = max; state.action = 'fs_wait_confirm'; adminStates.setFor(ctx, state);
        await ctx.reply(`✅ Batas ${max} transaksi.`, { reply_markup: { inline_keyboard: [[Markup.button.callback('✅ Aktifkan Flash Sale', `adm_fs_confirm_${state.prodId}`)], [Markup.button.callback('❌ Batal', `adm_prod_view_${state.prodId}`)]] } });

    } else if (state.action === 'fs_custom_duration') {
        // Parse custom duration: "5 jam" or "2 hari"
        const match = text.toLowerCase().match(/^(\d+)\s*(jam|hari)$/);
        if (!match) {
            await ctx.reply('❌ Format tidak valid. Contoh: `5 jam` atau `2 hari`', { parse_mode: 'Markdown' });
            return;
        }

        const amount = parseInt(match[1]);
        const unit = match[2];
        const hours = unit === 'hari' ? amount * 24 : amount;

        if (hours <= 0 || hours > 720) {
            await ctx.reply('❌ Durasi antara 1 jam - 30 hari.');
            return;
        }

        const prod = db.getProductById(state.prodId);
        const now = new Date();
        const end = new Date(now.getTime() + hours * 60 * 60 * 1000);
        const discount = Math.round((1 - state.flashPrice / prod.price_idr) * 100);
        const startStr = now.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
        const endStr = end.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
        const durationLabel = `${amount} ${unit}`;

        state.flashStart = now.toISOString();
        state.flashEnd = end.toISOString();
        state.durationLabel = durationLabel;
        adminStates.setFor(ctx, state);

        const { Markup } = require('telegraf');

        await ctx.reply(`⚡ *Konfirmasi Flash Sale*\n\n📦 *${prod.name_id}*\n💰 Harga: ~Rp ${formatIDR(prod.price_idr)}~ → *Rp ${formatIDR(state.flashPrice)}* (-${discount}%)\n⏰ Durasi: ${durationLabel}\n📅 Mulai: ${startStr} WIB\n📅 Berakhir: ${endStr} WIB\n\nLanjutkan?`, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [Markup.button.callback('∞ Tanpa Batas', `adm_fs_limit_none_${state.prodId}`), Markup.button.callback('🔢 Batasi Transaksi', `adm_fs_limit_set_${state.prodId}`)],
                    [Markup.button.callback('❌ Batal', `adm_prod_view_${state.prodId}`)]
                ]
            }
        });
    }
}

module.exports = {
    registerProductHandlers,
    handleAddCategory,
    handleEditCatName,
    handleAddProduct,
    handleEditProduct,
    handleAddStock,

    handleRemoveStockSearch,
    handleFlashSaleInput
};
