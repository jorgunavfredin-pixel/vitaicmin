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

// Key toggle yang boleh diubah dari web (whitelist — jangan izinkan sembarang key).
const TOGGLE_KEYS = ['maintenance', 'qris_enabled', 'saldo_enabled'];

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
            // Info env read-only (buat referensi admin; nilai sensitif di-mask)
            env: {
                bot_token: mask(process.env.BOT_TOKEN),
                port: process.env.PORT || null,
                webhook_url: process.env.WEBHOOK_URL || null,
                admin_id: process.env.ADMIN_ID || null,
                store_name: process.env.STORE_NAME || null,
                support_username: process.env.SUPPORT_USERNAME || null,
                order_prefix: process.env.ORDER_PREFIX || 'ORD',
                pakasir_api_key: mask(process.env.PAKASIR_API_KEY),
                pakasir_slug: process.env.PAKASIR_SLUG || null
            },
            security: {
                password_source: isCustomPassword() ? 'custom' : 'env'
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

// ---- GET /settings/backup ----  download store.db
const backupDb = (req, res) => {
    let tmpPath = null;
    try {
        const dbDir = path.join(__dirname, '../../database');
        const dbFile = path.join(dbDir, 'store.db');
        const timestamp = getWIBToday();
        const backupName = `backup_${timestamp}.db`;
        // Jangan pakai prefix titik: res.download menolak dotfiles secara default.
        tmpPath = path.join(dbDir, `webbackup_${Date.now()}.db`);

        // Checkpoint WAL ke main DB dulu supaya backup lengkap.
        const Database = require('better-sqlite3');
        const liveDb = new Database(dbFile);
        liveDb.pragma('wal_checkpoint(TRUNCATE)');
        liveDb.close();

        fs.copyFileSync(dbFile, tmpPath);

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

const registerSettingsRoutes = (api) => {
    api.get('/settings', getSettings);
    api.patch('/settings/toggle', toggleSetting);
    api.put('/settings/store', updateStore);
    api.post('/settings/password', updatePassword);
    api.get('/settings/backup', backupDb);
};

module.exports = { registerSettingsRoutes };
