/**
 * Admin — Saldo (Balance) Management
 * Extracted from panel.js
 */
const { Markup } = require('telegraf');
const db = require('../models/db');
const { formatIDR, escapeMarkdown } = require('../utils/helpers');
const escMd = (t) => t ? escapeMarkdown(String(t)) : '';
const { navButtons } = require('../utils/keyboard');
const { getBalance, getAllBalances, getBalanceHistory, addBalance, setBalance } = require('../payments/balance');

function registerSaldoHandlers(bot, { isAdmin, adminStates }) {

    const SALDO_PER_PAGE = 8;

    // Shared function to show saldo list (paginated)
    async function showSaldoList(ctx, page = 1) {
        const allBalances = getAllBalances();
        const totalBalance = allBalances.reduce((sum, u) => sum + u.balance, 0);
        const totalPages = Math.max(1, Math.ceil(allBalances.length / SALDO_PER_PAGE));
        page = Math.min(page, totalPages);

        const start = (page - 1) * SALDO_PER_PAGE;
        const pageUsers = allBalances.slice(start, start + SALDO_PER_PAGE);

        let msg = `💰 *MANAJEMEN SALDO*\n\n`;
        msg += `👥 User dengan saldo: *${allBalances.length}*\n`;
        msg += `💵 Total saldo beredar: *Rp ${formatIDR(totalBalance)}*\n`;
        if (totalPages > 1) msg += `📄 Halaman: *${page}/${totalPages}*\n`;

        const buttons = [];
        pageUsers.forEach(u => {
            const user = db.getUser(u.userId);
            const name = user?.first_name || u.userId;
            buttons.push([Markup.button.callback(
                `👤 ${name} — Rp ${formatIDR(u.balance)}`,
                `adm_saldo_user_${u.userId}`
            )]);
        });

        // Pagination buttons
        if (totalPages > 1) {
            const navRow = [];
            if (page > 1) navRow.push(Markup.button.callback('◀️ Prev', `adm_saldo_page_${page - 1}`));
            navRow.push(Markup.button.callback(`${page}/${totalPages}`, 'noop'));
            if (page < totalPages) navRow.push(Markup.button.callback('Next ▶️', `adm_saldo_page_${page + 1}`));
            buttons.push(navRow);
        }

        buttons.push([Markup.button.callback('🔎 Cari User by ID', 'adm_saldo_search')]);
        buttons.push([Markup.button.callback('◀️ Kembali', 'admin_home')]);

        await ctx.editMessageText(msg, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: buttons }
        });
    }

    // Saldo overview (page 1)
    bot.action('adm_saldo', async (ctx) => {
        if (!isAdmin(ctx.from.id.toString())) return;
        await ctx.answerCbQuery();
        await showSaldoList(ctx, 1);
    });

    // Saldo pagination
    bot.action(/^adm_saldo_page_(\d+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id.toString())) return;
        await ctx.answerCbQuery();
        await showSaldoList(ctx, parseInt(ctx.match[1]));
    });

    // Search user by ID
    bot.action('adm_saldo_search', async (ctx) => {
        if (!isAdmin(ctx.from.id.toString())) return;
        await ctx.answerCbQuery();
        adminStates.set(ctx.from.id.toString(), { action: 'saldo_search' });

        await ctx.editMessageText('🔎 *Cari User*\n\nKetik User ID:', {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[Markup.button.callback('❌ Batal', 'adm_saldo')]] }
        });
    });

    // View user balance detail
    bot.action(/^adm_saldo_user_(.+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id.toString())) return;
        await ctx.answerCbQuery();
        const targetUserId = ctx.match[1];
        await showUserBalance(ctx, targetUserId);
    });

    async function showUserBalance(ctx, targetUserId) {
        const user = db.getUser(targetUserId);
        const balance = getBalance(targetUserId);
        const history = getBalanceHistory(targetUserId, 10);

        let msg = `💰 *SALDO USER*\n\n`;
        msg += `👤 *User:* ${escMd(user?.first_name || 'Unknown')} (\`${targetUserId}\`)\n`;
        if (user?.username) msg += `📎 @${escMd(user.username)}\n`;
        msg += `💵 *Saldo:* Rp ${formatIDR(balance)}\n\n`;

        if (history.length > 0) {
            msg += `📜 *Riwayat (10 terakhir):*\n`;
            history.forEach(h => {
                const icon = h.amount >= 0 ? '➕' : '➖';
                const absAmount = Math.abs(h.amount);
                const date = new Date(h.created_at).toLocaleString('id-ID', {
                    timeZone: 'Asia/Jakarta', day: '2-digit', month: '2-digit',
                    year: '2-digit', hour: '2-digit', minute: '2-digit'
                });
                msg += `${icon} Rp ${formatIDR(absAmount)} — ${date}\n`;
                if (h.note) msg += `    _${h.note}_\n`;
            });
        } else {
            msg += `📭 Belum ada riwayat.\n`;
        }

        await ctx.editMessageText(msg, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [Markup.button.callback('➕ Tambah Saldo', `adm_saldo_add_${targetUserId}`)],
                    [Markup.button.callback('➖ Kurangi Saldo', `adm_saldo_deduct_${targetUserId}`)],
                    [Markup.button.callback('🔧 Set Saldo', `adm_saldo_set_${targetUserId}`)],
                    [Markup.button.callback('◀️ Kembali', 'adm_saldo')]
                ]
            }
        });
    }

    // Add balance
    bot.action(/^adm_saldo_add_(.+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id.toString())) return;
        await ctx.answerCbQuery();
        const targetUserId = ctx.match[1];
        adminStates.set(ctx.from.id.toString(), { action: 'saldo_add', targetUserId });

        await ctx.editMessageText(`➕ *Tambah Saldo*\n\n👤 User: \`${targetUserId}\`\n💵 Saldo saat ini: Rp ${formatIDR(getBalance(targetUserId))}\n\nKetik nominal yang ingin ditambahkan:`, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[Markup.button.callback('❌ Batal', `adm_saldo_user_${targetUserId}`)]] }
        });
    });

    // Deduct balance
    bot.action(/^adm_saldo_deduct_(.+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id.toString())) return;
        await ctx.answerCbQuery();
        const targetUserId = ctx.match[1];
        adminStates.set(ctx.from.id.toString(), { action: 'saldo_deduct', targetUserId });

        await ctx.editMessageText(`➖ *Kurangi Saldo*\n\n👤 User: \`${targetUserId}\`\n💵 Saldo saat ini: Rp ${formatIDR(getBalance(targetUserId))}\n\nKetik nominal yang ingin dikurangi:`, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[Markup.button.callback('❌ Batal', `adm_saldo_user_${targetUserId}`)]] }
        });
    });

    // Set balance
    bot.action(/^adm_saldo_set_(.+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id.toString())) return;
        await ctx.answerCbQuery();
        const targetUserId = ctx.match[1];
        adminStates.set(ctx.from.id.toString(), { action: 'saldo_set', targetUserId });

        await ctx.editMessageText(`🔧 *Set Saldo*\n\n👤 User: \`${targetUserId}\`\n💵 Saldo saat ini: Rp ${formatIDR(getBalance(targetUserId))}\n\nKetik nominal saldo baru:`, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[Markup.button.callback('❌ Batal', `adm_saldo_user_${targetUserId}`)]] }
        });
    });
}

// Input handlers for saldo operations
function handleSaldoInput(ctx, state, text) {
    // This is handled inline in panel.js text handler since it needs balance module
    // Kept as placeholder — actual logic moved to panel.js switch cases
}

module.exports = { registerSaldoHandlers };
