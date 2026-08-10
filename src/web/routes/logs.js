/**
 * Logs route — viewer read-only untuk log bot (logs/bot.log).
 * Aman: hanya membaca file log yang sudah ada, tail N baris terakhir. Tidak menulis apa pun.
 */
const fs = require('fs');
const path = require('path');
const db = require('../../models/db');
const auditLog = require('../../services/auditLog');

const LOG_CANDIDATES = [
  path.join(process.cwd(), 'logs', 'bot.log'),
  path.join(__dirname, '../../../logs/bot.log'),
];

const resolveLogPath = () => {
  for (const p of LOG_CANDIDATES) {
    try { if (fs.existsSync(p)) return p; } catch (_) { /* ignore */ }
  }
  return null;
};

// Tail terakhir `lines` baris tanpa memuat seluruh file besar ke memori.
const tailFile = (filePath, maxLines) => {
  const stat = fs.statSync(filePath);
  const size = stat.size;
  const chunk = 64 * 1024;
  let pos = size;
  let buffer = '';
  let lines = [];
  const fd = fs.openSync(filePath, 'r');
  try {
    while (pos > 0 && lines.length <= maxLines) {
      const readSize = Math.min(chunk, pos);
      pos -= readSize;
      const buf = Buffer.alloc(readSize);
      fs.readSync(fd, buf, 0, readSize, pos);
      buffer = buf.toString('utf8') + buffer;
      lines = buffer.split(/\r?\n/);
    }
  } finally {
    fs.closeSync(fd);
  }
  return lines.filter((l) => l.length).slice(-maxLines);
};

const getLogs = (req, res) => {
  try {
    // Web admin hanya menampilkan 50 baris terminal terbaru.
    const maxLines = 50;
    const filter = (req.query.q || '').toLowerCase().trim();
    const filePath = resolveLogPath();

    if (!filePath) {
      return res.json({ available: false, lines: [], message: 'File log belum ada', size: 0, path: null });
    }

    let lines = tailFile(filePath, maxLines);
    if (filter) lines = lines.filter((l) => l.toLowerCase().includes(filter));

    const stat = fs.statSync(filePath);
    res.json({
      available: true,
      lines,
      count: lines.length,
      size: stat.size,
      modified: stat.mtime.toISOString(),
      path: path.basename(filePath),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

const getActivity = (req, res) => {
  try {
    const limit = 50;
    const products = Object.fromEntries(db.getProducts().map(p => [p.id, p.name_id]));

    // Ambil maksimal 50 langsung dari SQLite; jangan scan seluruh riwayat order.
    const recentOrders = db._db.prepare('SELECT id,user_id,product_id,total_idr,status,created_at FROM orders ORDER BY created_at DESC LIMIT 50').all();
    const orderEvents = recentOrders.map(o => ({
      id: `order-${o.id}`, source: 'store', category: ['paid','delivered'].includes(o.status) ? 'payment' : 'order',
      title: ['paid','delivered'].includes(o.status) ? 'Pembayaran order berhasil' : `Order ${o.status || 'dibuat'}`,
      summary: `${o.id} · ${products[o.product_id] || (o.product_id === 'TOPUP' ? 'Topup Saldo' : o.product_id)} · Rp ${Number(o.total_idr || 0).toLocaleString('id-ID')}`,
      target_id: o.id, status: ['cancelled','expired','refunded'].includes(o.status) ? 'warning' : 'success', created_at: o.created_at
    }));
    let balanceEvents = [];
    try {
      balanceEvents = db._db.prepare('SELECT id,user_id,amount,note,method,created_at FROM balance_history ORDER BY created_at DESC LIMIT 50').all().map(r => ({
        id: `balance-${r.id}`, source: 'store', category: 'customer', title: Number(r.amount) >= 0 ? 'Saldo customer bertambah' : 'Saldo customer berkurang',
        summary: `User ${r.user_id} · ${Number(r.amount) >= 0 ? '+' : '−'}Rp ${Math.abs(Number(r.amount || 0)).toLocaleString('id-ID')}${r.note ? ` · ${r.note}` : ''}`,
        target_id: String(r.user_id), status: Number(r.amount) >= 0 ? 'success' : 'warning', created_at: r.created_at
      }));
    } catch (_) { balanceEvents = []; }
    const adminEvents = auditLog.list({ limit: 50 }).map(r => ({
      id: r.id, source: r.actor, category: r.category, title: r.summary,
      summary: r.target_id ? `Target: ${r.target_id}` : 'Dilakukan dari web admin', target_id: r.target_id,
      status: r.status === 'failed' ? 'error' : 'info', created_at: r.created_at, http_status: r.http_status
    }));
    let items = [...adminEvents, ...orderEvents, ...balanceEvents].filter(x => x.created_at)
      .sort((a,b) => String(b.created_at).localeCompare(String(a.created_at)));
    items = items.slice(0, limit);
    res.json({ items, total: items.length, limit, generated_at: new Date().toISOString() });
  } catch (e) { res.status(500).json({ error: e.message }); }
};

const registerLogRoutes = (router) => {
  router.get('/logs', getLogs);
  router.get('/activity', getActivity);
};

module.exports = { registerLogRoutes };
