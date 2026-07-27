/**
 * Web admin panel — mounts the REST API and serves the built SPA.
 * Runs inside the same Express app as the QRIS webhook.
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const { login, requireAuth } = require('./auth');
const { getDashboard } = require('./routes/dashboard');

const registerAdminApi = (app) => {
    const api = express.Router();

    // --- Public ---
    api.post('/login', login);

    // --- Protected ---
    api.get('/me', requireAuth, (req, res) => res.json({ ok: true }));
    api.get('/dashboard', requireAuth, getDashboard);

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
