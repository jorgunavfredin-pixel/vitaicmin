const db = require('../models/db');
const { escapeHtml } = require('../utils/helpers');
const { Markup } = require('telegraf');
const { editBannerCaption } = require('../utils/banner');

const buildSupportContent = (lang) => {
    const legacyUsername = String(db.getConfig('support_username', 'SUPPORT_USERNAME', '')).replace(/^@+/, '');
    const telegramUrl = db.getConfig(
        'support_telegram_url', 'SUPPORT_TELEGRAM_URL',
        legacyUsername ? `https://t.me/${legacyUsername}` : ''
    );
    const whatsappUrl = db.getConfig('support_whatsapp_url', 'SUPPORT_WHATSAPP_URL', '');
    const groupUrl = db.getConfig('support_group_url', 'SUPPORT_GROUP_URL', '');
    const channelUrl = db.getConfig('support_channel_url', 'SUPPORT_CHANNEL_URL', '');
    const supportText = String(db.getConfig('support_text', 'SUPPORT_TEXT', '')).trim();
    const prompt = lang === 'en' ? 'Choose a support option below.' : 'Pilih layanan bantuan di bawah ini.';

    let message = `<blockquote>💬 <b>Customer Support</b></blockquote>\n\n`;
    if (supportText) message += `${escapeHtml(supportText)}\n`;
    message += prompt;

    const rows = [];
    const directRow = [];
    if (whatsappUrl) directRow.push(Markup.button.url('WhatsApp', whatsappUrl));
    if (telegramUrl) directRow.push(Markup.button.url('Telegram', telegramUrl));
    if (directRow.length) rows.push(directRow);
    const communityRow = [];
    if (groupUrl) communityRow.push(Markup.button.url('Telegram Group', groupUrl));
    if (channelUrl) communityRow.push(Markup.button.url('Telegram Channel', channelUrl));
    if (communityRow.length) rows.push(communityRow);

    return { message, keyboard: { reply_markup: { inline_keyboard: rows } } };
};

const registerSupportHandler = (bot) => {
    bot.action('menu_support', async (ctx) => {
        const lang = db.getUserLanguage(ctx.from.id.toString());
        await ctx.answerCbQuery();
        const { message, keyboard } = buildSupportContent(lang);
        await editBannerCaption(ctx, message, keyboard);
    });
};

module.exports = { registerSupportHandler, buildSupportContent };
