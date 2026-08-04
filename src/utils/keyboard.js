const { Markup } = require('telegraf');

// ==================== NAVIGATION KEYBOARDS ====================

// Standard back + home buttons
const navButtons = (backCallback = 'admin_home') => {
    return [
        [
            Markup.button.callback('‹ Back', backCallback),
            Markup.button.callback('🏠 Home', 'admin_home')
        ]
    ];
};

// Cancel button for input states
const cancelButton = () => {
    return [[Markup.button.callback('✘ Batal', 'admin_cancel')]];
};



const adminDashboardKeyboard = () => Markup.inlineKeyboard([
    [Markup.button.callback('📦 Produk & Kategori', 'adm_catalog'), Markup.button.callback('🧰 Stok', 'adm_stock')],
    [Markup.button.callback('🧾 Orders', 'adm_orders'), Markup.button.callback('👥 Users & Saldo', 'adm_users_balance')],
    [Markup.button.callback('🎟️ Voucher', 'adm_vouchers'), Markup.button.callback('📣 Broadcast', 'adm_broadcast')],
    [Markup.button.callback('📊 Statistik', 'adm_stats_menu'), Markup.button.callback('⚙️ Sistem', 'adm_settings')],
    [Markup.button.callback('💾 Backup DB', 'adm_backup'), Markup.button.callback('⟲ Refresh', 'adm_refresh')]
]);

// ==================== KATEGORI ====================

const categoryListKeyboard = (categories, page = 1, perPage = 5) => {
    const buttons = [];
    const sortedCategories = [...categories].sort((a, b) => String(a.name_id || '').localeCompare(String(b.name_id || ''), 'id', { sensitivity: 'base', numeric: true }));
    const totalPages = Math.ceil(sortedCategories.length / perPage);
    const start = (page - 1) * perPage;
    const pageCategories = sortedCategories.slice(start, start + perPage);

    // Category list — nama saja; schema kategori tidak menyimpan emoji/status.
    pageCategories.forEach(cat => {
        buttons.push([Markup.button.callback(`📁 ${cat.name_id}`, `adm_cat_view_${cat.id}`)]);
    });

    // Pagination if needed
    if (totalPages > 1) {
        const navRow = [];
        if (page > 1) navRow.push(Markup.button.callback('« Prev', `adm_cat_page_${page - 1}`));
        navRow.push(Markup.button.callback(`${page}/${totalPages}`, 'noop'));
        if (page < totalPages) navRow.push(Markup.button.callback('» Next', `adm_cat_page_${page + 1}`));
        buttons.push(navRow);
    }

    buttons.push([Markup.button.callback('➕ Tambah Kategori', 'adm_cat_add')]);

    buttons.push(...navButtons('adm_catalog'));
    return Markup.inlineKeyboard(buttons);
};

const categoryViewKeyboard = (categoryId) => {
    return Markup.inlineKeyboard([
        [Markup.button.callback('📦 Lihat Produk', `adm_prod_cat_${categoryId}`)],
        [Markup.button.callback('✏️ Edit Nama', `adm_cat_edit_name_${categoryId}`)],
        [Markup.button.callback('🗑 Hapus Kategori', `adm_cat_del_${categoryId}`)],
        ...navButtons('adm_cat')
    ]);
};

const categoryDeleteConfirmKeyboard = (categoryId, hasProducts) => {
    const buttons = [];

    if (hasProducts) {
        buttons.push([Markup.button.callback('📦 Pindahkan Produk', `adm_cat_move_products_${categoryId}`)]);
    } else {
        buttons.push([Markup.button.callback('✅ Ya, Hapus Kategori', `adm_cat_fixdel_${categoryId}`)]);
    }

    buttons.push([Markup.button.callback('✘ Batal', `adm_cat_view_${categoryId}`)]);
    return Markup.inlineKeyboard(buttons);
};

// ==================== PRODUK ====================

