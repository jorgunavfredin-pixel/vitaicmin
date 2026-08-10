const db = require('../models/db');
const crypto = require('crypto');

const sql = db._db;
sql.exec(`CREATE TABLE IF NOT EXISTS admin_audit_log (
  id TEXT PRIMARY KEY,
  actor TEXT NOT NULL,
  category TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  summary TEXT NOT NULL,
  status TEXT NOT NULL,
  http_status INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_category ON admin_audit_log(category, created_at DESC);`);

const CATEGORY_RULES = [
  [/^\/orders/, 'order'], [/^\/stock|^\/products|^\/categories|^\/flash-sales/, 'stock'],
  [/^\/users|^\/balances/, 'customer'], [/^\/gateways|^\/qris-custom/, 'payment'],
  [/^\/broadcast/, 'broadcast'], [/^\/vouchers/, 'voucher'], [/^\/settings/, 'settings']
];
const categoryFor = path => CATEGORY_RULES.find(([rx]) => rx.test(path))?.[1] || 'system';
const actionVerb = method => ({ POST: 'Membuat', PUT: 'Memperbarui', PATCH: 'Mengubah', DELETE: 'Menghapus' }[method] || method);
const resourceName = path => {
  const root = path.split('/').filter(Boolean)[0] || 'sistem';
  return ({ orders:'order', stock:'stok', products:'produk', categories:'kategori', users:'customer', balances:'saldo', gateways:'gateway pembayaran', 'qris-custom':'QRIS Custom', broadcast:'broadcast', vouchers:'voucher', settings:'pengaturan', 'flash-sales':'flash sale' })[root] || root;
};
const targetFrom = path => {
  const parts = path.split('/').filter(Boolean);
  const raw = parts[1];
  if (!raw || ['overview','export.csv','preview','upload','targets','toggle'].includes(raw)) return null;
  try { return decodeURIComponent(raw); } catch (_) { return raw; }
};
const summaryFor = (method, path, resource, targetId) => {
  if (/\/test$/.test(path)) return `Menguji koneksi ${resource}${targetId ? ` ${targetId}` : ''}`;
  if (/\/toggle$/.test(path)) return `Mengubah status ${resource}`;
  if (/\/balance$/.test(path)) return `Menyesuaikan saldo customer${targetId ? ` ${targetId}` : ''}`;
  if (/\/flash-sale$/.test(path)) return `${method === 'DELETE' ? 'Menghapus' : 'Mengatur'} flash sale${targetId ? ` ${targetId}` : ''}`;
  return `${actionVerb(method)} ${resource}${targetId ? ` ${targetId}` : ''}`;
};

const record = ({ actor='admin-web', category, action, targetType, targetId, summary, status='success', httpStatus=null, createdAt=new Date().toISOString() }) => {
  try {
    sql.prepare(`INSERT INTO admin_audit_log (id,actor,category,action,target_type,target_id,summary,status,http_status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(`AUD-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`, actor, category, action, targetType || null, targetId || null, String(summary).slice(0,500), status, httpStatus, createdAt);
  } catch (_) { /* audit must never break the business request */ }
};

const middleware = (req, res, next) => {
  if (!['POST','PUT','PATCH','DELETE'].includes(req.method)) return next();
  const path = req.path;
  if (path.startsWith('/login') || path.startsWith('/forgot-password') || path.endsWith('/preview') || path === '/broadcast/preview') return next();
  res.on('finish', () => {
    const category = categoryFor(path), targetId = targetFrom(path), resource = resourceName(path);
    const ok = res.statusCode >= 200 && res.statusCode < 400;
    record({ category, action: `${req.method} ${path}`, targetType: resource, targetId,
      summary: summaryFor(req.method, path, resource, targetId),
      status: ok ? 'success' : 'failed', httpStatus: res.statusCode });
  });
  next();
};

const list = ({ category='all', q='', limit=100 }={}) => {
  let rows = sql.prepare('SELECT * FROM admin_audit_log ORDER BY created_at DESC LIMIT ?').all(Math.min(300, Math.max(20, limit)));
  if (category !== 'all') rows = rows.filter(r => r.category === category);
  if (q) { const s=q.toLowerCase(); rows=rows.filter(r=>`${r.summary} ${r.target_id||''} ${r.action}`.toLowerCase().includes(s)); }
  return rows;
};
module.exports = { middleware, record, list };
