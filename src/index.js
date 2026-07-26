require('dotenv').config();
require('./utils/validateConfig'); // Validate .env on startup

const { Telegraf, session } = require('telegraf');
const express = require('express');
const log = require('./utils/logger');

// Import handlers
const { registerStartHandler } = require('./handlers/start');
const { registerMenuHandler } = require('./handlers/menu');
const { registerOrderHandler } = require('./handlers/order');
const { registerHistoryHandler } = require('./handlers/history');
const { registerSupportHandler } = require('./handlers/support');
const { registerKeyboardHandler } = require('./handlers/keyboard');
const { registerSewaBotHandler } = require('./handlers/sewabot');
const { registerAdminHandler } = require('./admin/panel');

// Import services
const { initReminderService } = require('./services/reminder');
const { handleQRISWebhook } = require('./payments/qris');
const { handlePaymentSuccess } = require('./services/delivery');


// Environment variables
const BOT_TOKEN = process.env.BOT_TOKEN;
const PORT = process.env.PORT || 3000;
const WEBHOOK_URL = process.env.WEBHOOK_URL;

// Validate required env vars
if (!BOT_TOKEN) {
    console.error('BOT_TOKEN is required!');
    process.exit(1);
}

// Initialize bot
const bot = new Telegraf(BOT_TOKEN);

// Use session middleware
bot.use(session());

// Set /start command in Telegram menu
bot.telegram.setMyCommands([
    { command: 'start', description: 'Mulai' }
]);

// ==================== RATE LIMITER ====================
const rateLimitMap = new Map();
const RATE_LIMIT_MAX = 30;       // max messages
const RATE_LIMIT_WINDOW = 60000; // per 60 seconds

bot.use(async (ctx, next) => {
    if (!ctx.from) return next();
    const userId = ctx.from.id.toString();

    // Admin bypass rate limit
    const adminIds = (process.env.ADMIN_ID || '').split(',').map(id => id.trim());
    if (adminIds.includes(userId)) return next();

    const now = Date.now();
    const userData = rateLimitMap.get(userId) || { timestamps: [], warned: false };

    // Remove old timestamps outside window
    userData.timestamps = userData.timestamps.filter(t => now - t < RATE_LIMIT_WINDOW);
    userData.timestamps.push(now);

    if (userData.timestamps.length > RATE_LIMIT_MAX) {
        if (!userData.warned) {
            userData.warned = true;
            rateLimitMap.set(userId, userData);
            try {
                const db = require('./models/db');
                const lang = db.getUserLanguage(userId);
                const msg = lang === 'en'
                    ? '⚠️ Too many messages! Please wait a moment.'
                    : '⚠️ Terlalu banyak pesan! Harap tunggu sebentar.';
                await ctx.reply(msg);
            } catch (e) { }
        }
        return; // Drop the message
    }

    userData.warned = false;
    rateLimitMap.set(userId, userData);
    return next();
});

// Auto-cleanup rate limit map every 5 minutes
setInterval(() => {
    const now = Date.now();
    for (const [userId, data] of rateLimitMap) {
        data.timestamps = data.timestamps.filter(t => now - t < RATE_LIMIT_WINDOW);
        if (data.timestamps.length === 0) rateLimitMap.delete(userId);
    }
}, 5 * 60 * 1000);

// Register all handlers
registerStartHandler(bot);
registerKeyboardHandler(bot); // Reply keyboard handlers (hears)
registerMenuHandler(bot);
registerOrderHandler(bot);
registerHistoryHandler(bot);
registerSupportHandler(bot);
registerSewaBotHandler(bot);
registerAdminHandler(bot);

// ==================== FLASH SALE EXPIRY CHECKER ====================
setInterval(() => {
    try {
        const db = require('./models/db');
        const expired = db.getExpiredFlashSales();
        if (expired.length === 0) return;

        const { formatIDR } = require('./utils/helpers');
        const ADMIN_IDS = (process.env.ADMIN_ID || '').split(',').map(id => id.trim()).filter(Boolean);

        for (const prod of expired) {
            const originalPrice = prod.price_idr;
            db.clearFlashSale(prod.id);

            const msg = `⚡ *Flash Sale Berakhir!*\n\n📦 Produk: *${prod.name_id}*\n💵 Harga kembali: Rp ${formatIDR(originalPrice)}`;

            for (const adminId of ADMIN_IDS) {
                bot.telegram.sendMessage(adminId, msg, { parse_mode: 'Markdown' }).catch(() => { });
            }
            console.log(`[FLASH SALE] Expired: ${prod.name_id}, price restored to ${originalPrice}`);
        }
    } catch (e) {
        console.error('[FLASH SALE] Expiry check error:', e.message);
    }
}, 60 * 1000); // Check every 60 seconds

// Global error handler — notify user in their language
bot.catch(async (err, ctx) => {
    log.error(`[BOT] ${ctx.updateType}:`, err);
    try {
        const userId = ctx.from?.id?.toString();
        const lang = userId ? require('./models/db').getUserLanguage(userId) : 'id';
        const msg = lang === 'en'
            ? '⚠️ Something went wrong. Please try again later.'
            : '⚠️ Terjadi kesalahan. Silakan coba lagi nanti.';
        await ctx.reply(msg);
    } catch (e) { /* ignore reply errors */ }
});