const productListKeyboard = (products, categoryId, page = 1, perPage = 5) => {
    const buttons = [];
    const sortedProducts = [...products].sort((a, b) => String(a.name_id || '').localeCompare(String(b.name_id || ''), 'id', { sensitivity: 'base', numeric: true }));
    const totalPages = Math.ceil(sortedProducts.length / perPage) || 1;
    const start = (page - 1) * perPage;
    const pageProducts = sortedProducts.slice(start, start + perPage);

    // Product list with info
    pageProducts.forEach(prod => {
        const status = prod.active !== false ? '✅' : '⏸';
        const stock = prod.stock_mode === 'unlimited' ? '♾' : (prod.stockCount || 0);
        buttons.push([Markup.button.callback(
            `${status} ${prod.name_id} | ${stock} stok`,
            `adm_prod_view_${prod.id}`
        )]);
    });

    // Pagination
    if (totalPages > 1) {
        const navRow = [];
        if (page > 1) navRow.push(Markup.button.callback('«', `adm_prod_page_${categoryId}_${page - 1}`));
        navRow.push(Markup.button.callback(`${page}/${totalPages}`, 'noop'));
        if (page < totalPages) navRow.push(Markup.button.callback('»', `adm_prod_page_${categoryId}_${page + 1}`));
        buttons.push(navRow);
    }

    buttons.push([Markup.button.callback('➕ Tambah Produk', `adm_prod_add_${categoryId}`)]);

    // Back ke View Kategori (bukan self-loop ke daftar produk yang sama).
    buttons.push(...navButtons(`adm_cat_view_${categoryId}`));
    return Markup.inlineKeyboard(buttons);
};

const productViewKeyboard = (productId, categoryId, product = null) => {
    const buttons = [
        [Markup.button.callback('🧰 Kelola Stok', `adm_stock_prod_${productId}_pv`)],
        [
            Markup.button.callback('📝 Edit Nama', `adm_prod_edit_name_${productId}`),
            Markup.button.callback('💸 Edit Harga', `adm_prod_edit_price_${productId}`)
        ],
        [
            Markup.button.callback('📄 Deskripsi', `adm_prod_edit_desc_${productId}`),
            Markup.button.callback('📜 S&K', `adm_prod_edit_snk_${productId}`)
        ],
        [
            Markup.button.callback('📋 Tipe Stok', `adm_prod_edit_stocktype_${productId}`),
            Markup.button.callback('📌 Toggle Status', `adm_prod_toggle_${productId}`)
        ],
        [Markup.button.callback('💰 Diskon Bulk', `adm_prod_discount_${productId}`)]
    ];

    // Flash Sale buttons
    const isFlashActive = product && product.flash_price && product.flash_end && new Date().toISOString() <= product.flash_end;
    if (isFlashActive) {
        buttons.push([Markup.button.callback('✘ Stop Flash Sale', `adm_fs_stop_${productId}`)]);
    } else {
        buttons.push([Markup.button.callback('⚡ Flash Sale', `adm_fs_start_${productId}`)]);
    }

    buttons.push([Markup.button.callback('🗑 Delete Produk', `adm_prod_del_${productId}`)]);
    // Back ke View Kategori (parent) — konsisten dengan daftar produk.
    buttons.push(...navButtons(`adm_cat_view_${categoryId}`));
    return Markup.inlineKeyboard(buttons);
};

const productStockTypeKeyboard = (productId) => {
    return Markup.inlineKeyboard([
        [Markup.button.callback('🔑 Code', `adm_prod_setstocktype_1_${productId}`)],
        [Markup.button.callback('📧 Email|Pass', `adm_prod_setstocktype_2_${productId}`)],
        [Markup.button.callback('📧 Email|Pass|Key', `adm_prod_setstocktype_3_${productId}`)],
        [Markup.button.callback('💳 VCC (card|exp|cvv)', `adm_prod_setstocktype_4_${productId}`)],
        [Markup.button.callback('✨ Custom (format bebas)', `adm_prod_setstocktype_5_${productId}`)],
        ...navButtons(`adm_prod_view_${productId}`)
    ]);
};

