/**
 * Settings untuk panel web admin.
 * Fase 1: toggle sistem (maintenance/qris/saldo), backup DB, ganti password.
 *
 * Env runtime-critical (BOT_TOKEN/PORT/WEBHOOK_URL/ADMIN_ID) ditampilkan READ-ONLY
 * karena butuh restart & mengubahnya dari web = risiko keamanan. Toggle & config
 * lain disimpan di tabel settings (key-value) dan dibaca live oleh bot.
 */
const fs = require('fs');
const path = require('path');
const db = require('../../models/db');
const { getWIBToday } = require('../../utils/helpers');
const { changePassword, isCustomPassword } = require('../auth');
const gateway = require('../../payments/gateway');

// Key toggle yang boleh diubah dari web (whitelist — jangan izinkan sembarang key).
const TOGGLE_KEYS = ['maintenance', 'qris_enabled', 'saldo_enabled'];

// Field credential per provider (buat validasi & masking). Sumber tunggal dari dispatcher.
const PROVIDER_FIELDS = gateway.PROVIDER_FIELDS;

// Mask nilai credential untuk ditampilkan (jangan pernah kirim plaintext ke UI).
const maskCred = (creds = {}) => {
    const out = {};
    for (const [k, v] of Object.entries(creds)) {
        // Identifier/setting non-secret ditampilkan apa adanya.
        if (k === 'slug' || k === 'code_merchant' || k === 'merchant_id' || k === 'fee_direction') out[k] = v || null;
        else out[k] = v ? mask(v) : null;
    }
    return out;
};

// Mask sebagian string sensitif jadi ••••1234 (tampilkan 4 char terakhir).
const mask = (val) => {
    if (!val) return null;
    const s = String(val);
    if (s.length <= 4) return '••••';
    return '••••' + s.slice(-4);
};

