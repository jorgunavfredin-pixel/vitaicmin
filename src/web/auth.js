/**
 * Web admin panel authentication (password + JWT)
 */
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

// JWT secret: dedicated env, else fall back to bot token (always present)
const getSecret = () => process.env.ADMIN_JWT_SECRET || process.env.BOT_TOKEN || 'insecure-dev-secret';
const getPassword = () => process.env.ADMIN_PANEL_PASSWORD || '';

// Constant-time password comparison to avoid timing attacks
const safeEqual = (a, b) => {
    const ba = Buffer.from(String(a));
    const bb = Buffer.from(String(b));
    if (ba.length !== bb.length) return false;
    return crypto.timingSafeEqual(ba, bb);
};

const signToken = () => jwt.sign({ role: 'admin' }, getSecret(), { expiresIn: '7d' });

// POST /api/admin/login  { password }
const login = (req, res) => {
    const password = getPassword();
    if (!password) {
        return res.status(500).json({ error: 'Admin panel belum dikonfigurasi. Set ADMIN_PANEL_PASSWORD di .env' });
    }
    const input = (req.body && req.body.password) || '';
    if (!safeEqual(input, password)) {
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

module.exports = { login, requireAuth };