// ==================== STOK ====================

const stockManageKeyboard = (productId, backCallback = `adm_prod_view_${productId}`) => {
    return Markup.inlineKeyboard([
        [Markup.button.callback('➕ Add Stock', `adm_stock_add_${productId}`)],
        [Markup.button.callback('📁 Import File (.txt)', `adm_stock_import_${productId}`)],
        [
            Markup.button.callback('📋 Lihat Stock', `adm_stock_view_${productId}`),
            Markup.button.callback('🗑 Remove', `adm_stock_remove_${productId}`)
        ],
        [Markup.button.callback('🧹 Clear All Ready', `adm_stock_clear_${productId}`)],
        ...navButtons(backCallback)
    ]);
};

const stockRemoveKeyboard = (productId) => {
    return Markup.inlineKeyboard([
        [Markup.button.callback('⌕ Hapus Berdasarkan Data', `adm_stock_rm_search_${productId}`)],
        ...navButtons(`adm_stock_prod_${productId}`)
    ]);
};

const stockClearConfirmKeyboard = (productId) => {
    return Markup.inlineKeyboard([
        [Markup.button.callback('⚠️ Ya, Hapus Semua Stok', `adm_stock_fixclear_${productId}`)],
        [Markup.button.callback('✘ Batal', `adm_stock_prod_${productId}`)]
    ]);
};

// ==================== ORDERS ====================

const ordersListKeyboard = (orders = [], page = 1, totalPages = 1, filter = 'all') => {
    const buttons = [];

    // Order buttons (clickable list)
    orders.forEach(o => {
        const statusIcon = { pending: '⏳', delivered: '✅', expired: '✘', cancelled: '🚫', refunded: '💸' };
        const icon = statusIcon[o.status] || '❓';
        const shortId = o.id.replace('VTC-', '');
        const prodName = (o.product_name || 'Item');
        const displayProd = prodName.length > 12 ? prodName.substring(0, 12) + '..' : prodName;
        buttons.push([Markup.button.callback(`${icon} ${shortId} | ${displayProd}`, `adm_order_view_${o.id}`)]);
    });

    // Pagination
    if (totalPages > 1) {
        const navRow = [];
        if (page > 1) navRow.push(Markup.button.callback('«', `adm_orders_p_${filter}_${page - 1}`));
        navRow.push(Markup.button.callback(`${page}/${totalPages}`, 'noop'));
        if (page < totalPages) navRow.push(Markup.button.callback('»', `adm_orders_p_${filter}_${page + 1}`));
        buttons.push(navRow);
    }

    // Filter row
    const f = filter;
    buttons.push([
        Markup.button.callback(f === 'all' ? '• All' : 'All', 'adm_orders_f_all_1'),
        Markup.button.callback(f === 'pending' ? '• Pend' : 'Pend', 'adm_orders_f_pending_1'),
        Markup.button.callback(f === 'done' ? '• Done' : 'Done', 'adm_orders_f_done_1'),
        Markup.button.callback(f === 'expired' ? '• Exp' : 'Exp', 'adm_orders_f_expired_1')
    ]);

    // Export button
    buttons.push([Markup.button.callback('📥 Export CSV', 'adm_orders_export')]);

    buttons.push(...navButtons('admin_home'));
    return Markup.inlineKeyboard(buttons);
};


const orderDetailKeyboard = (orderId, status) => {
    const buttons = [];

    if (status === 'delivered') {
        buttons.push([
            Markup.button.callback('⟲ Redeliver', `adm_order_redeliver_${orderId}`),
            Markup.button.callback('💸 Refund', `adm_order_refund_${orderId}`)
        ]);
        buttons.push([Markup.button.callback('🔁 Replace Account', `adm_order_replace_${orderId}`)]);
    }

    buttons.push([Markup.button.callback('‹ Kembali ke Orders', 'adm_orders')]);

    return Markup.inlineKeyboard(buttons);
};