// Initialize Express for webhooks
const app = express();
app.use(express.json());

// Health check endpoint
app.get('/', (req, res) => {
    res.json({ status: 'OK', message: `${process.env.STORE_NAME || 'Bot'} is running!` });
});

// PaKasir QRIS webhook
app.post('/webhook/qris', async (req, res) => {
    try {
        log.info('[WEBHOOK] QRIS received:', JSON.stringify(req.body));

        // Step 1: Parse & validate project slug
        const result = handleQRISWebhook(req.body);
        if (!result.success) {
            log.warn(`[WEBHOOK] ❌ Rejected: ${result.error}`);
            return res.status(400).json({ error: result.error });
        }

        // Step 2: Verify order exists & is pending
        const db = require('./models/db');
        const order = db.getOrderById(result.orderId);
        if (!order) {
            log.warn(`[WEBHOOK] ❌ Order ${result.orderId} not found in DB`);
            return res.status(404).json({ error: 'Order not found' });
        }
        if (order.status !== 'pending') {
            log.warn(`[WEBHOOK] ⚠️ Order ${result.orderId} already ${order.status}`);
            return res.json({ success: true, message: 'Already processed' });
        }

        // Step 3: Verify amount matches 
        if (result.amount && order.total_idr && result.amount !== order.total_idr) {
            log.warn(`[WEBHOOK] ❌ Amount mismatch for ${result.orderId}: webhook=${result.amount}, db=${order.total_idr}`);
            return res.status(400).json({ error: 'Amount mismatch' });
        }

        // Step 4: Double-verify via PaKasir API (recommended by PaKasir docs)
        if (result.status === 'completed' || result.status === 'success') {
            const { verifyTransactionWithAPI } = require('./payments/qris');
            const apiCheck = await verifyTransactionWithAPI(result.orderId, order.total_idr);

            if (apiCheck.valid) {
                await handlePaymentSuccess(bot, result.orderId, {
                    transaction_id: result.transactionId || result.orderId,
                    amount: result.amount
                });
                log.info(`[WEBHOOK] ✅ Order ${result.orderId} verified & paid`);
            } else if (apiCheck.status === 'api_error') {
                log.warn(`[WEBHOOK] ⚠️ API verify failed, processing webhook data for ${result.orderId}`);
                await handlePaymentSuccess(bot, result.orderId, {
                    transaction_id: result.transactionId || result.orderId,
                    amount: result.amount
                });
            } else {
                log.warn(`[WEBHOOK] ❌ API says ${result.orderId} is NOT completed (status: ${apiCheck.status})`);
                return res.status(400).json({ error: 'Transaction not verified' });
            }
        } else {
            log.info(`[WEBHOOK] Ignored status: ${result.status} for order ${result.orderId}`);
        }

        res.json({ success: true });
    } catch (error) {
        log.error('[WEBHOOK] QRIS error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Telegram webhook (optional, for production)
app.post('/webhook/telegram', (req, res) => {
    bot.handleUpdate(req.body, res);
});

// Start the bot
let server;

const startBot = async () => {
    try {
        // Initialize services
        initReminderService(bot);

        // Start Express server
        server = app.listen(PORT, '0.0.0.0', () => {
            console.log(`🚀 Webhook server running on port ${PORT}`);
            console.log(`📍 QRIS Webhook: ${WEBHOOK_URL}/webhook/qris`);
        });

        // Use polling for development
        console.log('🔄 Connecting to Telegram...');

        await bot.launch({
            dropPendingUpdates: true // Skip old messages
        });

        console.log('🤖 Bot started with polling');
        console.log(`✅ ${process.env.STORE_NAME || 'Bot'} is running!`);
        console.log(`👤 Admin ID: ${process.env.ADMIN_ID}`);

    } catch (error) {
        console.error('Failed to start bot:', error.message);
        console.error('Full error:', error);
        process.exit(1);
    }
};

// Graceful shutdown — properly release port
const shutdown = (signal) => {
    console.log(`\n⏹ ${signal} received, shutting down...`);
    bot.stop(signal);
    if (server) {
        server.close(() => {
            console.log('✅ Server closed, port released.');
            process.exit(0);
        });
    } else {
        process.exit(0);
    }
};

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

// Handle uncaught errors — log and KEEP SERVING instead of tearing the whole bot down.
// A single stray throw (timer callback, malformed webhook, etc.) used to trigger a full
// shutdown that required a manual restart. We'd rather stay up and log the incident.
process.on('uncaughtException', (err) => {
    log.error('💥 Uncaught Exception (bot kept alive):', err);
});

process.on('unhandledRejection', (reason) => {
    log.error('💥 Unhandled Rejection (bot kept alive):', reason);
});

// Start the bot
startBot();

module.exports = { bot, app };
