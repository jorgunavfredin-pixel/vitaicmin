const db = require('../models/db');
const { backToMenuKeyboard } = require('../utils/keyboard');

/**
 * Register support handler
 * @param {Object} bot - Telegraf bot instance
 */
const registerSupportHandler = (bot) => {
    bot.action('menu_support', async (ctx) => {
        const userId = ctx.from.id.toString();
        const lang = db.getUserLanguage(userId);
        const locale = require(`../locales/${lang}`);

        await ctx.answerCbQuery();

        // Bangun pesan support secara dinamis supaya username support live dari panel
        // (locale.support_message di-evaluasi sekali saat load, jadi tidak ikut update).
        const supportUser = db.getConfig('support_username', 'SUPPORT_USERNAME', 'admin');
        const supportHours = db.getConfig('support_hours', 'SUPPORT_HOURS', '09:00 - 22:00 WIB');
        const msg = lang === 'en'
            ? `💬 *Customer Support*\n\nFor help, please contact admin directly:\n\n👤 @${supportUser}\n\nOperating hours: ${supportHours}`
            : `💬 *Customer Support*\n\nUntuk bantuan, silakan hubungi admin langsung:\n\n👤 @${supportUser}\n\nJam operasional: ${supportHours}`;

        await ctx.editMessageText(msg, {
            parse_mode: 'Markdown',
            ...backToMenuKeyboard(lang)
        });
    });
};

module.exports = { registerSupportHandler };