const orderRefundConfirmKeyboard = (orderId) => {
    return Markup.inlineKeyboard([
        [Markup.button.callback('✅ Ya, Refund', `adm_order_confirm_refund_${orderId}`)],
        [Markup.button.callback('✘ Batal', `adm_order_view_${orderId}`)]
    ]);
};

const orderReplaceConfirmKeyboard = (orderId) => {
    return Markup.inlineKeyboard([
        [Markup.button.callback('✅ Ya, Replace', `adm_order_confirm_replace_${orderId}`)],
        [Markup.button.callback('✘ Batal', `adm_order_view_${orderId}`)]
    ]);
};

// ==================== USERS ====================

const usersKeyboard = () => {
    return Markup.inlineKeyboard([
        [Markup.button.callback('📊 Statistik User', 'adm_users_stats')],
        [Markup.button.callback('🔎 Cari User', 'adm_users_search')],
        [Markup.button.callback('🚫 Banned Users', 'adm_users_banned')],
        ...navButtons('adm_users_balance')
    ]);
};

// ==================== BROADCAST ====================

const broadcastKeyboard = () => Markup.inlineKeyboard([
    [Markup.button.callback('📢 Semua User', 'adm_bc_all')],
    [Markup.button.callback('▦ Pembeli per Kategori', 'adm_bc_category')],
    [Markup.button.callback('⚡ Flash Sale Aktif', 'adm_bc_flash_active')],
    ...navButtons('admin_home')
]);

// ==================== SETTINGS ====================

const settingsKeyboard = () => {
    const db = require('../models/db');
    const s = db.getSettings();

    const mIcon = s.maintenance ? '🔴' : '🟢';
    const qIcon = s.qris_enabled ? '✅' : '❌';
    const sIcon = s.saldo_enabled !== false ? '✅' : '❌';

    return Markup.inlineKeyboard([
        [Markup.button.callback(`${mIcon} Maintenance Mode: ${s.maintenance ? 'ON' : 'OFF'}`, 'adm_set_maintenance')],
        [Markup.button.callback(`${qIcon} QRIS: ${s.qris_enabled ? 'Active' : 'OFF'}`, 'adm_set_qris')],
        [Markup.button.callback(`${sIcon} Saldo: ${s.saldo_enabled !== false ? 'Active' : 'OFF'}`, 'adm_set_saldo')],
        ...navButtons('admin_home')
    ]);
};

// ==================== USER-FACING KEYBOARDS (keep existing) ====================

const languageKeyboard = () => {
    return Markup.inlineKeyboard([
        [
            Markup.button.callback('🇮🇩 Bahasa Indonesia', 'lang_id'),
            Markup.button.callback('🇬🇧 English', 'lang_en')
        ]
    ]);
};

