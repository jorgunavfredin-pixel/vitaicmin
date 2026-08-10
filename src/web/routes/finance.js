/**
 * Finance routes — Transactions & Balance (web admin panel)
 * Read-only reporting dari data existing (orders + balance_history). Tidak mengubah business logic.
 */
const db = require('../../models/db');

// ---- Transactions: gabungan order pembayaran + mutasi saldo, terurut terbaru ----
const getTransactions = (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(5, parseInt(req.query.pageSize) || 25));
    const typeFilter = (req.query.type || 'all').toLowerCase();  // all | order | balance
    const q = (req.query.q || '').toLowerCase().trim();

    const products = db.getProducts();
    const prodMap = Object.fromEntries(products.map((p) => [p.id, p]));
    const orders = db.getOrders();

    // Sumber 1: order (produk + topup)
    const orderTx = orders.map((o) => ({
      id: o.id,
      kind: 'order',
      user_id: o.user_id,
      label: o.product_id === 'TOPUP' ? '💰 Topup Saldo' : (prodMap[o.product_id]?.name_id || o.product_id),
      amount: o.total_idr || 0,
      method: o.payment_method || '-',
      status: o.status,
      created_at: o.created_at,
    }));

    // Sumber 2: mutasi saldo (balance_history)
    let balRows = [];
    try {
      balRows = db._db.prepare('SELECT * FROM balance_history ORDER BY created_at DESC').all();
    } catch (_) { balRows = []; }
    const balTx = balRows.map((b) => ({
      id: b.id,
      kind: 'balance',
      user_id: b.user_id,
      label: b.note || `Saldo (${b.type})`,
      amount: b.amount || 0,
      method: b.method || 'saldo',
      status: (b.amount || 0) >= 0 ? 'credit' : 'debit',
      balance_after: b.balance_after,
      created_at: b.created_at,
    }));

    let all = [...orderTx, ...balTx];
    if (typeFilter === 'order') all = orderTx;
    else if (typeFilter === 'balance') all = balTx;

    if (q) {
      all = all.filter((t) =>
        String(t.id).toLowerCase().includes(q) ||
        String(t.user_id).toLowerCase().includes(q) ||
        String(t.label).toLowerCase().includes(q)
      );
    }

    all.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));

    const total = all.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const items = all.slice((page - 1) * pageSize, page * pageSize);

    // Ringkasan
    const paidStatuses = ['paid', 'delivered'];
    const totalIncome = orderTx
      .filter((t) => paidStatuses.includes(t.status) && t.label !== '💰 Topup Saldo')
      .reduce((s, t) => s + t.amount, 0);
    const topupTotal = balTx.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);

    res.json({
      items, page, pageSize, total, totalPages,
      summary: { totalIncome, topupTotal, orderCount: orderTx.length, balanceCount: balTx.length },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

// ---- Balance: saldo per user + ringkasan + riwayat mutasi opsional per user ----
const getBalances = (req, res) => {
  try {
    const q = (req.query.q || '').toLowerCase().trim();
    const users = db.getUsers();  // object keyed by user_id

    let balances = [];
    try {
      balances = db._db.prepare('SELECT * FROM balances').all();
    } catch (_) { balances = []; }
    const balMap = Object.fromEntries(balances.map((b) => [String(b.user_id), b.balance || 0]));

    // Susun daftar user yang punya saldo > 0 atau pernah ada mutasi
    let list = Object.entries(users).map(([uid, u]) => ({
      user_id: uid,
      name: u.first_name || u.username || uid,
      username: u.username || null,
      balance: balMap[String(uid)] || 0,
    }));

    // sisipkan user yang ada di balances tapi tak ada di users map
    for (const b of balances) {
      if (!users[b.user_id] && !list.find((x) => String(x.user_id) === String(b.user_id))) {
        list.push({ user_id: String(b.user_id), name: String(b.user_id), username: null, balance: b.balance || 0 });
      }
    }

    if (q) {
      list = list.filter((x) =>
        String(x.user_id).toLowerCase().includes(q) ||
        String(x.name).toLowerCase().includes(q) ||
        String(x.username || '').toLowerCase().includes(q)
      );
    }

    list.sort((a, b) => b.balance - a.balance);

    const totalBalance = list.reduce((s, x) => s + x.balance, 0);
    const withBalance = list.filter((x) => x.balance > 0).length;

    res.json({
      items: list.slice(0, 200),
      summary: { totalBalance, withBalance, totalUsers: list.length },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

// ---- Riwayat mutasi saldo satu user ----
const getBalanceHistory = (req, res) => {
  try {
    const userId = req.params.userId;
    let rows = [];
    try {
      rows = db._db.prepare('SELECT * FROM balance_history WHERE user_id = ? ORDER BY created_at DESC LIMIT 100').all(userId);
    } catch (_) { rows = []; }
    res.json({ items: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

const registerFinanceRoutes = (router) => {
  router.get('/transactions', getTransactions);
  router.get('/balances', getBalances);
  router.get('/balances/:userId/history', getBalanceHistory);
};

module.exports = { registerFinanceRoutes };
