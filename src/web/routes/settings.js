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
const sharp = require('sharp');
const banner = require('../../utils/banner');

const ASSETS_DIR = path.join(__dirname, '../../../assets');
const BANNER_MAX_BYTES = 5 * 1024 * 1024;
const BANNER_TYPES = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' };

// Key toggle yang boleh diubah dari web (whitelist — jangan izinkan sembarang key).
const TOGGLE_KEYS = ['maintenance', 'qris_enabled', 'saldo_enabled'];

// Field credential per provider (buat validasi & masking). Sumber tunggal dari dispatcher.
const PROVIDER_FIELDS = gateway.PROVIDER_FIELDS;

// Mask nilai credential untuk ditampilkan (jangan pernah kirim plaintext ke UI).
const maskCred = (creds = {}) => {
    const out = {};
    for (const [k, v] of Object.entries(creds)) {
        // Identifier/setting non-secret ditampilkan apa adanya.
        if (k === 'slug' || k === 'code_merchant' || k === 'merchant_id' || k === 'fee_direction' || k === 'registered_notify_url' || k === 'qr_string' || k === 'currency') out[k] = v || null;
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
                support_text: db.getConfig('support_text', 'SUPPORT_TEXT', ''),
                support_whatsapp_url: db.getConfig('support_whatsapp_url', 'SUPPORT_WHATSAPP_URL', ''),
                support_telegram_url: db.getConfig(
                    'support_telegram_url', 'SUPPORT_TELEGRAM_URL',
                    db.getConfig('support_username', 'SUPPORT_USERNAME', '')
                        ? `https://t.me/${String(db.getConfig('support_username', 'SUPPORT_USERNAME', '')).replace(/^@+/, '')}`
                        : ''
                ),
                support_group_url: db.getConfig('support_group_url', 'SUPPORT_GROUP_URL', ''),
                support_channel_url: db.getConfig('support_channel_url', 'SUPPORT_CHANNEL_URL', ''),
                order_prefix: db.getConfig('order_prefix', 'ORDER_PREFIX', 'ORD'),
                payment_timeout_minutes: parseInt(db.getConfig('payment_timeout_minutes', null, 15)) || 15
            },
            banner: {
                enabled: banner.isBannerEnabled(),
                exists: banner.hasBanner(),
                filename: banner.resolveBannerPath() ? path.basename(banner.resolveBannerPath()) : null,
                preview_url: banner.hasBanner() ? `/api/admin/settings/banner/file?v=${Date.now()}` : null
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

const normalizeSupportUrl = (value, label) => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    let parsed;
    try { parsed = new URL(raw); } catch (_) {
        const error = new Error(`${label} harus berupa URL lengkap`); error.validation = true; throw error;
    }
    if (parsed.protocol !== 'https:') {
        const error = new Error(`${label} wajib memakai https://`); error.validation = true; throw error;
    }
    return parsed.toString().replace(/\/$/, '');
};

// ---- PUT /settings/store ----  info toko & pesan
const updateStore = (req, res) => {
    try {
        const b = req.body || {};
        const updates = {};

        // Validasi ringan tiap field (semua opsional; kosong = pakai fallback env/default).
        if (b.store_name !== undefined) updates.store_name = String(b.store_name).trim().slice(0, 80);

        if (b.support_text !== undefined) updates.support_text = String(b.support_text).trim().slice(0, 500);
        if (b.support_whatsapp_url !== undefined) updates.support_whatsapp_url = normalizeSupportUrl(b.support_whatsapp_url, 'URL WhatsApp');
        if (b.support_telegram_url !== undefined) updates.support_telegram_url = normalizeSupportUrl(b.support_telegram_url, 'URL Telegram Admin');
        if (b.support_group_url !== undefined) updates.support_group_url = normalizeSupportUrl(b.support_group_url, 'URL Telegram Group');
        if (b.support_channel_url !== undefined) updates.support_channel_url = normalizeSupportUrl(b.support_channel_url, 'URL Telegram Channel');

        const effectiveTelegram = (b.support_telegram_url === undefined
            ? db.getConfig('support_telegram_url', 'SUPPORT_TELEGRAM_URL', '')
            : updates.support_telegram_url)
            || process.env.SUPPORT_TELEGRAM_URL
            || db.getConfig('support_username', 'SUPPORT_USERNAME', '');
        if (!effectiveTelegram) return res.status(400).json({ error: 'URL Telegram Admin wajib diisi' });

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
        res.status(e.validation ? 400 : 500).json({ error: e.message });
    }
};

const setBannerEnabled = (req, res) => {
    const enabled = !!req.body?.enabled;
    db.updateSettings({ banner_enabled: enabled });
    banner.resetBannerCache();
    res.json({ ok: true, enabled, message: `Banner bot ${enabled ? 'diaktifkan' : 'dinonaktifkan'}` });
};

const getBannerFile = (req, res) => {
    const file = banner.resolveBannerPath();
    if (!file) return res.status(404).json({ error: 'Banner belum tersedia' });
    res.set('Cache-Control', 'private, no-store');
    res.sendFile(file);
};

const uploadBanner = async (req, res) => {
    let tmp = null;
    try {
        const match = String(req.body?.data_url || '').match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
        if (!match || !BANNER_TYPES[match[1]]) return res.status(400).json({ error: 'Format banner harus PNG, JPG, atau WebP' });
        const bytes = Buffer.from(match[2], 'base64');
        if (!bytes.length || bytes.length > BANNER_MAX_BYTES) return res.status(400).json({ error: 'Ukuran banner maksimal 5 MB' });
        const meta = await sharp(bytes).metadata();
        if (!meta.width || !meta.height || meta.width < 320 || meta.height < 120 || meta.width > 4096 || meta.height > 4096) {
            return res.status(400).json({ error: 'Dimensi banner minimal 320×120 dan maksimal 4096×4096' });
        }
        fs.mkdirSync(ASSETS_DIR, { recursive: true });
        const ext = BANNER_TYPES[match[1]];
        tmp = path.join(ASSETS_DIR, `.banner-upload-${process.pid}-${Date.now()}${ext}`);
        fs.writeFileSync(tmp, bytes, { flag: 'wx' });
        const finalPath = path.join(ASSETS_DIR, `banner${ext}`);
        // Same-extension rename is atomic on this filesystem; only remove other formats
        // after the validated replacement is already active.
        fs.renameSync(tmp, finalPath); tmp = null;
        for (const oldExt of ['.png', '.jpg', '.jpeg', '.webp', '.gif']) {
            const old = path.join(ASSETS_DIR, `banner${oldExt}`);
            if (old !== finalPath && fs.existsSync(old)) fs.unlinkSync(old);
        }
        db.updateSettings({ banner_enabled: true });
        banner.resetBannerCache();
        res.json({ ok: true, filename: path.basename(finalPath), message: 'Banner berhasil diperbarui' });
    } catch (e) {
        if (tmp) try { fs.unlinkSync(tmp); } catch (_) { }
        res.status(400).json({ error: 'File banner tidak valid' });
    }
};

const deleteBanner = (req, res) => {
    const file = banner.resolveBannerPath();
    if (file) fs.unlinkSync(file);
    banner.resetBannerCache();
    res.json({ ok: true, message: 'Banner berhasil dihapus' });
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
            if (!/^https?:\/\/[^\s]+$/i.test(cleanCredentials.registered_notify_url)) {
                return res.status(400).json({ error: 'Notify URL Xoftware harus URL http/https yang valid' });
            }
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
            if (existing.provider === 'xoftware' && credUpdate.registered_notify_url !== undefined &&
                !/^https?:\/\/[^\s]+$/i.test(credUpdate.registered_notify_url)) {
                return res.status(400).json({ error: 'Notify URL Xoftware harus URL http/https yang valid' });
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
    // Credential .env bisa jadi fallback setelah row DB dihapus. Untuk Binance
    // gunakan resolver env khusus karena flow-nya bukan provider QRIS.
    const envCredential = existing.provider === 'binancepay'
        ? gateway.binanceEnvCredential()
        : gateway.envCredential(existing.provider);
    const env_configured = !!envCredential;
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
        // Binance Pay bukan adapter QRIS; tetap punya test koneksi sendiri (read-only API).
        const result = gw.provider === 'binancepay'
            ? await gateway.testBinanceConnection(creds)
            : await gateway.testConnection(gw.provider, creds);
        res.json(result);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};


const registerSettingsRoutes = (api) => {
    api.get('/settings', getSettings);
    api.patch('/settings/toggle', toggleSetting);
    api.put('/settings/store', updateStore);
    api.patch('/settings/banner/toggle', setBannerEnabled);
    api.get('/settings/banner/file', getBannerFile);
    api.post('/settings/banner', uploadBanner);
    api.delete('/settings/banner', deleteBanner);
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