const mainMenuKeyboard = (lang = 'id', userId = null) => {
    const { isRentBotEnabled } = require('./features');
    // Get balance for display on button
    let balanceText = '';
    if (userId) {
        try {
            const { getBalance } = require('../payments/balance');
            const bal = getBalance(userId);
            if (lang === 'en') {
                const { formatUSD, convertIDRtoUSDSync } = require('./helpers');
                const usd = convertIDRtoUSDSync ? convertIDRtoUSDSync(bal) : (bal / 16000);
                balanceText = ` $${formatUSD(usd)}`;
            } else {
                const { formatIDR } = require('./helpers');
                balanceText = ` Rp ${formatIDR(bal)}`;
            }
        } catch (e) { }
    }

    const texts = {
        id: {
            products: '▦ List Produk',
            saldo: `● Saldo:${balanceText}`,
            history: '≡ Riwayat',
            stock: '▤ Cek Stok',
            language: '◎ Bahasa',
            sewaBot: '◇ Sewa Bot',
            support: '? Customer Service'
        },
        en: {
            products: '▦ Products',
            saldo: `● Balance:${balanceText}`,
            history: '≡ History',
            stock: '▤ Check Stock',
            language: '◎ Language',
            sewaBot: '◇ Rent Bot',
            support: '? Customer Service'
        }
    };

    const t = texts[lang] || texts.id;

    // Reply Keyboard (persistent at bottom)
    // Row 1: Products | Check Stock
    // Row 2: Saldo (full width)
    // Row 3: History | Language
    // Row 4: Sewa Bot + CS (ID only) | CS only (EN)
    const styled = (text, style) => ({ text, style });
    const rows = [
        [styled(t.products, 'primary'), styled(t.stock, 'primary')],
        [styled(t.saldo, 'success')],
        [styled(t.history, 'primary'), styled(t.language, 'primary')]
    ];

    if (lang === 'id' && isRentBotEnabled()) {
        rows.push([styled(t.sewaBot, 'danger'), styled(t.support, 'danger')]);
    } else {
        rows.push([styled(t.support, 'danger')]);
    }

    return Markup.keyboard(rows).resize();
};

const categoriesKeyboard = (categories, lang = 'id') => {
    const buttons = categories.filter(c => c.active !== false).map(cat => {
        const emoji = cat.emoji || '📁';
        const name = lang === 'en' ? cat.name_en : cat.name_id;
        return [Markup.button.callback(`${emoji} ${name}`, `cat_${cat.id}`)];
    });

    const backText = lang === 'en' ? '‹ Back' : '‹ Kembali';
    buttons.push([Markup.button.callback(backText, 'menu_home')]);

    return Markup.inlineKeyboard(buttons);
};

const productsKeyboard = (products, lang = 'id') => {
    const buttons = products.filter(p => p.active !== false).map(prod => {
        const name = lang === 'en' ? prod.name_en : prod.name_id;
        const stock = prod.stock_mode === 'unlimited' ? '♾' : `${prod.stockCount || 0}`;
        return [Markup.button.callback(`${name} [${stock}]`, `prod_${prod.id}`)];
    });

    const backText = lang === 'en' ? '‹ Back' : '‹ Kembali';
    buttons.push([Markup.button.callback(backText, 'menu_categories')]);

    return Markup.inlineKeyboard(buttons);
};

const quantityKeyboard = (maxQty, productId, currentQty = 1, categoryId, lang = 'id') => {
    const buttons = [];
    const styledCallback = (text, callback, style) => ({ ...Markup.button.callback(text, callback), style });

    // Row 1: [−1] [Nx] [＋1]
    const qtyRow = [];
    if (currentQty > 1) {
        qtyRow.push(styledCallback('−1', `qty_dec_${productId}_${currentQty}`, 'primary'));
    } else {
        qtyRow.push(styledCallback('−1', 'noop', 'primary'));
    }
    qtyRow.push(styledCallback(`${currentQty}x`, 'noop', 'primary'));
    if (currentQty < maxQty) {
        qtyRow.push(styledCallback('＋1', `qty_inc_${productId}_${currentQty}`, 'primary'));
    } else {
        qtyRow.push(styledCallback('＋1', 'noop', 'primary'));
    }
    buttons.push(qtyRow);

    // Row 2: [−5] [📦 Max: X] [＋5]
    const fastRow = [];
    if (currentQty > 5) {
        fastRow.push(styledCallback('−5', `qty_dec5_${productId}_${currentQty}`, 'primary'));
    } else {
        fastRow.push(styledCallback('−5', 'noop', 'primary'));
    }
    const maxLabel = maxQty >= 999 ? '♾' : maxQty;
    // Clickable: prompts the user to type a quantity (1..maxQty) instead of tapping +/-
    const typeLabel = lang === 'en' ? `Type (max ${maxLabel})` : `Ketik (max ${maxLabel})`;
    fastRow.push(styledCallback(typeLabel, `qtytype_${productId}_${currentQty}`, 'primary'));
    if (currentQty + 5 <= maxQty) {
        fastRow.push(styledCallback('＋5', `qty_inc5_${productId}_${currentQty}`, 'primary'));
    } else {
        fastRow.push(styledCallback('＋5', 'noop', 'primary'));
    }
    buttons.push(fastRow);

    // Direct Payment Buttons
    if (lang === 'en') {
        buttons.push([styledCallback('Continue Payment ›', `pay_confirm_${productId}_${currentQty}`, 'success')]);
    } else {
        buttons.push([styledCallback('Lanjutkan Pembayaran ›', `pay_confirm_${productId}_${currentQty}`, 'success')]);
    }

    const backText = lang === 'en' ? '‹ Back' : '‹ Kembali';
    // Back to specific category instead of main menu
    // Use catnum_ to trigger the vertical list handler in handlers/keyboard.js
    const backAction = categoryId ? `catnum_${categoryId}` : 'menu_categories';
    buttons.push([styledCallback(backText, backAction, 'danger')]);

    return Markup.inlineKeyboard(buttons);
};

