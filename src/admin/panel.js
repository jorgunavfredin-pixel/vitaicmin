/**
 * Admin Panel — Orchestrator
 * 
 * This file was refactored from a 2632-line monolith into a thin orchestrator.
 * Each feature area is now in its own module:
 *   - vouchers.js  → Voucher CRUD
 *   - products.js  → Category/Product/Stock + Product Stats
 *   - orders.js    → Order Management (view, redeliver, replace, refund)
 *   - users.js     → User Management (stats, search, ban/unban)
 *   - broadcast.js → Broadcast System
 *   - settings.js  → Settings & Backup
 *   - saldo.js     → Saldo (Balance) Management
 *   - stats.js     → Dashboard Stats (pre-existing)
 */

const { Markup } = require('telegraf');
const fs = require('fs');
const path = require('path');
const db = require('../models/db');
const statsModule = require('./stats');
const { formatIDR, formatDateWIB, getWIBToday, getWIBDateRange, escapeMarkdown } = require('../utils/helpers');
const escMd = (t) => t ? escapeMarkdown(String(t)) : '';
const { adminDashboardKeyboard, navButtons, cancelButton } = require('../utils/keyboard');

// Sub-module imports
const { registerVoucherHandlers, handleCreateVoucher } = require('./vouchers');
const { registerProductHandlers, handleAddCategory, handleEditCatName, handleAddProduct, handleEditProduct, handleAddStock, handleRemoveStockSearch, handleFlashSaleInput } = require('./products');
const { registerOrderHandlers } = require('./orders');
const { registerUserHandlers, handleSearchUser } = require('./users');
const { registerBroadcastHandlers, handleBroadcast, handleBroadcastCategory } = require('./broadcast');
const { registerSettingsHandlers } = require('./settings');
const { registerSaldoHandlers } = require('./saldo');
const { AdminStateManager } = require('./state');
const { adjustUserBalance } = require('../services/adminBalance');

const ADMIN_IDS = (process.env.ADMIN_ID || '').split(',').map(id => id.trim()).filter(Boolean);
const adminStates = new AdminStateManager();

const isAdmin = (userId) => ADMIN_IDS.includes(userId.toString());

/**
 * Get dashboard stats
 */
const getDashboardStats = () => {
    const orders = db.getOrders();
    const users = db.getUsers();
    const products = db.getProducts();
    const settings = db.getSettings();
    const today = getWIBToday();

    const pending = orders.filter(o => o.status === 'pending').length;
    const delivered = orders.filter(o => o.status === 'delivered').length;
    const totalOrders = orders.length;

    const { todayStart } = getWIBDateRange();
    const todayOrders = orders.filter(o => o.created_at && o.created_at >= todayStart);
    const todayDelivered = todayOrders.filter(o => o.status === 'delivered');
    const todayRevenue = todayDelivered.reduce((sum, o) => sum + (o.total_idr || 0), 0);
    const todayOrderCount = todayOrders.length;
    const todayNewUsers = Object.values(users).filter(u => u.created_at && u.created_at >= todayStart).length;

    const totalRevenue = orders.filter(o => o.status === 'delivered').reduce((sum, o) => sum + (o.total_idr || 0), 0);
    const totalUsers = Object.keys(users).length;

    const activeProducts = products.filter(p => p.active !== false);
    const totalStock = activeProducts.reduce((sum, p) => sum + db.getAvailableStockCount(p.id), 0);
    const lowStockCount = activeProducts.filter(p => {
        if (p.stock_mode === 'unlimited') return false;
        return db.getAvailableStockCount(p.id) < 3;
    }).length;

    const salesMap = {};
    orders.filter(o => o.status === 'delivered' && o.product_id !== 'TOPUP').forEach(o => {
        if (!salesMap[o.product_id]) salesMap[o.product_id] = 0;
        salesMap[o.product_id] += (o.quantity || 1);
    });
    const topProduct = Object.entries(salesMap).sort((a, b) => b[1] - a[1])[0];
    let bestSeller = null;
    if (topProduct) {
        const prod = db.getProductById(topProduct[0]);
        bestSeller = { name: prod?.name_id || '?', count: topProduct[1] };
    }

    return {
        pending, delivered, totalOrders, todayOrderCount, todayRevenue, todayNewUsers,
        totalRevenue, totalUsers, activeProducts: activeProducts.length,
        totalStock, lowStockCount, bestSeller, maintenance: settings.maintenance
    };
};

