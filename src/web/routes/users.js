/**
 * User & Balance management untuk panel web admin.
 * Menggabungkan manajemen pelanggan (Users) + saldo (Balance) dalam satu area.
 */
const db = require('../../models/db');
const balance = require('../../payments/balance');
const { adjustUserBalance } = require('../../services/adminBalance');

// Bangun ringkasan spend & order count per user dari tabel orders (sekali query).
const buildSpendMap = () => {
    const rows = db._db.prepare(`
        SELECT user_id,
            COUNT(*) AS orders_total,
            SUM(CASE WHEN status IN ('paid','delivered') AND product_id != 'TOPUP' THEN 1 ELSE 0 END) AS orders_success,
            SUM(CASE WHEN status IN ('paid','delivered') AND product_id != 'TOPUP' THEN total_idr ELSE 0 END) AS total_spend
        FROM orders GROUP BY user_id
    `).all();
    const map = {};
    for (const r of rows) map[r.user_id] = r;
    return map;
};

// Map saldo semua user > 0 (dan juga 0 via fallback getBalance saat detail).
const buildBalanceMap = () => {
    const rows = db._db.prepare('SELECT user_id, balance FROM balances').all();
    const map = {};
    for (const r of rows) map[r.user_id] = r.balance;
    return map;
};

// ---- GET /users ----
const listUsers = (req, res) => {
    try {
        const filter = (req.query.filter || 'all').toLowerCase();
        const q = (req.query.q || '').trim().toLowerCase();
        const sort = (req.query.sort || 'recent').toLowerCase();
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const pageSize = Math.min(100, Math.max(5, parseInt(req.query.pageSize) || 20));

        const usersObj = db.getUsers();
        const spendMap = buildSpendMap();
        const balMap = buildBalanceMap();

        let list = Object.entries(usersObj).map(([uid, u]) => {
            const sp = spendMap[uid] || {};
            return {
                id: uid,
                username: u.username || null,
                first_name: u.first_name || null,
                last_name: u.last_name || null,
                language: u.language || 'id',
                banned: !!u.banned,
                created_at: u.created_at || null,
                balance: balMap[uid] || 0,
                orders_total: sp.orders_total || 0,
                orders_success: sp.orders_success || 0,
                total_spend: sp.total_spend || 0
            };
        });

        // Stats global (sebelum filter)
        const stats = {
            totalUsers: list.length,
            activeBuyers: list.filter(u => u.orders_success > 0).length,
            bannedUsers: list.filter(u => u.banned).length,
            totalBalance: list.reduce((s, u) => s + u.balance, 0)
        };

        // Counts per filter
        const counts = {
            all: list.length,
            buyer: list.filter(u => u.orders_success > 0).length,
            banned: list.filter(u => u.banned).length,
            balance: list.filter(u => u.balance > 0).length
        };

        // Filter
        if (filter === 'buyer') list = list.filter(u => u.orders_success > 0);
        else if (filter === 'banned') list = list.filter(u => u.banned);
        else if (filter === 'balance') list = list.filter(u => u.balance > 0);

        // Search
        if (q) {
            list = list.filter(u =>
                String(u.id).toLowerCase().includes(q) ||
                (u.username || '').toLowerCase().includes(q) ||
                (u.first_name || '').toLowerCase().includes(q) ||
                (u.last_name || '').toLowerCase().includes(q)
            );
        }

        // Sort
        if (sort === 'spend') list.sort((a, b) => b.total_spend - a.total_spend);
        else if (sort === 'balance') list.sort((a, b) => b.balance - a.balance);
        else if (sort === 'orders') list.sort((a, b) => b.orders_success - a.orders_success);
        else list.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')); // recent

        const total = list.length;
        const totalPages = Math.max(1, Math.ceil(total / pageSize));
        const start = (Math.min(page, totalPages) - 1) * pageSize;
        const pageItems = list.slice(start, start + pageSize);

        res.json({ users: pageItems, total, page: Math.min(page, totalPages), pageSize, totalPages, counts, stats });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

// ---- GET /users/:id ----
const getUserDetail = (req, res) => {
    try {
        const { id } = req.params;
        const user = db.getUser(id);
        if (!user) return res.status(404).json({ error: 'User tidak ditemukan' });

        const orders = db.getOrdersByUser(id);
        const success = orders.filter(o => ['paid', 'delivered'].includes(o.status) && o.product_id !== 'TOPUP');
        const totalSpend = success.reduce((s, o) => s + (o.total_idr || 0), 0);

        const recentOrders = orders.slice(0, 10).map(o => ({
            id: o.id,
            product: o.product_id === 'TOPUP' ? '💰 Topup Saldo' : (db.getProductById(o.product_id)?.name_id || o.product_id),
            quantity: o.quantity,
            total_idr: o.total_idr,
            status: o.status,
            method: o.payment_method,
            created_at: o.created_at
        }));

        const balHistory = balance.getBalanceHistory(id, 20).map(h => ({
            id: h.id, type: h.type, amount: h.amount, method: h.method,
            note: h.note, balance_after: h.balance_after, created_at: h.created_at
        }));

        res.json({
            id,
            username: user.username || null,
            first_name: user.first_name || null,
            last_name: user.last_name || null,
            language: user.language || 'id',
            banned: !!user.banned,
            created_at: user.created_at || null,
            balance: balance.getBalance(id),
            stats: {
                orders_total: orders.length,
                orders_success: success.length,
                total_spend: totalSpend
            },
            recent_orders: recentOrders,
            balance_history: balHistory
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

// ---- PATCH /users/:id/ban ----  toggle ban
const toggleBan = (req, res) => {
    try {
        const { id } = req.params;
        const user = db.getUser(id);
        if (!user) return res.status(404).json({ error: 'User tidak ditemukan' });

        const newBan = !user.banned;
        const updated = db.createOrUpdateUser(id, { banned: newBan });
        db.dbEvents.emit('user_change', { type: 'ban_updated', user: updated });
        res.json({ ok: true, banned: newBan, message: newBan ? 'User di-ban' : 'User di-unban' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

// ---- POST /users/:id/balance ----  { action: 'add'|'deduct'|'set', amount, note }
const adjustBalance = (req, res) => {
    try {
        const { id } = req.params;
        const user = db.getUser(id);
        if (!user) return res.status(404).json({ error: 'User tidak ditemukan' });

        const result = adjustUserBalance({
            userId: id,
            action: String(req.body.action || '').toLowerCase(),
            amount: req.body.amount,
            note: req.body.note,
            actorId: 'web-admin',
            channel: 'web'
        });
        res.json({ ok: true, balance: result.balance, message: `Saldo diperbarui: Rp ${result.balance.toLocaleString('id-ID')}` });
    } catch (e) {
        res.status(e.status || 500).json({ error: e.message });
    }
};

const registerUserRoutes = (api) => {
    api.get('/users', listUsers);
    api.get('/users/:id', getUserDetail);
    api.patch('/users/:id/ban', toggleBan);
    api.post('/users/:id/balance', adjustBalance);
};

module.exports = { registerUserRoutes };