// Semua QRIS aktif ditampilkan sejajar dalam satu baris. Saldo & Binance diatur
// terpisah agar urutannya selalu: QRIS → Binance → Saldo.
const buildPaymentButtonRows = (orderId, gateways, qrisEnabled, qrisText, saldoText, saldoCallback) => {
    if (!qrisEnabled) return [];
    const qris = gateways.map((gw, index) => ({
        text: `▣ QRIS ${index + 1}`,
        callback: `pay_qgw_${gw.id || `env-${gw.provider}`}_${orderId}`
    }));
    return qris.length ? [qris] : [];
};

const paymentMethodKeyboard = (orderId, lang = 'id') => {
    const db = require('../models/db');
    const gateway = require('../payments/gateway');
    const settings = db.getSettings();

    const texts = {
        id: { qris: '▣ QRIS', saldo: '● Saldo', binance: '🅑 Binance Pay', voucher: '＋ Pakai Voucher', removeVoucher: '− Hapus Voucher', cancel: '× Batalkan' },
        en: { qris: '▣ QRIS', saldo: '● Balance', binance: '🅑 Binance Pay', voucher: '＋ Apply Voucher', removeVoucher: '− Remove Voucher', cancel: '× Cancel' }
    };
    const t = texts[lang] || texts.id;

    // Toggle voucher button: "Pakai" if none applied, "Hapus" if one is already applied
    const order = db.getOrderById(orderId);
    const voucherBtn = order && order.voucher_code
        ? { ...Markup.button.callback(t.removeVoucher, `voucher_remove_${orderId}`), style: 'danger' }
        : { ...Markup.button.callback(t.voucher, `voucher_apply_${orderId}`), style: 'danger' };

    const saldoBtn = settings.saldo_enabled !== false
        ? Markup.button.callback(t.saldo, `pay_saldo_${orderId}`)
        : Markup.button.callback(t.saldo + ' (Maintenance)', 'noop');

    const paymentRows = buildPaymentButtonRows(
        orderId,
        gateway.listActiveGateways(),
        settings.qris_enabled,
        t.qris,
        saldoBtn.text,
        saldoBtn.callback_data
    ).map(row => row.map(btn => ({
        ...Markup.button.callback(btn.text, btn.callback),
        style: 'primary'
    })));

    // Binance Pay — tampil hanya kalau dikonfigurasi & aktif. Flow terpisah dari QRIS
    // (QR statis + buyer submit TX ID). callback: pay_binance_<orderId>.
    const binanceRows = [];
    try {
        if (gateway.isBinanceEnabled()) {
            binanceRows.push([{ ...Markup.button.callback(t.binance, `pay_binance_${orderId}`), style: 'primary' }]);
        }
    } catch (e) { /* gateway belum siap → sembunyikan tombol */ }

    // Saldo selalu di baris sendiri, DI BAWAH Binance.
    const saldoRow = [{ ...saldoBtn, style: 'success' }];

    // Urutan final: QRIS (sejajar) → Binance → Saldo → voucher → cancel.
    return Markup.inlineKeyboard([
        ...paymentRows,
        ...binanceRows,
        saldoRow,
        [voucherBtn],
        [{ ...Markup.button.callback(t.cancel, `pay_cancel_${orderId}`), style: 'danger' }]
    ]);
};