// ---- GET /settings ----
const getSettings = (req, res) => {
    try {
        const s = db.getSettings();
        res.json({
            toggles: {
                maintenance: !!s.maintenance,
                qris_enabled: s.qris_enabled !== false,
                saldo_enabled: s.saldo_enabled !== false
            },
            // Info toko & pesan — nilai EFEKTIF (settings DB > env > default), editable dari panel.
            store: {
                store_name: db.getConfig('store_name', 'STORE_NAME', ''),
                support_username: db.getConfig('support_username', 'SUPPORT_USERNAME', ''),
                support_hours: db.getConfig('support_hours', 'SUPPORT_HOURS', '09:00 - 22:00 WIB'),
                order_prefix: db.getConfig('order_prefix', 'ORDER_PREFIX', 'ORD'),
                payment_timeout_minutes: parseInt(db.getConfig('payment_timeout_minutes', null, 15)) || 15
            },
            // Hanya runtime/deployment read-only. Config live ada di submenu masing-masing.
            env: {
                bot_token: mask(process.env.BOT_TOKEN),
                port: process.env.PORT || null,
                webhook_url: process.env.WEBHOOK_URL || null,
                admin_id: process.env.ADMIN_ID || null,
                admin_jwt_secret: mask(process.env.ADMIN_JWT_SECRET || db.getConfig('admin_jwt_secret', null, '')),
                admin_jwt_source: process.env.ADMIN_JWT_SECRET ? '.env' : 'otomatis (database)',
                admin_password_source: isCustomPassword() ? 'database (scrypt)' : '.env'
            },
            security: {
                password_source: isCustomPassword() ? 'custom' : 'env',
                session_duration: '24 jam',
                jwt_source: process.env.ADMIN_JWT_SECRET ? 'env' : 'database-auto'
            }
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

// ---- PATCH /settings/toggle ----  { key, value }
const toggleSetting = (req, res) => {
    try {
        const { key, value } = req.body;
        if (!TOGGLE_KEYS.includes(key)) {
            return res.status(400).json({ error: 'Key tidak diizinkan' });
        }
        const val = !!value;
        db.updateSettings({ [key]: val });
        res.json({ ok: true, key, value: val, message: `${key} → ${val ? 'ON' : 'OFF'}` });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

// ---- POST /settings/password ----  { currentPassword, newPassword }
const updatePassword = (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        changePassword(currentPassword, newPassword);
        res.json({ ok: true, message: 'Password panel berhasil diganti' });
    } catch (e) {
        // Pesan error dari changePassword sudah aman untuk ditampilkan
        res.status(400).json({ error: e.message });
    }
};

// ---- GET /settings/backup ----  download satu snapshot SQLite lengkap
const backupDb = async (req, res) => {
    let tmpPath = null;
    try {
        const dbDir = path.join(__dirname, '../../database');
        const timestamp = getWIBToday();
        const backupName = `backup_${timestamp}.db`;
        // Jangan pakai prefix titik: res.download menolak dotfiles secara default.
        tmpPath = path.join(dbDir, `webbackup_${Date.now()}.db`);

        // Online backup API menghasilkan satu snapshot lengkap dan konsisten,
        // termasuk perubahan yang masih berada di WAL saat bot tetap berjalan.
        await db.backupDatabase(tmpPath);

        res.download(tmpPath, backupName, (err) => {
            // Bersihkan file sementara setelah terkirim (atau gagal).
            try { if (tmpPath && fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (e) { /* ignore */ }
            if (err && !res.headersSent) res.status(500).json({ error: 'Gagal mengirim backup' });
        });
    } catch (e) {
        try { if (tmpPath && fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (_) { /* ignore */ }
        res.status(500).json({ error: e.message });
    }
};

// ---- PUT /settings/store ----  info toko & pesan
const updateStore = (req, res) => {
    try {
        const b = req.body || {};
        const updates = {};

        // Validasi ringan tiap field (semua opsional; kosong = pakai fallback env/default).
        if (b.store_name !== undefined) updates.store_name = String(b.store_name).trim().slice(0, 80);

        if (b.support_username !== undefined) {
            // Buang '@' & whitespace; simpan username bersih.
            updates.support_username = String(b.support_username).trim().replace(/^@+/, '').slice(0, 60);
        }
        if (b.support_hours !== undefined) updates.support_hours = String(b.support_hours).trim().slice(0, 60);

        if (b.order_prefix !== undefined) {
            const prefix = String(b.order_prefix).trim().toUpperCase();
            if (prefix && !/^[A-Z0-9]{1,10}$/.test(prefix)) {
                return res.status(400).json({ error: 'Prefix order hanya huruf/angka, maksimal 10 karakter' });
            }
            updates.order_prefix = prefix;
        }

        if (b.payment_timeout_minutes !== undefined) {
            const mins = parseInt(b.payment_timeout_minutes);
            if (isNaN(mins) || mins < 1 || mins > 1440) {
                return res.status(400).json({ error: 'Timeout pembayaran harus 1–1440 menit' });
            }
            updates.payment_timeout_minutes = mins;
        }

        db.updateSettings(updates);
        res.json({ ok: true, message: 'Info toko berhasil disimpan', store: updates });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

// ==================== PAYMENT GATEWAYS ====================

// ---- GET /gateways ----  daftar gateway (credential di-mask)
const listGateways = (req, res) => {
    try {
        const webhookBase = String(process.env.WEBHOOK_URL || '').replace(/\/$/, '');
        const callbackPath = { pakasir: '/webhook/qris', wijayapay: '/webhook/wijayapay', xoftware: '/webhook/xoftware' };
        const activeMap = new Map(
            gateway.listActiveGateways()
                .filter(g => g.id)
                .map(g => [g.id, { qris_number: g.qris_number, buyer_label: g.buyer_label }])
        );
        const gws = db.getPaymentGateways().map(g => ({
            id: g.id,
            provider: g.provider,
            label: g.label,
            credentials: maskCred(g.credentials),
            enabled: g.enabled,
            callback_url: webhookBase && callbackPath[g.provider] ? `${webhookBase}${callbackPath[g.provider]}` : null,
            qris_number: activeMap.get(g.id)?.qris_number || null,
            buyer_label: activeMap.get(g.id)?.buyer_label || null,
            updated_at: g.updated_at
        }));
        res.json({ gateways: gws, providers: Object.keys(PROVIDER_FIELDS) });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

// ---- POST /gateways ----  buat gateway baru
const createGateway = (req, res) => {
    try {
        const { provider, label, credentials, enabled } = req.body || {};
        if (!PROVIDER_FIELDS[provider]) return res.status(400).json({ error: 'Provider tidak dikenal' });
        const cleanCredentials = {};
        for (const field of PROVIDER_FIELDS[provider]) {
            const value = credentials && credentials[field] !== undefined
                ? String(credentials[field]).trim()
                : '';
            if (!value) return res.status(400).json({ error: `${field} wajib diisi` });
            cleanCredentials[field] = value;
        }
        if (provider === 'xoftware') {
            cleanCredentials.fee_direction = credentials?.fee_direction === 'user' ? 'user' : 'merchant';
        }
        const gw = db.createPaymentGateway({
            provider,
            label: (label || '').trim() || provider,
            credentials: cleanCredentials,
            enabled: enabled !== false
        });
        res.json({ ok: true, message: 'Gateway ditambahkan', id: gw.id });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

// ---- PUT /gateways/:id ----  update (credential partial: field kosong tidak menimpa)
const updateGateway = (req, res) => {
    try {
        const { id } = req.params;
        const existing = db.getPaymentGatewayById(id);
        if (!existing) return res.status(404).json({ error: 'Gateway tidak ditemukan' });

        const { label, credentials, enabled, priority } = req.body || {};
        const updates = {};
        if (label !== undefined) updates.label = String(label).trim();
        if (enabled !== undefined) {
            if (typeof enabled !== 'boolean') return res.status(400).json({ error: 'enabled harus boolean' });
            updates.enabled = enabled;
        }
        if (priority !== undefined) updates.priority = parseInt(priority) || 0;

        // Credential: hanya update field yang dikirim & non-kosong (biar bisa ganti api_key
        // tanpa harus ketik ulang slug, dan sebaliknya). Field kosong = pertahankan lama.
        if (credentials && typeof credentials === 'object') {
            const allowed = PROVIDER_FIELDS[existing.provider] || [];
            const credUpdate = {};
            for (const f of allowed) {
                if (credentials[f] !== undefined && String(credentials[f]).trim() !== '') {
                    credUpdate[f] = String(credentials[f]).trim();
                }
            }
            if (Object.keys(credUpdate).length) updates.credentials = credUpdate;
            if (existing.provider === 'xoftware' && credentials.fee_direction !== undefined) {
                updates.credentials = {
                    ...(updates.credentials || {}),
                    fee_direction: credentials.fee_direction === 'user' ? 'user' : 'merchant'
                };
            }
        }

        const updated = db.updatePaymentGateway(id, updates);
        const active = gateway.listActiveGateways();
        const buyer = active.find(g => g.id === id);
        res.json({
            ok: true,
            message: 'Gateway diperbarui',
            gateway: {
                id: updated.id,
                enabled: updated.enabled,
                label: updated.label,
                qris_number: buyer?.qris_number || null,
                buyer_label: buyer?.buyer_label || null
            }
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

const gatewayDeleteCheck = (id) => {
    const existing = db.getPaymentGatewayById(id);
    if (!existing) return { found: false };
    const active_orders = db.getActiveOrderCountByGateway(id);
    // Field .env sebagian pun dapat men-seed row lagi setelah restart; tetap blok hard-delete.
    const env_configured = !!gateway.envCredential(existing.provider);
    return {
        found: true,
        gateway: { id: existing.id, label: existing.label, provider: existing.provider, enabled: existing.enabled },
        active_orders,
        env_configured,
        can_delete: active_orders === 0 && !env_configured
    };
};

// ---- GET /gateways/:id/delete-check ----
const checkDeleteGateway = (req, res) => {
    const result = gatewayDeleteCheck(req.params.id);
    if (!result.found) return res.status(404).json({ error: 'Gateway tidak ditemukan' });
    res.json(result);
};

// ---- DELETE /gateways/:id ----  wajib preflight + confirm=true
const deleteGateway = (req, res) => {
    try {
        const { id } = req.params;
        const check = gatewayDeleteCheck(id);
        if (!check.found) return res.status(404).json({ error: 'Gateway tidak ditemukan' });
        if (check.active_orders > 0) {
            return res.status(409).json({ ...check, error: `Masih ada ${check.active_orders} order pending/processing. Nonaktifkan gateway dan tunggu transaksi selesai.` });
        }
        if (check.env_configured) {
            return res.status(409).json({ ...check, error: 'Credential provider ini masih ada di .env. Nonaktifkan gateway atau hapus credential .env lalu restart.' });
        }
        if (req.body?.confirm !== true) return res.status(400).json({ error: 'Konfirmasi penghapusan diperlukan' });
        db.deletePaymentGateway(id);
        res.json({ ok: true, message: `Gateway ${check.gateway.label} dihapus` });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

// ---- POST /gateways/:id/test ----  test koneksi credential (pakai yg tersimpan / yg dikirim)
const testGateway = async (req, res) => {
    try {
        const { id } = req.params;
        const gw = db.getPaymentGatewayById(id);
        if (!gw) return res.status(404).json({ error: 'Gateway tidak ditemukan' });
        // Merge credential tersimpan + field baru yang sedang diedit, supaya bisa dites sebelum simpan.
        const body = req.body || {};
        const allowed = PROVIDER_FIELDS[gw.provider] || [];
        const creds = { ...(gw.credentials || {}) };
        for (const field of allowed) {
            if (body[field] !== undefined && String(body[field]).trim() !== '') {
                creds[field] = String(body[field]).trim();
            }
        }
        const result = await gateway.testConnection(gw.provider, creds);
        res.json(result);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};


const registerSettingsRoutes = (api) => {
    api.get('/settings', getSettings);
    api.patch('/settings/toggle', toggleSetting);
    api.put('/settings/store', updateStore);
    api.post('/settings/password', updatePassword);
    api.get('/settings/backup', backupDb);
    // Payment gateways
    api.get('/gateways', listGateways);

    api.post('/gateways', createGateway);
    api.put('/gateways/:id', updateGateway);
    api.get('/gateways/:id/delete-check', checkDeleteGateway);
    api.delete('/gateways/:id', deleteGateway);
    api.post('/gateways/:id/test', testGateway);
};

module.exports = { registerSettingsRoutes };
