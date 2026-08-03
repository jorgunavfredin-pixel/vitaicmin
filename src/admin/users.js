/**
 * Admin — User Management
 * Extracted from panel.js
 */
const { Markup } = require('telegraf');
const db = require('../models/db');
const { formatIDR, formatDateWIB, escapeMarkdown } = require('../utils/helpers');
const escMd = (t) => t ? escapeMarkdown(String(t)) : '';
const { usersKeyboard, navButtons, cancelButton } = require('../utils/keyboard');

function registerUserHandlers(bot, { isAdmin, adminStates }) {

    bot.action('adm_users', async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        await ctx.answerCbQuery();

        const users = db.getUsers();
        const userCount = Object.keys(users).length;
        const bannedCount = Object.values(users).filter(u => u.banned).length;

        await ctx.editMessageText(`👥 *User Management*\n\n📊 Total Users: ${userCount}\n🚫 Banned: ${bannedCount}`, {
            parse_mode: 'Markdown',
            ...usersKeyboard()
        });
    });

    // User Stats
    bot.action('adm_users_stats', async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        await ctx.answerCbQuery();

        const users = db.getUsers();
        const orders = db.getOrders().filter(o => o.status === 'delivered');
        const userEntries = Object.entries(users);

        const spendMap = {};
        orders.forEach(o => {
            if (!spendMap[o.user_id]) spendMap[o.user_id] = { total: 0, count: 0 };
            spendMap[o.user_id].total += (o.total_idr || 0);
            spendMap[o.user_id].count += 1;
        });

        const topSpenders = Object.entries(spendMap)
            .sort((a, b) => b[1].total - a[1].total)
            .slice(0, 5);

        let msg = `📊 *User Stats*\n\n👥 Total: ${userEntries.length}\n🛒 Active Buyers: ${Object.keys(spendMap).length}\n\n`;
        msg += `💰 *Top 5 Spenders:*\n`;

        const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'];
        topSpenders.forEach(([uid, data], i) => {
            const u = users[uid];
            const name = u?.username ? '@' + escMd(u.username) : escMd(u?.first_name) || uid;
            msg += `${medals[i]} ${name} — Rp ${formatIDR(data.total)} (${data.count}x)\n`;
        });

        const buttons = [];
        topSpenders.forEach(([uid]) => {
            const u = users[uid];
            const name = u?.username ? '@' + escMd(u.username) : escMd(u?.first_name) || uid;
            buttons.push([Markup.button.callback(`👤 ${name}`, `adm_user_view_${uid}`)]);
        });
        buttons.push(...navButtons('adm_users'));

        await ctx.editMessageText(msg, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: buttons }
        });
    });

    // Search User
    bot.action('adm_users_search', async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        await ctx.answerCbQuery();

        adminStates.setFor(ctx, { action: 'search_user' });

        await ctx.editMessageText('🔎 *Cari User*\n\nKirim username atau User ID:', {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: cancelButton() }
        });
    });

    // Banned Users List
    bot.action('adm_users_banned', async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        await ctx.answerCbQuery();

        const users = db.getUsers();
        const banned = Object.entries(users).filter(([_, u]) => u.banned);

        let msg = `🚫 *Banned Users*\n\n`;
        if (banned.length === 0) {
            msg += '_Tidak ada user yang di-ban_';
        } else {
            banned.forEach(([uid, u]) => {
                const name = u.username ? '@' + escMd(u.username) : escMd(u.first_name) || uid;
                msg += `🔴 ${name} (ID: ${uid})\n`;
            });
        }

        const buttons = banned.map(([uid, u]) => {
            const name = u.username ? '@' + escMd(u.username) : escMd(u.first_name) || uid;
            return [Markup.button.callback(`👤 ${name}`, `adm_user_view_${uid}`)];
        });
        buttons.push(...navButtons('adm_users'));

        await ctx.editMessageText(msg, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: buttons }
        });
    });

    // User Detail View (edits current message)
    bot.action(/^adm_user_view_(.+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        await ctx.answerCbQuery();

        const userId = ctx.match[1];
        await showUserDetail(ctx, userId);
    });

    // User Detail View — new message (doesn't edit parent message)
    bot.action(/^adm_user_info_(.+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        await ctx.answerCbQuery();

        const userId = ctx.match[1];
        await showUserDetail(ctx, userId, true);
    });

    // Ban/Unban Toggle
    bot.action(/^adm_user_ban_(.+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;

        const userId = ctx.match[1];
        const user = db.getUser(userId);
        if (!user) return;

        const newBan = !user.banned;
        const updated = db.createOrUpdateUser(userId, { banned: newBan });
        db.dbEvents.emit('user_change', { type: 'ban_updated', user: updated });

        const name = user.username ? '@' + user.username : user.first_name || userId;
        await ctx.answerCbQuery(`${newBan ? '🚫 Banned' : '✅ Unbanned'}: ${name}`, { show_alert: true });

        await showUserDetail(ctx, userId);
    });

    // Shared helper to render user detail
    async function showUserDetail(ctx, userId, asNewMessage = false) {
        const user = db.getUser(userId);
        if (!user) {
            const noUserMsg = '❌ User tidak ditemukan.';
            const opts = { reply_markup: { inline_keyboard: navButtons('adm_users') } };
            if (asNewMessage) await ctx.reply(noUserMsg, opts);
            else await ctx.editMessageText(noUserMsg, opts);
            return;
        }

        const orders = db.getOrdersByUser(userId);
        const delivered = orders.filter(o => o.status === 'delivered');
        const totalSpend = delivered.reduce((sum, o) => sum + (o.total_idr || 0), 0);

        const banned = user.banned ? '🔴 BANNED' : '🟢 Active';
        const joinDate = user.created_at ? formatDateWIB(user.created_at) : '-';

        let msg = `👤 *User Detail*\n\n`;
        msg += `┏━━━━━━━━━━━━━━━━━━\n`;
        msg += `┃ 📛 ${escMd(user.first_name) || '-'}`;
        if (user.last_name) msg += ` ${escMd(user.last_name)}`;
        msg += `\n`;
        msg += `┃ 🔗 ${user.username ? '@' + escMd(user.username) : '-'}\n`;
        msg += `┃ 🆔 ${userId}\n`;
        msg += `┃ 📋 Status: ${banned}\n`;
        msg += `┃ 📅 Joined: ${joinDate}\n`;
        msg += `┃ 🌐 Lang: ${user.language || 'id'}\n`;
        msg += `┣━━━━━━━━━━━━━━━━━━\n`;
        msg += `┃ 🛒 Total Orders: ${orders.length}\n`;
        msg += `┃ ✅ Delivered: ${delivered.length}\n`;
        msg += `┃ 💰 Total Spend: Rp ${formatIDR(totalSpend)}\n`;
        msg += `┗━━━━━━━━━━━━━━━━━━\n`;

        if (delivered.length > 0) {
            msg += `\n📜 *Last 5 Orders:*\n`;
            delivered.slice(0, 5).forEach(o => {
                const prodName = o.product_id === 'TOPUP' ? '💰 Topup Saldo' : (db.getProductById(o.product_id)?.name_id || '?');
                const date = o.created_at ? formatDateWIB(o.created_at) : '-';
                msg += `• ${o.id} — ${prodName} — Rp ${formatIDR(o.total_idr || 0)} (${date})\n`;
            });
        }

        const banLabel = user.banned ? '✅ Unban User' : '🚫 Ban User';
        const opts = {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [Markup.button.callback(banLabel, `adm_user_ban_${userId}`)],
                    ...navButtons('adm_users')
                ]
            }
        };

        if (asNewMessage) await ctx.reply(msg, opts);
        else await ctx.editMessageText(msg, opts);
    }
}

// Input handler
async function handleSearchUser(ctx, text, adminStates) {
    adminStates.delete(ctx.from.id.toString());
    const users = db.getUsers();
    const query = text.toLowerCase().trim();

    const results = Object.entries(users).filter(([uid, u]) => {
        return uid === query ||
            (u.username && u.username.toLowerCase().includes(query)) ||
            (u.first_name && u.first_name.toLowerCase().includes(query));
    });

    if (results.length === 0) {
        await ctx.reply('❌ User tidak ditemukan.', {
            reply_markup: { inline_keyboard: navButtons('adm_users') }
        });
        return;
    }

    const buttons = results.slice(0, 10).map(([uid, u]) => {
        const name = u.username ? '@' + u.username : u.first_name || uid;
        const bannedTag = u.banned ? ' 🔴' : '';
        return [Markup.button.callback(`👤 ${name}${bannedTag}`, `adm_user_view_${uid}`)];
    });
    buttons.push(...navButtons('adm_users'));

    await ctx.reply(`🔎 Ditemukan ${results.length} user:`, {
        reply_markup: { inline_keyboard: buttons }
    });
}

module.exports = { registerUserHandlers, handleSearchUser };