const topupNominalKeyboard = (lang = 'id') => {
    const historyText = lang === 'en' ? '📜 Deposit History' : '📜 Riwayat Deposit';
    const green = (text, callback) => ({ ...Markup.button.callback(text, callback), style: 'success' });

    if (lang === 'en') {
        return Markup.inlineKeyboard([
            [
                green('$0.5', 'topup_usd_0.5'),
                green('$1', 'topup_usd_1')
            ],
            [
                green('$2', 'topup_usd_2'),
                green('$5', 'topup_usd_5')
            ],
            [green(historyText, 'saldo_history')]
        ]);
    }

    return Markup.inlineKeyboard([
        [
            green('Rp 5.000', 'topup_5000'),
            green('Rp 10.000', 'topup_10000')
        ],
        [
            green('Rp 25.000', 'topup_25000'),
            green('Rp 50.000', 'topup_50000')
        ],
        [green(historyText, 'saldo_history')]
    ]);
};

const paymentPendingKeyboard = (orderId, lang = 'id') => {
    const cancelText = lang === 'en' ? '× Cancel Order' : '× Batalkan Order';
    const checkText = lang === 'en' ? '↻ Check Status' : '↻ Cek Status';

    return Markup.inlineKeyboard([
        [{ ...Markup.button.callback(checkText, `pay_check_${orderId}`), style: 'primary' }],
        [{ ...Markup.button.callback(cancelText, `pay_cancel_${orderId}`), style: 'danger' }]
    ]);
};


const backToMenuKeyboard = (lang = 'id') => {
    const homeText = lang === 'en' ? '⌂ Main Menu' : '⌂ Menu Utama';
    return Markup.inlineKeyboard([
        [Markup.button.callback(homeText, 'menu_home')]
    ]);
};

const historyKeyboard = (page, totalPages, lang = 'id') => {
    const buttons = [];
    const navRow = [];

    if (page > 1) navRow.push({ ...Markup.button.callback('«', `history_${page - 1}`), style: 'primary' });
    navRow.push(Markup.button.callback(`${page}/${totalPages}`, 'noop'));
    if (page < totalPages) navRow.push({ ...Markup.button.callback('»', `history_${page + 1}`), style: 'primary' });

    if (navRow.length > 1) buttons.push(navRow);

    const homeText = lang === 'en' ? '⌂ Main Menu' : '⌂ Menu Utama';
    buttons.push([Markup.button.callback(homeText, 'menu_home')]);

    return Markup.inlineKeyboard(buttons);
};

module.exports = {
    // Admin
    adminDashboardKeyboard,
    categoryListKeyboard,
    categoryViewKeyboard,
    categoryDeleteConfirmKeyboard,
    productListKeyboard,
    productViewKeyboard,
    productStockTypeKeyboard,
    stockManageKeyboard,
    stockRemoveKeyboard,
    stockClearConfirmKeyboard,
    ordersListKeyboard,
    orderDetailKeyboard,

    orderRefundConfirmKeyboard,
    orderReplaceConfirmKeyboard,
    usersKeyboard,
    broadcastKeyboard,
    settingsKeyboard,
    navButtons,
    cancelButton,
    // User
    languageKeyboard,
    mainMenuKeyboard,
    categoriesKeyboard,
    productsKeyboard,
    quantityKeyboard,
    paymentMethodKeyboard,
    topupNominalKeyboard,
    paymentPendingKeyboard,
    backToMenuKeyboard,
    historyKeyboard,
    buildPaymentButtonRows
};
