const db = require('../models/db');
const { formatIDR, formatUSD, convertIDRtoUSD, escapeHtml } = require('../utils/helpers');
const { getBalance } = require('../payments/balance');
const { languageKeyboard, mainMenuKeyboard } = require('../utils/keyboard');
const { replyWithBanner } = require('../utils/banner');

// Generate dynamic welcome message
const generateWelcome = async (ctx, lang = 'id') => {
    const userId = ctx.from.id.toString();
    const firstName = escapeHtml(ctx.from.first_name || 'User');
    const username = ctx.from.username ? escapeHtml(`@${ctx.from.username}`) : '-';

    // Get user transaction total
    const userOrders = db.getOrdersByUser(userId);
    const userTotal = userOrders
        .filter(o => o.status === 'delivered' || o.status === 'paid')
        .reduce((sum, o) => sum + o.total_idr, 0);

    // Get bot stats
    const allOrders = db.getOrders();
    const soldOrders = allOrders.filter(o => o.status === 'delivered' || o.status === 'paid');
    const totalSold = soldOrders.reduce((sum, o) => sum + o.quantity, 0);
    const totalUsers = Object.keys(db.getUsers()).length;

    // Format date
    const now = new Date();
    const days = lang === 'en'
        ? ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
        : ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
    const months = lang === 'en'
        ? ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
        : ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

    const dateStr = `${days[now.getDay()]}, ${now.getDate().toString().padStart(2, '0')} ${months[now.getMonth()]} ${now.getFullYear()} ${now.toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta' })}`;

    const userBalance = getBalance(userId);

    if (lang === 'en') {
        const balanceUSD = await convertIDRtoUSD(userBalance);
        return `<b>Hello ${firstName} 👋🏼</b>
${dateStr} (GMT+7)

<b>User Info :</b>
└ <b>ID :</b> <code>${userId}</code>
└ <b>Username :</b> ${username}
└ <b>Balance :</b> $${formatUSD(balanceUSD)}
└ <b>Transactions :</b> $${formatUSD(await convertIDRtoUSD(userTotal))}

<b>BOT Stats :</b>
└ <b>Sold :</b> ${totalSold} pcs
└ <b>Total Users :</b> ${totalUsers}

<b>Shortcuts :</b>
/start – Start bot
<b>Click menu to check products &amp; stock</b> 👇`;
    }

    return `<b>Halo ${firstName} 👋🏼</b>
${dateStr}

<b>User Info :</b>
└ <b>ID :</b> <code>${userId}</code>
└ <b>Username :</b> ${username}
└ <b>Saldo :</b> Rp ${formatIDR(userBalance)}
└ <b>Transaksi :</b> Rp ${formatIDR(userTotal)}

<b>BOT Stats :</b>
└ <b>Terjual :</b> ${totalSold} pcs
└ <b>Total User :</b> ${totalUsers}

<b>Shortcuts :</b>
/start – Mulai bot
<b>Klik menu untuk cek produk &amp; stok</b> 👇`;
};

/**
 * Register start handler
 * @param {Object} bot - Telegraf bot instance
 */
const registerStartHandler = (bot) => {
    // /start command
    bot.start(async (ctx) => {
        const userId = ctx.from.id.toString();
        const user = db.getUser(userId);
        // Check if new user
        const isNewUser = !user;

        // Save/update user info
        db.createOrUpdateUser(userId, {
            username: ctx.from.username || null,
            first_name: ctx.from.first_name || null,
            last_name: ctx.from.last_name || null
        });

        // Notify Admin for New User
        if (isNewUser) {
            const firstName = escapeHtml(ctx.from.first_name || 'User');
            const lastName = escapeHtml(ctx.from.last_name || '');
            const fullName = `${firstName}${lastName ? ' ' + lastName : ''}`;
            const usernameDisplay = ctx.from.username ? escapeHtml(`@${ctx.from.username}`) : '-';
            const totalUsers = Object.keys(db.getUsers()).length;

            const msg = `👀 <b>NEW USER!</b>\n├ 🎭 Nama: ${fullName}\n├ 🆔 ID: <code>${userId}</code>\n└ 👤 Username: ${usernameDisplay}\n<b>📊 Total User Saat Ini: ${totalUsers}</b>`;
            try {
                const { notifyAdmins } = require('../utils/helpers');
                await notifyAdmins(ctx.telegram, msg, { parse_mode: 'HTML' });
            } catch (e) {
                console.error('Failed to notify admin about new user:', e);
            }
        }

        // If user already has language set, show main menu
        if (user && user.language) {
            const welcome = await generateWelcome(ctx, user.language);
            await replyWithBanner(ctx, welcome, mainMenuKeyboard(user.language, userId));
        } else {
            // Show language selection
            const localeId = require('../locales/id');
            await ctx.reply(localeId.select_language, {
                parse_mode: 'Markdown',
                ...languageKeyboard()
            });
        }
    });

    // Language selection callbacks
    bot.action('lang_id', async (ctx) => {
        const userId = ctx.from.id.toString();
        db.setUserLanguage(userId, 'id');

        const locale = require('../locales/id');
        await ctx.answerCbQuery(locale.language_set);

        // Delete language selection message
        try { await ctx.deleteMessage(); } catch (e) { }

        const welcome = await generateWelcome(ctx, 'id');
        await replyWithBanner(ctx, welcome, mainMenuKeyboard('id', userId));
    });

    bot.action('lang_en', async (ctx) => {
        const userId = ctx.from.id.toString();
        db.setUserLanguage(userId, 'en');

        const locale = require('../locales/en');
        await ctx.answerCbQuery(locale.language_set);

        // Delete language selection message
        try { await ctx.deleteMessage(); } catch (e) { }

        const welcome = await generateWelcome(ctx, 'en');
        await replyWithBanner(ctx, welcome, mainMenuKeyboard('en', userId));
    });

    // Change language from menu (inline callback)
    bot.action('menu_language', async (ctx) => {
        const localeId = require('../locales/id');
        await ctx.answerCbQuery();
        try { await ctx.deleteMessage(); } catch (e) { }
        await ctx.reply(localeId.select_language, {
            parse_mode: 'Markdown',
            ...languageKeyboard()
        });
    });

    // Back to home/main menu
    bot.action('menu_home', async (ctx) => {
        const userId = ctx.from.id.toString();
        const lang = db.getUserLanguage(userId);

        await ctx.answerCbQuery();

        // Delete inline message and send new with reply keyboard
        try { await ctx.deleteMessage(); } catch (e) { }

        const welcome = await generateWelcome(ctx, lang);
        await replyWithBanner(ctx, welcome, mainMenuKeyboard(lang, userId));
    });
};

module.exports = { registerStartHandler };