/**
 * Register all admin handlers
 */
const registerAdminHandler = (bot) => {

    // Any admin callback is navigation. Clear stale text-wizard state unless the
    // callback is an explicit continuation of the current flash-sale wizard.
    bot.use(async (tgCtx, next) => {
        if (!tgCtx.callbackQuery || !isAdmin(tgCtx.from?.id)) return next();
        const data = String(tgCtx.callbackQuery.data || '');
        const keepsWizard = /^adm_fs_(?:type|duration|dur|confirm)_/.test(data);
        if (!keepsWizard) adminStates.clearFor(tgCtx);
        return next();
    });

    // Shared context for sub-modules
    const ctx = { isAdmin, adminStates, showDashboard, escMd };

    // ==================== DASHBOARD ====================
    bot.command('admin', async (tgCtx) => {
        if (!isAdmin(tgCtx.from.id)) return;
        await showDashboard(tgCtx, false);
    });

    bot.action('admin_home', async (tgCtx) => {
        if (!isAdmin(tgCtx.from.id)) return;
        await tgCtx.answerCbQuery();
        await showDashboard(tgCtx, true);
    });

    bot.action('adm_refresh', async (tgCtx) => {
        if (!isAdmin(tgCtx.from.id)) return;
        await tgCtx.answerCbQuery('🔄 Refreshed!');
        await showDashboard(tgCtx, true);
    });

    // ==================== STATS MODULE ====================
    bot.action('adm_stats_menu', async (tgCtx) => {
        if (!isAdmin(tgCtx.from.id)) return;
        await tgCtx.answerCbQuery();
        await statsModule.showStatsMenu(tgCtx);
    });

    bot.action(/^adm_stats_(.+)$/, async (tgCtx) => {
        if (!isAdmin(tgCtx.from.id)) return;
        await tgCtx.answerCbQuery();
        await statsModule.handleStatsAction(tgCtx, tgCtx.match[1]);
    });

    // ==================== REGISTER SUB-MODULES ====================
    registerVoucherHandlers(bot, ctx);
    registerProductHandlers(bot, ctx);
    registerOrderHandlers(bot, ctx);
    registerUserHandlers(bot, ctx);
    registerBroadcastHandlers(bot, ctx);
    registerSettingsHandlers(bot, ctx);
    registerSaldoHandlers(bot, ctx);

    // ==================== CANCEL ====================
    bot.action('admin_cancel', async (tgCtx) => {
        if (!isAdmin(tgCtx.from.id)) return;
        await tgCtx.answerCbQuery();
        adminStates.delete(tgCtx.from.id.toString());
        await showDashboard(tgCtx, true);
    });

    bot.action('noop', async (tgCtx) => {
        await tgCtx.answerCbQuery();
    });

    // ==================== TEXT INPUT HANDLER ====================
    bot.on('text', async (tgCtx, next) => {
        if (!isAdmin(tgCtx.from.id)) return next();

        const state = adminStates.getFor(tgCtx);
        if (!state) return next();

        const text = tgCtx.message.text;

        try {
            switch (state.action) {
                case 'add_category':
                    await handleAddCategory(tgCtx, state, text, adminStates);
                    break;
                case 'edit_cat_name':
                    await handleEditCatName(tgCtx, state, text, adminStates);
                    break;
                case 'add_product':
                    await handleAddProduct(tgCtx, state, text, adminStates);
                    break;
                case 'edit_prod':
                    await handleEditProduct(tgCtx, state, text, adminStates);
                    break;
                case 'add_stock':
                case 'import_stock':
                    await handleAddStock(tgCtx, state, text, adminStates);
                    break;
                case 'rm_stock_search':
                    await handleRemoveStockSearch(tgCtx, state, text, adminStates);
                    break;
                case 'broadcast':
                    await handleBroadcast(tgCtx, adminStates);
                    break;
                case 'broadcast_category':
                    await handleBroadcastCategory(tgCtx, state, adminStates);
                    break;
                case 'create_voucher':
                    await handleCreateVoucher(tgCtx, state, text, adminStates);
                    break;
                case 'search_user':
                    await handleSearchUser(tgCtx, text, adminStates);
                    break;
                case 'fs_set_price':
                case 'fs_custom_duration':
                    await handleFlashSaleInput(tgCtx, state, text, adminStates);
                    break;
                case 'saldo_search': {
                    const targetUser = db.getUser(text.trim());
                    adminStates.delete(tgCtx.from.id.toString());
                    if (!targetUser) {
                        await tgCtx.reply(`❌ User ID \`${text.trim()}\` tidak ditemukan.`, {
                            parse_mode: 'Markdown',
                            reply_markup: { inline_keyboard: navButtons('adm_saldo') }
                        });
                    } else {
                        await tgCtx.reply(`✅ User ditemukan!`, {
                            reply_markup: {
                                inline_keyboard: [
                                    [Markup.button.callback(`👤 ${targetUser.first_name || text.trim()}`, `adm_saldo_user_${text.trim()}`)],
                                    ...navButtons('adm_saldo')
                                ]
                            }
                        });
                    }
                    break;
                }
                case 'saldo_add':
                case 'saldo_deduct':
                case 'saldo_set': {
                    const amount = parseInt(text.replace(/[^0-9]/g, ''));
                    const allowZero = state.action === 'saldo_set';
                    if (isNaN(amount) || amount < (allowZero ? 0 : 1)) {
                        await tgCtx.reply('❌ Nominal tidak valid.');
                        break;
                    }
                    state.amount = amount;
                    state.balanceAction = state.action.replace('saldo_', '');
                    state.action = 'saldo_note';
                    adminStates.setFor(tgCtx, state);
                    await tgCtx.reply('📝 Kirim catatan/alasan penyesuaian saldo:');
                    break;
                }
                case 'saldo_note': {
                    const note = text.trim();
                    if (!note) { await tgCtx.reply('❌ Catatan wajib diisi.'); break; }
                    const result = adjustUserBalance({ userId: state.targetUserId, action: state.balanceAction, amount: state.amount, note, actorId: tgCtx.from.id, channel: 'telegram' });
                    adminStates.delete(tgCtx.from.id.toString());
                    await tgCtx.reply(`✅ Saldo berhasil diperbarui!\n\n👤 User: \`${state.targetUserId}\`\n💵 Saldo baru: Rp ${formatIDR(result.balance)}\n📝 ${note}`, {
                        parse_mode: 'Markdown',
                        reply_markup: { inline_keyboard: [[Markup.button.callback('👤 Lihat User', `adm_saldo_user_${state.targetUserId}`)], ...navButtons('adm_saldo')] }
                    });
                    break;
                }
                default:
                    return next();
            }
        } catch (error) {
            console.error('Admin handler error:', error);
            await tgCtx.reply('❌ Error: ' + error.message);
        }
    });

    // ==================== PHOTO HANDLER (Broadcast) ====================
    bot.on('photo', async (tgCtx, next) => {
        if (!isAdmin(tgCtx.from.id)) return next();

        const state = adminStates.getFor(tgCtx);
        if (!state) return next();

        try {
            if (state.action === 'broadcast') {
                await handleBroadcast(tgCtx, adminStates);
            } else if (state.action === 'broadcast_category') {
                await handleBroadcastCategory(tgCtx, state, adminStates);
            } else {
                return next();
            }
        } catch (error) {
            console.error('Admin photo handler error:', error);
            await tgCtx.reply('❌ Error: ' + error.message);
        }
    });

    // ==================== DOCUMENT HANDLER (File Import) ====================
    bot.on('document', async (tgCtx, next) => {
        if (!isAdmin(tgCtx.from.id)) return next();

        const state = adminStates.getFor(tgCtx);
        if (!state || state.action !== 'import_stock') return next();

        const doc = tgCtx.message.document;
        if (!doc.file_name.endsWith('.txt')) {
            await tgCtx.reply('❌ Hanya file .txt yang didukung.');
            return;
        }

        try {
            const fileLink = await tgCtx.telegram.getFileLink(doc.file_id);
            const https = require('https');
            const http = require('http');
            const protocol = fileLink.href.startsWith('https') ? https : http;

            const fileContent = await new Promise((resolve, reject) => {
                protocol.get(fileLink.href, (res) => {
                    let data = '';
                    res.on('data', chunk => data += chunk);
                    res.on('end', () => resolve(data));
                    res.on('error', reject);
                });
            });

            const lines = fileContent.split('\n').filter(l => l.trim());
            if (lines.length === 0) {
                await tgCtx.reply('❌ File kosong.');
                return;
            }

            const added = db.addBulkStock(state.prodId, lines);
            const total = db.getAvailableStockCount(state.prodId);
            adminStates.delete(tgCtx.from.id.toString());

            await tgCtx.reply(`✅ Import berhasil!\n\n📦 ${added.length} item ditambahkan dari file\n📊 Total stok: ${total}`, {
                reply_markup: { inline_keyboard: navButtons(`adm_stock_prod_${state.prodId}`) }
            });
        } catch (error) {
            console.error('File import error:', error);
            await tgCtx.reply('❌ Error membaca file: ' + error.message);
        }
    });

    // Dashboard helper
    async function showDashboard(tgCtx, edit = true) {
        const s = getDashboardStats();
        const now = new Date();
        const timeStr = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' });
        const dateStr = now.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Jakarta' });
        const statusIcon = s.maintenance ? '🔴' : '🟢';
        const statusText = s.maintenance ? 'Maintenance' : 'Online';

        const msg = `📊 *Admin Panel* ━━━━━

${statusIcon} Bot Status: *${statusText}*
⏰ ${timeStr} WIB — ${dateStr}

📈 *TODAY*
├ 🛒 Orders: ${s.todayOrderCount}
├ 💰 Revenue: Rp ${formatIDR(s.todayRevenue)}
└ 👤 New Users: ${s.todayNewUsers}

📊 *ALL TIME*
├ 🛒 Total Orders: ${s.totalOrders}
├ ✅ Delivered: ${s.delivered}
├ ⏳ Pending: ${s.pending}
├ 💰 Total Revenue: Rp ${formatIDR(s.totalRevenue)}
└ 👥 Total Users: ${s.totalUsers}

📦 *STOCK*
├ 📁 Products: ${s.activeProducts}
├ 📊 Available: ${s.totalStock} items
└ ${s.lowStockCount > 0 ? '⚠️' : '✅'} Low Stock: ${s.lowStockCount} produk

🏆 Best Seller: ${s.bestSeller ? s.bestSeller.name + ' (' + s.bestSeller.count + 'x)' : '_Belum ada_'}`;

        if (edit) {
            try {
                await tgCtx.editMessageText(msg, {
                    parse_mode: 'Markdown',
                    ...adminDashboardKeyboard()
                });
            } catch (e) {
                if (!e.message?.includes('message is not modified')) throw e;
            }
        } else {
            await tgCtx.reply(msg, {
                parse_mode: 'Markdown',
                ...adminDashboardKeyboard()
            });
        }
    }
};

module.exports = { registerAdminHandler, adminStates };
