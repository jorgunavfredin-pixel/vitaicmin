const db = require('../models/db');
const jobs = new Map();
const DELAY_MS = 50;
const TTL_MS = 10 * 60 * 1000;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const resolveTargets = (target = 'all', categoryId = null) => {
  if (target === 'category') {
    const category = db.getCategories().find(c => c.id === categoryId);
    if (!category) throw Object.assign(new Error('Kategori tidak ditemukan'), { status: 400 });
    const productIds = new Set(db.getProductsByCategory(categoryId).map(p => p.id));
    const users = [...new Set(db.getOrders().filter(o => productIds.has(o.product_id) && ['paid','delivered'].includes(o.status)).map(o => String(o.user_id)))];
    return { users, label: `kategori ${category.name_id}` };
  }
  return { users: Object.keys(db.getUsers()), label: 'semua user' };
};

const startBroadcastJob = ({ telegram, users, label, send }) => {
  if (!users.length) throw Object.assign(new Error('Tidak ada user target'), { status: 400 });
  const id = `BC-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
  const job = { id, total: users.length, processed: 0, sent: 0, failed: 0, status: 'queued', label, startedAt: Date.now(), finishedAt: null };
  jobs.set(id, job);
  (async () => {
    job.status = 'running';
    for (let i=0;i<users.length;i++) {
      try { await send(telegram, users[i]); job.sent++; } catch (_) { job.failed++; }
      job.processed=i+1;
      if (i<users.length-1) await sleep(DELAY_MS);
    }
    job.status='done'; job.finishedAt=Date.now();
    const cleanup = setTimeout(() => jobs.delete(id), TTL_MS);
    cleanup.unref?.();
  })().catch(e=>{job.status='error';job.error=e.message;});
  return job;
};
const getBroadcastJob = id => jobs.get(id) || null;
module.exports={resolveTargets,startBroadcastJob,getBroadcastJob};
