require('dotenv').config();
require('./utils/validateConfig'); // Validate .env on startup

const { Telegraf, session } = require('telegraf');
const express = require('express');
const log = require('./utils/logger');
const { privateChatOnly } = require('./utils/buyerSecurity');

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
const { initPaymentPolling, stopPaymentPolling } = require('./services/paymentPolling');
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
const paymentActionMap = new Map();
const RATE_LIMIT_MAX = 30;       // max messages
const RATE_LIMIT_WINDOW = 60000; // per 60 seconds
const PAYMENT_ACTION_COOLDOWN = 2500;

bot.use(async (ctx, next) => {
    if (!ctx.from) return next();
    const userId = ctx.from.id.toString();

    // Admin bypass rate limit
    const adminIds = (process.env.ADMIN_ID || '').split(',').map(id => id.trim());
    if (adminIds.includes(userId)) return next();

    const now = Date.now();
    const callbackData = ctx.callbackQuery?.data || '';
    const expensivePaymentAction = /^(pay_qris_|pay_qgw_|pay_check_|pay_saldo_|topup_qgw_|topup_check_)/.test(callbackData);
    if (expensivePaymentAction) {
        const key = `${userId}:${callbackData}`;
        const last = paymentActionMap.get(key) || 0;
        if (now - last < PAYMENT_ACTION_COOLDOWN) {
            try { await ctx.answerCbQuery('⏳ Mohon tunggu sebentar…'); } catch (_) { }
            return;
        }
        paymentActionMap.set(key, now);
    }
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
                if (ctx.callbackQuery) await ctx.answerCbQuery(msg, { show_alert: true });
                else await ctx.reply(msg);
            } catch (e) { }
        }
        return; // Drop the message
    }

    userData.warned = false;
    rateLimitMap.set(userId, userData);
    return next();
});

// Buyer transactions and delivered credentials are private-chat only.
bot.use(privateChatOnly);

