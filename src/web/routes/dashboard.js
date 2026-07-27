/**
 * Dashboard stats endpoint for the web admin panel
 */
const db = require('../../models/db');
const { getWIBDateRange } = require('../../utils/helpers');

// Build "YYYY-MM-DD" in WIB from an ISO timestamp
const wibDay = (iso) => {
    if (!iso) return null;
    const d = new Date(new Date(iso).getTime() + 7 * 60 * 60 * 1000);
    return d.toISOString().split('T')[0];
};

const getDashboard = (req, res) => {
    try {
        const detailed = db.getDetailedStats();
        const orders = db.getOrders();
        const products = db.getProducts();
        const users = db.getUsers();

        const paidStatuses = ['paid', 'delivered'];
        // Revenue & chart hanya dari penjualan produk — TOPUP saldo bukan pendapatan (hindari double-count).
        const paidOrders = orders.filter(o => paidStatuses.includes(o.status) && o.product_id !== 'TOPUP');

        // ---- Revenue series: last 30 days (WIB). Frontend bisa toggle tampil 7/14/30 hari. ----
        const { todayWIB } = getWIBDateRange();
        const days = [];
        const base = new Date(todayWIB + 'T00:00:00+07:00');
        for (let i = 29; i >= 0; i--) {
            const d = new Date(base.getTime() - i * 24 * 60 * 60 * 1000);
            days.push(d.toISOString().split('T')[0]);
        }
        const revByDay = Object.fromEntries(days.map(d => [d, 0]));
        const ordByDay = Object.fromEntries(days.map(d => [d, 0]));
        for (const o of paidOrders) {
            const day = wibDay(o.paid_at);
            if (day && day in revByDay) {
                revByDay[day] += o.total_idr || 0;
                ordByDay[day] += 1;
            }
        }
        const revenueSeries = days.map(d => ({
            date: d,
            label: d.slice(5),               // MM-DD
            revenue: revByDay[d],
            orders: ordByDay[d]
        }));

        // ---- Top products (by delivered/paid quantity) ----
        const prodMap = Object.fromEntries(products.map(p => [p.id, p]));
        const soldByProduct = {};
        for (const o of paidOrders) {
            if (o.product_id === 'TOPUP') continue;
            soldByProduct[o.product_id] = (soldByProduct[o.product_id] || 0) + (o.quantity || 0);
        }
        const topProducts = Object.entries(soldByProduct)
            .map(([id, qty]) => ({ id, name: prodMap[id]?.name_id || id, qty }))
            .sort((a, b) => b.qty - a.qty)
            .slice(0, 5);

        // ---- Stock health ----
        let totalStock = 0, lowStockCount = 0;
        for (const p of products) {
            if (p.stock_mode === 'unlimited') continue;
            const cnt = db.getAvailableStockCount(p.id);
            totalStock += cnt;
            if (cnt < 3) lowStockCount += 1;
        }

        // ---- Recent orders (last 6) ----
        const recentOrders = [...orders]
            .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
            .slice(0, 6)
            .map(o => ({
                id: o.id,
                product: o.product_id === 'TOPUP' ? '💰 Topup Saldo' : (prodMap[o.product_id]?.name_id || o.product_id),
                quantity: o.quantity,
                total_idr: o.total_idr,
                status: o.status,
                method: o.payment_method,
                created_at: o.created_at
            }));

        res.json({
            cards: {
                revenueToday: detailed.income.today.total_idr || 0,
                revenueMonth: detailed.income.month.total || 0,
                revenueAllTime: detailed.income.all_time.total || 0,
                ordersTotal: detailed.transactions.total,
                ordersPending: detailed.transactions.pending,
                ordersSuccess: detailed.transactions.success,
                successRate: detailed.transactions.success_rate,
                totalUsers: Object.keys(users).length,
                totalProducts: products.length,
                totalStock,
                lowStockCount
            },
            revenueSeries,
            topProducts,
            recentOrders
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

module.exports = { getDashboard };
