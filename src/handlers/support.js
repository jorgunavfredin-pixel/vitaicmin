const db = require('../models/db');
const { backToMenuKeyboard } = require('../utils/keyboard');
const { escapeHtml } = require('../utils/helpers');

/**
 * Register support handler
 * @param {Object} bot - Telegraf bot instance
 */
const registerSupportHandler = (bot) => {
    bot.action('menu_support', async (ctx) => {
        const userId = ctx.from.id.toString();
        const lang = db.getUserLanguage(userId);
        await ctx.answerCbQuery();

        // Bangun pesan support secara dinamis supaya username support live dari panel
        // (locale.support_message di-evaluasi sekali saat load, jadi tidak ikut update).
        const supportUser = String(db.getConfig('support_username', 'SUPPORT_USERNAME', 'admin')).replace(/^@/, '');
        const supportHours = db.getConfig('support_hours', 'SUPPORT_HOURS', '09:00 - 22:00 WIB');
        const msg = lang === 'en'
            ? `💬 <b>Customer Support</b>\n\nFor help, please contact admin directly:\n\n👤 @${escapeHtml(supportUser)}\n\nOperating hours: ${escapeHtml(supportHours)}`
            : `💬 <b>Customer Support</b>\n\nUntuk bantuan, silakan hubungi admin langsung:\n\n👤 @${escapeHtml(supportUser)}\n\nJam operasional: ${escapeHtml(supportHours)}`;

        await ctx.editMessageText(msg, {
            parse_mode: 'HTML',
            ...backToMenuKeyboard(lang)
        });
    });
};

module.exports = { registerSupportHandler };
