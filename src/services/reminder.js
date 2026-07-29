const cron = require('node-cron');
const db = require('../models/db');
const log = require('../utils/logger');
const { getRemainingTime, replacePlaceholders } = require('../utils/helpers');

let bot = null;

/**
 * Initialize reminder service with bot instance
 * @param {Object} botInstance - Telegraf bot instance
 */
const initReminderService = (botInstance) => {
    bot = botInstance;

    // Run every minute to check pending orders.
    // Guard against overlap: if a slow run is still going, skip this tick (node-cron
    // does not serialize runs, so two overlapping checks could double-handle an order).
    let isChecking = false;
    cron.schedule('* * * * *', async () => {
        if (isChecking) {
            log.warn('[CRON] Previous order check still running, skipping this tick');
            return;
        }
        isChecking = true;
        try {
            await checkPendingOrders();
        } finally {
            isChecking = false;
        }
    });

    // Daily purge at 3:00 AM WIB — clean old expired/cancelled data
    cron.schedule('0 3 * * *', () => {
        log.info('[CRON] Running daily data purge...');
        const ordersPurged = db.purgeOldOrders(30);   // expired/cancelled > 30 days
        const stockPurged = db.purgeOldSoldStock(60);  // sold stock > 60 days
        log.info(`[CRON] Purge complete: ${ordersPurged} orders, ${stockPurged} stock items removed`);
    }, { timezone: 'Asia/Jakarta' });

    log.info('Reminder service initialized');
};

/**
 * Check all pending orders for reminders and expiration
 */
const checkPendingOrders = async () => {
    if (!bot) return;

    const now = new Date();
    const recovered = db.recoverStaleQrisProcessing(now.toISOString());
    if (recovered) log.warn(`[RECOVERY] cancelled ${recovered} stale QRIS processing order(s) and released stock`);
    const pendingOrders = db.getPendingOrders();

    for (const order of pendingOrders) {
        const expiresAt = new Date(order.expires_at);
        const createdAt = new Date(order.created_at);
        const timePassed = (now - createdAt) / 1000 / 60; // minutes
        const timeLeft = (expiresAt - now) / 1000 / 60; // minutes

        // Order expired
        if (now >= expiresAt) {
            await handleOrderExpired(order);
            continue;
        }

        // QRIS: Send reminder after 10 minutes if not already sent
        if (order.payment_method === 'qris' && !order.reminder_sent && timePassed >= 10 && timeLeft > 0) {
            await sendPaymentReminder(order);
        }
    }
};

/**
 * Send payment reminder to user
 * @param {Object} order - Order object
 */
const sendPaymentReminder = async (order) => {
    try {
        const lang = db.getUserLanguage(order.user_id);
        const locale = require(`../locales/${lang}`);

        const timeLeft = getRemainingTime(order.expires_at);

        const message = replacePlaceholders(locale.payment_reminder, {
            order_id: order.id,
            time_left: timeLeft
        });

        // Always send as new message so we can track and delete it later
        try {
            const sent = await bot.telegram.sendMessage(order.user_id, message, { parse_mode: 'Markdown' });

            // Save reminder message_id for cleanup on expiry
            db.updateOrder(order.id, {
                reminder_sent: true,
                reminder_message_id: sent.message_id,
                reminder_chat_id: sent.chat.id
            });
        } catch (sendError) {
            log.error(`Error sending reminder message for ${order.id}:`, sendError.message);
            db.updateOrder(order.id, { reminder_sent: true });
        }

        log.info(`Reminder sent for order ${order.id}`);
    } catch (error) {
        log.error(`Error sending reminder for order ${order.id}:`, error);
    }
};

/**
 * Helper: delete a message safely (ignore errors)
 */
const safeDelete = async (chatId, messageId) => {
    try {
        if (chatId && messageId) {
            await bot.telegram.deleteMessage(chatId, messageId);
        }
    } catch (e) {
        // Message may already be deleted or too old
    }
};

/**
 * Handle expired order
 * @param {Object} order - Order object
 */
const handleOrderExpired = async (order) => {
    try {
        // Race-safe against webhook/polling delivery: only one terminal path wins.
        if (!db.claimOrderForExpiry(order.id)) return false;
        const lang = db.getUserLanguage(order.user_id);
        const locale = require(`../locales/${lang}`);

        const message = replacePlaceholders(locale.payment_expired, {
            order_id: order.id
        });

        // 1) Delete invoice message
        await safeDelete(order.chat_id, order.message_id);

        // 2) Delete reminder message (if sent)
        await safeDelete(order.reminder_chat_id || order.chat_id, order.reminder_message_id);

        // 3) Send clean expired message
        try {
            await bot.telegram.sendMessage(order.user_id, message, { parse_mode: 'Markdown' });
        } catch (e) {
            log.warn(`Could not notify user ${order.user_id} about expired order ${order.id}: ${e.message}`);
        }

        // Release reserved stock
        db.releaseReservedStock(order.id);

        // Update order status
        db.updateOrder(order.id, { status: 'expired' });

        log.info(`Order ${order.id} expired — invoice & reminder deleted`);
    } catch (error) {
        db.releaseOrderExpiryClaim(order.id);
        log.error(`Error handling expired order ${order.id}:`, error);
    }
};

/**
 * Cancel order manually
 * @param {string} orderId - Order ID
 */
const cancelOrder = async (orderId) => {
    try {
        const order = db.getOrderById(orderId);
        if (!order || order.status !== 'pending') {
            return false;
        }

        const lang = db.getUserLanguage(order.user_id);
        const locale = require(`../locales/${lang}`);

        const message = replacePlaceholders(locale.payment_cancelled, {
            order_id: orderId
        });

        // 1) Delete invoice message
        await safeDelete(order.chat_id, order.message_id);

        // 2) Delete reminder message (if sent)
        await safeDelete(order.reminder_chat_id || order.chat_id, order.reminder_message_id);

        // 3) Send clean cancelled message
        await bot.telegram.sendMessage(order.user_id, message, { parse_mode: 'Markdown' });

        // Release reserved stock
        db.releaseReservedStock(orderId);

        // Update order status
        db.updateOrder(orderId, { status: 'cancelled' });

        log.info(`Order ${orderId} cancelled — invoice & reminder deleted`);
        return true;
    } catch (error) {
        log.error(`Error cancelling order ${orderId}:`, error);
        return false;
    }
};

module.exports = {
    initReminderService,
    checkPendingOrders,
    sendPaymentReminder,
    handleOrderExpired,
    cancelOrder
};
