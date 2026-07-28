/**
 * Web admin panel authentication (password + JWT)
 *
 * Password resolution order:
 *   1. Hash tersimpan di DB (settings.admin_password) — bisa diganti dari panel.
 *   2. Fallback ke ADMIN_PANEL_PASSWORD (.env) — dipakai kalau belum pernah diganti.
 * Hash pakai scrypt (crypto native, tanpa dependency tambahan).
 */
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../models/db');

// JWT secret: env jika tersedia; jika kosong generate sekali dan simpan persisten di DB.
// Admin tidak perlu mengelola secret manual dan secret tidak berubah saat restart.
const getSecret = () => {
    if (process.env.ADMIN_JWT_SECRET) return process.env.ADMIN_JWT_SECRET;
    let secret = db.getConfig('admin_jwt_secret', null, '');
    if (!secret) {
        secret = crypto.randomBytes(32).toString('hex');
        db.updateSettings({ admin_jwt_secret: secret });
    }
    return secret;
};
const getSessionVersion = () => parseInt(db.getConfig('admin_session_version', null, 1)) || 1;
const getEnvPassword = () => process.env.ADMIN_PANEL_PASSWORD || '';
const recoveryAttempts = new Map();
const RECOVERY_WINDOW = 15 * 60 * 1000;
const RECOVERY_MAX = 5;

// Constant-time compare untuk plaintext (fallback env)
const safeEqual = (a, b) => {
    const ba = Buffer.from(String(a));
    const bb = Buffer.from(String(b));
    if (ba.length !== bb.length) return false;
    return crypto.timingSafeEqual(ba, bb);
};

// ---- scrypt password hashing ----
const hashPassword = (password) => {
    const salt = crypto.randomBytes(16).toString('hex');
    const derived = crypto.scryptSync(String(password), salt, 64).toString('hex');
    return `${salt}:${derived}`;
};

const verifyHash = (password, stored) => {
    try {
        const [salt, key] = String(stored).split(':');
        if (!salt || !key) return false;
        const derived = crypto.scryptSync(String(password), salt, 64);
        const keyBuf = Buffer.from(key, 'hex');
        if (keyBuf.length !== derived.length) return false;
        return crypto.timingSafeEqual(keyBuf, derived);
    } catch (e) {
        return false;
    }
};

// Ambil hash password custom dari DB (null kalau belum di-set)
const getStoredHash = () => {
    try {
        const s = db.getSettings();
        return s.admin_password_hash || null;
    } catch (e) {
        return null;
    }
};

// Verifikasi password input terhadap sumber yang aktif (DB hash > env plaintext)
const verifyPassword = (input) => {
    const stored = getStoredHash();
    if (stored) return verifyHash(input, stored);
    const envPass = getEnvPassword();
    if (!envPass) return null; // null = belum dikonfigurasi sama sekali
    return safeEqual(input, envPass);
};

// Apakah password sudah pernah diubah lewat panel (bukan env lagi)
const isCustomPassword = () => !!getStoredHash();

const signToken = () => jwt.sign({ role: 'admin', sv: getSessionVersion() }, getSecret(), { expiresIn: '24h' });

// POST /api/admin/login  { password }
const login = (req, res) => {
    const input = (req.body && req.body.password) || '';
    const result = verifyPassword(input);
    if (result === null) {
        return res.status(500).json({ error: 'Admin panel belum dikonfigurasi. Set ADMIN_PANEL_PASSWORD di .env atau ganti password.' });
    }
    if (!result) {
        return res.status(401).json({ error: 'Password salah' });
    }
    return res.json({ token: signToken(), expiresIn: '24h' });
};

// Middleware: require a valid Bearer token
const requireAuth = (req, res, next) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    try {
        const payload = jwt.verify(token, getSecret());
        if (payload.sv !== getSessionVersion()) throw new Error('Session revoked');
        return next();
    } catch (e) {
        return res.status(401).json({ error: 'Sesi kadaluarsa, silakan login ulang' });
    }
};

// Ganti password panel: simpan hash baru ke DB.
const changePassword = (currentPassword, newPassword) => {
    const ok = verifyPassword(currentPassword);
    if (ok === null) throw new Error('Panel belum dikonfigurasi');
    if (!ok) throw new Error('Password lama salah');
    setAdminPassword(newPassword, 6);
    return true;
};

const setAdminPassword = (newPassword, minimumLength = 10) => {
    if (!newPassword || String(newPassword).length < minimumLength) throw new Error(`Password baru minimal ${minimumLength} karakter`);
    db.updateSettings({
        admin_password_hash: hashPassword(newPassword),
        admin_session_version: getSessionVersion() + 1
    });
    return true;
};

const resetPasswordToEnv = (recoveryPassword) => {
    const recovery = getEnvPassword();
    if (!recovery || !safeEqual(recoveryPassword, recovery)) throw new Error('Recovery password tidak valid');
    // Hapus hash custom agar login kembali memakai ADMIN_PANEL_PASSWORD dari .env.
    db.updateSettings({
        admin_password_hash: '',
        admin_session_version: getSessionVersion() + 1
    });
    return true;
};

// POST /api/admin/forgot-password — public, tetapi dibatasi per IP.
const forgotPassword = (req, res) => {
    const ip = String(req.ip || req.socket?.remoteAddress || 'unknown');
    const now = Date.now();
    const recent = (recoveryAttempts.get(ip) || []).filter(ts => now - ts < RECOVERY_WINDOW);
    if (recent.length >= RECOVERY_MAX) {
        return res.status(429).json({ error: 'Terlalu banyak percobaan. Coba lagi dalam 15 menit.' });
    }
    recent.push(now);
    recoveryAttempts.set(ip, recent);
    try {
        resetPasswordToEnv(req.body?.recoveryPassword || '');
        recoveryAttempts.delete(ip);
        return res.json({ ok: true, message: 'Password custom direset. Silakan login menggunakan ADMIN_PANEL_PASSWORD dari .env.' });
    } catch (e) {
        return res.status(400).json({ error: 'Recovery password tidak valid' });
    }
};

module.exports = {
    login, forgotPassword, requireAuth, changePassword, resetPasswordToEnv,
    isCustomPassword, verifyPassword, getSecret, getSessionVersion
};
