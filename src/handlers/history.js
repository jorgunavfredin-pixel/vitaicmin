const db = require('../models/db');
const { formatIDR, formatUSD, formatDateWIB, replacePlaceholders } = require('../utils/helpers');
const { historyKeyboard, mainMenuKeyboard } = require('../utils/keyboard');

/**
 * Register history handler
 * @param {Object} bot - Telegraf bot instance
 */
const registerHistoryHandler = (bot) => {
    bot.action(/^menu_history$|^history_(\d+)$/, async (ctx) => {
        const userId = ctx.from.id.toString();
        const lang = db.getUserLanguage(userId);
        const locale = require(`../locales/${lang}`);

        const page = ctx.match[1] ? parseInt(ctx.match[1]) : 1;
        const perPage = 5;

        const orders = db.getOrdersByUser(userId);

        await ctx.answerCbQuery();

        if (orders.length === 0) {
            await ctx.editMessageText(locale.history_empty, {
                parse_mode: 'Markdown',
                ...mainMenuKeyboard(lang)
            });
            return;
        }

        const totalPages = Math.ceil(orders.length / perPage);
        const startIdx = (page - 1) * perPage;
        const pageOrders = orders.slice(startIdx, startIdx + perPage);

        let message = locale.history_title;

        for (const order of pageOrders) {
            const product = db.getProductById(order.product_id);
            const productName = lang === 'en' ? product?.name_en : product?.name_id;

            const statusKey = `status_${order.status}`;
            const status = locale[statusKey] || order.status;

            const amountDisplay = lang === 'en'
                ? formatUSD(order.total_usd)
                : formatIDR(order.total_idr);

            message += replacePlaceholders(locale.history_item, {
                order_id: order.id,
                product: productName || 'Unknown',
                quantity: order.quantity,
                amount: amountDisplay,
                date: formatDateWIB(order.created_at),
                status: status
            }) + '\n\n';
        }

        await ctx.editMessageText(message, {
            parse_mode: 'Markdown',
            ...historyKeyboard(page, totalPages, lang)
        });
    });

    // No-op for pagination display
    bot.action('noop', async (ctx) => {
        await ctx.answerCbQuery();
    });
};

module.exports = { registerHistoryHandler };
