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

// JWT secret: dedicated env, else fall back to bot token (always present)
const getSecret = () => process.env.ADMIN_JWT_SECRET || process.env.BOT_TOKEN || 'insecure-dev-secret';
const getEnvPassword = () => process.env.ADMIN_PANEL_PASSWORD || '';

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

const signToken = () => jwt.sign({ role: 'admin' }, getSecret(), { expiresIn: '7d' });

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
    return res.json({ token: signToken(), expiresIn: '7d' });
};

// Middleware: require a valid Bearer token
const requireAuth = (req, res, next) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    try {
        jwt.verify(token, getSecret());
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
    if (!newPassword || String(newPassword).length < 6) throw new Error('Password baru minimal 6 karakter');
    db.updateSettings({ admin_password_hash: hashPassword(newPassword) });
    return true;
};

module.exports = { login, requireAuth, changePassword, isCustomPassword, verifyPassword };
