/**
 * Broadcast untuk panel web admin.
 * Mirror fitur chat-admin (src/admin/broadcast.js) tapi dengan:
 *  - header opsional (kosong => pakai default template)
 *  - format HTML (parse_mode HTML) biar enak dari web + preview
 *  - support foto (dikirim frontend sebagai base64 data URL)
 *  - progress job in-memory + polling status (loading bar di UI)
 *
 * Kenapa job in-memory + polling (bukan SSE):
 *  broadcast bisa makan menit-an; progress-nya spesifik per job. Job store
 *  sederhana + endpoint GET status lebih reliable & gampang di-render jadi bar.
 */
const db = require('../../models/db');
const { resolveTargets: sharedResolveTargets, startBroadcastJob, getBroadcastJob } = require('../../services/broadcast');

const BROADCAST_DELAY_MS = 50;      // ~20 msg/sec, aman dari rate limit Telegram
const DEFAULT_HEADER = '📢 BROADCAST MESSAGE';
const JOB_TTL_MS = 10 * 60 * 1000;  // job selesai dibersihkan setelah 10 menit

// In-memory job store: { [jobId]: { total, sent, failed, status, startedAt, finishedAt, label } }
const jobs = new Map();

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Tentukan daftar user target sesuai mode.
const resolveTargets = (target, categoryId) => {
    if (target === 'category') {
        if (!categoryId) return { error: 'categoryId wajib untuk target kategori' };
        const cat = db.getCategories().find(c => c.id === categoryId);
        if (!cat) return { error: 'Kategori tidak ditemukan' };
        const productIds = db.getProductsByCategory(categoryId).map(p => p.id);
        const orders = db.getOrders().filter(o =>
            productIds.includes(o.product_id) && ['delivered', 'paid'].includes(o.status));
        const users = [...new Set(orders.map(o => String(o.user_id)))];
        return { users, label: `kategori ${cat.name_id}` };
    }
    // default: semua user
    const users = Object.keys(db.getUsers());
    return { users, label: 'semua user' };
};

// Decode "data:image/...;base64,XXXX" -> Buffer, atau null kalau bukan data URL valid.
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const dataUrlToBuffer = (dataUrl) => {
    if (!dataUrl || typeof dataUrl !== 'string') return null;
    const m = dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/);
    if (!m) return null;
    try {
        const buffer = Buffer.from(m[2], 'base64');
        return buffer.length > 0 && buffer.length <= MAX_PHOTO_BYTES ? buffer : null;
    } catch (e) { return null; }
};

// Jalankan broadcast di background (non-blocking).
const runBroadcast = async (bot, jobId, userIds, { header, body, photoBuffer }) => {
    const job = jobs.get(jobId);
    if (!job) return;

    const headerText = (header && header.trim()) ? header.trim() : DEFAULT_HEADER;
    // Header di-bold (HTML), lalu body apa adanya (frontend sudah kirim HTML valid).
    const fullText = `<b>${escapeHtmlText(headerText)}</b>\n\n${body || ''}`.trim();

    job.status = 'running';

    for (let i = 0; i < userIds.length; i++) {
        const uid = userIds[i];
        try {
            if (photoBuffer) {
                await bot.telegram.sendPhoto(uid, { source: photoBuffer }, {
                    caption: fullText || undefined,
                    parse_mode: 'HTML'
                });
            } else {
                await bot.telegram.sendMessage(uid, fullText, { parse_mode: 'HTML' });
            }
            job.sent++;
        } catch (e) {
            job.failed++;
        }
        job.processed = i + 1;
        if (i < userIds.length - 1) await sleep(BROADCAST_DELAY_MS);
    }

    job.status = 'done';
    job.finishedAt = Date.now();
    // Auto-cleanup
    setTimeout(() => jobs.delete(jobId), JOB_TTL_MS);
};

// Escape hanya untuk header (biar user gak bisa nyuntik tag lewat header).
// Body dibiarkan HTML mentah karena memang fitur "format HTML".
const escapeHtmlText = (s) => String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ---- GET /broadcast/targets ----  daftar kategori + jumlah user "semua"
const getTargets = (req, res) => {
    try {
        const allUsers = Object.keys(db.getUsers()).length;
        const categories = db.getCategories()
            .filter(c => c.active !== false)
            .map(c => ({ id: c.id, name: c.name_id, emoji: c.emoji || '📢' }));
        res.json({ allUsers, categories });
    } catch (e) {
        res.status(e.status || 500).json({ error: e.message });
    }
};

// ---- POST /broadcast/preview ----  { target, categoryId } -> jumlah target
const previewTargets = (req, res) => {
    try {
        const { target, categoryId } = req.body;
        const r = sharedResolveTargets(target, categoryId);
        if (r.error) return res.status(400).json({ error: r.error });
        res.json({ count: r.users.length, label: r.label });
    } catch (e) {
        res.status(e.status || 500).json({ error: e.message });
    }
};

// ---- POST /broadcast ----  mulai broadcast (background), balikin jobId
const startBroadcast = (bot) => (req, res) => {
    try {
        const { target, categoryId, header, body, photo } = req.body;

        const r = sharedResolveTargets(target, categoryId);
        if (r.error) return res.status(400).json({ error: r.error });

        const photoBuffer = photo ? dataUrlToBuffer(photo) : null;
        if (photo && !photoBuffer) return res.status(400).json({ error: 'Format foto tidak valid (harus data URL base64)' });
        if (!photoBuffer && !(body && body.trim())) {
            return res.status(400).json({ error: 'Isi pesan tidak boleh kosong' });
        }
        if (r.users.length === 0) return res.status(400).json({ error: 'Tidak ada user target' });

        const headerText = (header && header.trim()) ? header.trim() : DEFAULT_HEADER;
        const fullText = `<b>${escapeHtmlText(headerText)}</b>

${body || ''}`.trim();
        const job = startBroadcastJob({
            telegram: bot.telegram, users: r.users, label: r.label,
            send: (telegram, uid) => photoBuffer
                ? telegram.sendPhoto(uid, { source: photoBuffer }, { caption: fullText || undefined, parse_mode: 'HTML' })
                : telegram.sendMessage(uid, fullText, { parse_mode: 'HTML' })
        });
        const jobId = job.id;

        res.json({ ok: true, jobId, total: r.users.length, label: r.label });
    } catch (e) {
        res.status(e.status || 500).json({ error: e.message });
    }
};

// ---- GET /broadcast/status/:jobId ----
const getStatus = (req, res) => {
    try {
        const job = getBroadcastJob(req.params.jobId);
        if (!job) return res.status(404).json({ error: 'Job tidak ditemukan / sudah kedaluwarsa' });
        const pct = job.total > 0 ? Math.round((job.processed / job.total) * 100) : 100;
        res.json({ ...job, pct });
    } catch (e) {
        res.status(e.status || 500).json({ error: e.message });
    }
};

const registerBroadcastRoutes = (api, bot) => {
    api.get('/broadcast/targets', getTargets);
    api.post('/broadcast/preview', previewTargets);
    api.post('/broadcast', startBroadcast(bot));
    api.get('/broadcast/status/:jobId', getStatus);
};

module.exports = { registerBroadcastRoutes };
