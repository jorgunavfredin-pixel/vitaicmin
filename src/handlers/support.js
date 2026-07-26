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
        await ctx.editMessageText(locale.support_message, {
            parse_mode: 'Markdown',
            ...backToMenuKeyboard(lang)
        });
    });
};

module.exports = { registerSupportHandler };