// Auto-cleanup rate limit map every 5 minutes
setInterval(() => {
    const now = Date.now();
    for (const [userId, data] of rateLimitMap) {
        data.timestamps = data.timestamps.filter(t => now - t < RATE_LIMIT_WINDOW);
        if (data.timestamps.length === 0) rateLimitMap.delete(userId);
    }
    for (const [key, timestamp] of paymentActionMap) {
        if (now - timestamp > RATE_LIMIT_WINDOW) paymentActionMap.delete(key);
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
// Limit 12mb: broadcast web bisa kirim foto sebagai base64 data URL (default 100kb kekecilan).
// Simpan raw bytes untuk verifikasi HMAC webhook Xoftware sebelum JSON diubah parser.
app.use(express.json({
    limit: '12mb',
    verify: (req, res, buffer) => { req.rawBody = Buffer.from(buffer); }
}));

// Health check endpoint
app.get('/', (req, res) => {
    res.json({ status: 'OK', message: `${process.env.STORE_NAME || 'Bot'} is running!` });
});

// PaKasir QRIS webhook
app.post('/webhook/qris', async (req, res) => {
    try {
        // Step 1: Parse & validate project slug
        const result = handleQRISWebhook(req.body);
        if (!result.success) {
            log.warn(`[WEBHOOK] ❌ Rejected: ${result.error}`);
            return res.status(400).json({ error: result.error });
        }
        log.info(`[PAYMENT] provider=pakasir event=webhook order=${result.orderId} ` +
            `status=${result.status} amount=${result.amount || '-'} project=${req.body?.project || '-'}`);

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
            // Fase 4: verifikasi pakai gateway yang membuat transaksi (order.gateway_id),
            // atau gateway yang slug-nya cocok dgn project webhook (result.gatewayId) sbg cadangan.
            const verifyGatewayId = order.gateway_id || result.gatewayId || null;
            const apiCheck = await verifyTransactionWithAPI(result.orderId, order.total_idr, verifyGatewayId);

            if (apiCheck.valid) {
                await handlePaymentSuccess(bot, result.orderId, {
                    transaction_id: result.transactionId || result.orderId,
                    amount: result.amount
                });
                log.info(`[PAYMENT] provider=pakasir event=verified order=${result.orderId} status=paid`);
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

// ==================== WIJAYAPAY WEBHOOK ====================
// WijayaPay mem-POST callback saat status berubah (pending → paid/expired).
// Payload: { data: { ref_id, trx_reference, payment_methode, total_dibayar, ... }, status: 'paid' }
// Verifikasi: header X-Signature = md5(code_merchant + api_key + ref_id) memakai credential
// gateway yang membuat transaksi (order.gateway_id). Lalu double-verify via get-status.
// WijayaPay mewajibkan endpoint membalas JSON { status: true }, dan IP mereka (45.158.126.118)
// harus di-whitelist di dashboard WijayaPay.
app.post('/webhook/wijayapay', async (req, res) => {
    try {
        const crypto = require('crypto');
        const db = require('./models/db');
        const wijayapay = require('./payments/providers/wijayapay');

        // Step 1: parse payload → orderId (ref_id), status
        const parsed = wijayapay.parseCallback(req.body);
        if (!parsed.success) {
            log.warn(`[WEBHOOK] ❌ WijayaPay parse failed: ${parsed.error}`);
            return res.status(400).json({ status: false, error: parsed.error });
        }
        log.info(`[PAYMENT] provider=wijayapay event=webhook order=${parsed.orderId} ` +
            `status=${parsed.status} amount=${parsed.amount || '-'} reference=${parsed.trxReference || '-'}`);

        // Step 2: order harus ada
        const order = db.getOrderById(parsed.orderId);
        if (!order) {
            log.warn(`[WEBHOOK] ❌ WijayaPay order ${parsed.orderId} not found`);
            return res.status(404).json({ status: false, error: 'Order not found' });
        }

        // Step 3: resolve credential gateway yang membuat transaksi (wijayapay) untuk verifikasi signature
        const gw = db.getPaymentGatewayById(order.gateway_id) || null;
        const creds = (gw && gw.provider === 'wijayapay' && gw.credentials)
            ? gw.credentials
            : { code_merchant: process.env.WIJAYAPAY_CODE_MERCHANT || '', api_key: process.env.WIJAYAPAY_API_KEY || '' };

        // Step 4: verifikasi X-Signature (kalau dikirim). md5(code_merchant+api_key+ref_id)
        const sigHeader = req.headers['x-signature'];
        if (!sigHeader || !creds.code_merchant || !creds.api_key) {
            log.warn(`[WEBHOOK] ❌ WijayaPay signature/credential missing for ${parsed.orderId}`);
            return res.status(401).json({ status: false, error: 'Missing signature' });
        }
        const expected = crypto.createHash('md5')
            .update(`${creds.code_merchant}${creds.api_key}${parsed.orderId}`).digest('hex');
        const received = String(sigHeader).toLowerCase();
        const expectedBuf = Buffer.from(expected);
        const receivedBuf = Buffer.from(received);
        if (receivedBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(receivedBuf, expectedBuf)) {
            log.warn(`[WEBHOOK] ❌ WijayaPay signature mismatch for ${parsed.orderId}`);
            return res.status(401).json({ status: false, error: 'Invalid signature' });
        }

        // Step 5: idempoten — kalau sudah tidak pending, cukup ack
        if (order.status !== 'pending') {
            log.warn(`[WEBHOOK] ⚠️ WijayaPay order ${parsed.orderId} already ${order.status}`);
            return res.json({ status: true });
        }

        // Step 6: hanya proses kalau status paid; double-verify authoritative via get-status
        if (parsed.status === 'completed') {
            const apiCheck = await wijayapay.verifyTransaction(parsed.orderId, order.total_idr, creds);
            if (apiCheck.valid || apiCheck.status === 'api_error') {
                // api_error → tetap proses (payload sudah diverifikasi signature), meniru pola PaKasir
                await handlePaymentSuccess(bot, parsed.orderId, {
                    transaction_id: parsed.trxReference || parsed.orderId,
                    amount: parsed.amount
                });
                log.info(`[PAYMENT] provider=wijayapay event=verified order=${parsed.orderId} status=paid`);
            } else {
                log.warn(`[WEBHOOK] ❌ WijayaPay ${parsed.orderId} NOT verified (status: ${apiCheck.status})`);
                return res.status(400).json({ status: false, error: 'Transaction not verified' });
            }
        } else {
            log.info(`[WEBHOOK] WijayaPay ignored status: ${parsed.status} for ${parsed.orderId}`);
        }

        // WijayaPay mengharapkan { status: true }
        res.json({ status: true });
    } catch (error) {
        log.error('[WEBHOOK] WijayaPay error:', error);
        res.status(500).json({ status: false, error: error.message });
    }
});

// Xoftware webhook: HMAC-SHA256 hex atas RAW body memakai webhook_secret.
app.post('/webhook/xoftware', async (req, res) => {
    try {
        const db = require('./models/db');
        const xoftware = require('./payments/providers/xoftware');
        const parsed = xoftware.parseCallback(req.body);
        if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error });

        const order = db.getOrderById(parsed.orderId);
        if (!order) return res.status(404).json({ success: false, error: 'Order not found' });
        const gw = order.gateway_id ? db.getPaymentGatewayById(order.gateway_id) : null;
        const creds = gw?.provider === 'xoftware' ? gw.credentials : {
            api_key: process.env.XOWFTWARE_API_KEY || '',
            merchant_id: process.env.XOWFTWARE_MERCHANT_ID || '',
            webhook_secret: process.env.XOWFTWARE_WEBHOOK_SECRET || ''
        };
        if (!xoftware.verifyWebhookSignature(req.rawBody, req.headers['x-signature'], creds.webhook_secret)) {
            return res.status(401).json({ success: false, error: 'Invalid signature' });
        }
        // Mode merchant: amount harus sama dengan harga order. Mode user dapat lebih
        // besar karena fee ditambahkan ke tagihan buyer, tetapi tidak boleh lebih kecil.
        const feeDirection = creds.fee_direction === 'user' ? 'user' : 'merchant';
        if (parsed.amount && order.total_idr &&
            ((feeDirection === 'merchant' && parsed.amount !== order.total_idr) ||
             (feeDirection === 'user' && parsed.amount < order.total_idr))) {
            return res.status(400).json({ success: false, error: 'Amount mismatch' });
        }
        if (!db.claimWebhookEvent(parsed.eventId, 'xoftware', parsed.orderId)) {
            return res.json({ success: true, duplicate: true });
        }
        log.info(`[PAYMENT] provider=xoftware event=webhook order=${parsed.orderId} ` +
            `status=${parsed.status} amount=${parsed.amount || '-'} reference=${parsed.transactionId || '-'}`);

        if (order.status !== 'pending') return res.json({ success: true });
        if (parsed.status === 'completed') {
            const verified = await xoftware.verifyTransaction(parsed.orderId, order.total_idr, creds);
            if (!verified.valid) {
                // Biarkan retry webhook berikutnya mencoba ulang jika status API belum sinkron/transient error.
                db.releaseWebhookEvent(parsed.eventId);
                return res.status(400).json({ success: false, error: `Transaction not verified (${verified.status})` });
            }
            const delivered = await handlePaymentSuccess(bot, parsed.orderId, {
                transaction_id: parsed.transactionId || parsed.orderId,
                amount: parsed.amount
            });
            if (!delivered) {
                db.releaseWebhookEvent(parsed.eventId);
                return res.status(500).json({ success: false, error: 'Delivery failed' });
            }
            log.info(`[PAYMENT] provider=xoftware event=verified order=${parsed.orderId} status=paid`);
        }
        res.json({ success: true });
    } catch (error) {
        log.error('[WEBHOOK] Xoftware error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Telegram webhook (optional, for production)
app.post('/webhook/telegram', (req, res) => {
    bot.handleUpdate(req.body, res);
});

// Web admin panel (REST API + SPA) — same Express app, same DB
const { registerAdminApi } = require('./web/api');
registerAdminApi(app, bot);

// Start the bot
let server;

const startBot = async () => {
    try {
        // Initialize services
        initReminderService(bot);
        initPaymentPolling(bot);

        // Start Express server
        server = app.listen(PORT, '0.0.0.0', () => {
            console.log(`🚀 Webhook server running on port ${PORT}`);
            console.log(`📍 PaKasir Webhook  : ${WEBHOOK_URL}/webhook/qris`);
            console.log(`📍 WijayaPay Webhook: ${WEBHOOK_URL}/webhook/wijayapay`);
            console.log(`📍 Xoftware Webhook : ${WEBHOOK_URL}/webhook/xoftware`);
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
    stopPaymentPolling();
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
