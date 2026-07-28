/**
 * Web admin panel — mounts the REST API and serves the built SPA.
 * Runs inside the same Express app as the QRIS webhook.
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const { login, requireAuth } = require('./auth');
const { getDashboard } = require('./routes/dashboard');
const { registerOrderRoutes } = require('./routes/orders');
const { registerProductRoutes } = require('./routes/products');
const { registerStockRoutes } = require('./routes/stock');
const { registerUserRoutes } = require('./routes/users');
const { registerVoucherRoutes } = require('./routes/vouchers');
const { registerBroadcastRoutes } = require('./routes/broadcast');
const { registerSettingsRoutes } = require('./routes/settings');
const { dbEvents } = require('../models/db');

let sseClients = [];

dbEvents.on('order_change', (order, reason) => {
    const db = require('../models/db');
    const user = db.getUser(order.user_id);
    const prod = db.getProductById(order.product_id);
    const enrichedOrder = {
        ...order,
        username: user?.username || null,
        first_name: user?.first_name || null,
        product_name: prod ? prod.name_id : (order.product_id === 'TOPUP' ? 'Topup Saldo' : order.product_id),
        _reason: reason || 'update'
    };
    const payload = JSON.stringify({ type: 'order_change', data: enrichedOrder });
    sseClients.forEach(res => {
        try {
            res.write(`data: ${payload}\n\n`);
        } catch (e) {
            // client disconnected or failed to write
        }
    });
});

dbEvents.on('product_change', (data) => {
    const payload = JSON.stringify({ type: 'product_change', data });
    sseClients.forEach(res => {
        try {
            res.write(`data: ${payload}\n\n`);
        } catch (e) {
            // client disconnected or failed to write
        }
    });
});

const registerAdminApi = (app, bot) => {
    const api = express.Router();

    // --- Public ---
    api.post('/login', login);

    // --- Live Updates (SSE) ---
    api.get('/live-updates', (req, res) => {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();

        // Query param auth (EventSource query param)
        const token = req.query.token;
        if (!token) {
            res.write('event: error\ndata: Unauthorized\n\n');
            res.end();
            return;
        }
        try {
            const jwt = require('jsonwebtoken');
            const { getSecret, getSessionVersion } = require('./auth');
            const payload = jwt.verify(token, getSecret());
            if (payload.sv !== getSessionVersion()) throw new Error('Session revoked');
        } catch (e) {
            res.write('event: error\ndata: Unauthorized\n\n');
            res.end();
            return;
        }

        sseClients.push(res);

        // Keep-alive connection
        const keepAlive = setInterval(() => {
            res.write(': ping\n\n');
        }, 30000);

        req.on('close', () => {
            clearInterval(keepAlive);
            sseClients = sseClients.filter(c => c !== res);
        });
    });

    // --- Protected ---
    const adminRouter = express.Router();
    adminRouter.use(requireAuth);
    adminRouter.get('/me', (req, res) => res.json({ ok: true }));
    adminRouter.get('/dashboard', getDashboard);
    registerOrderRoutes(adminRouter, bot);
    registerProductRoutes(adminRouter);
    registerStockRoutes(adminRouter);
    registerUserRoutes(adminRouter);
    registerVoucherRoutes(adminRouter);
    registerBroadcastRoutes(adminRouter, bot);
    registerSettingsRoutes(adminRouter);

    api.use(adminRouter);

    app.use('/api/admin', api);


    // --- Serve the built SPA at /admin ---
    const distDir = path.join(__dirname, '../../admin-web/dist');
    app.use('/admin', express.static(distDir));

    // SPA fallback for client-side routing (any /admin/* -> index.html)
    app.get(/^\/admin(\/.*)?$/, (req, res) => {
        const indexFile = path.join(distDir, 'index.html');
        if (fs.existsSync(indexFile)) {
            res.sendFile(indexFile);
        } else {
            res.status(503).send(
                'Admin panel belum di-build.\n\nJalankan:\n  cd admin-web && npm install && npm run build'
            );
        }
    });

    console.log('🖥️  Admin panel API mounted at /api/admin, UI at /admin');
};

module.exports = { registerAdminApi };
