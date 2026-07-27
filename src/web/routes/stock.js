/**
 * Stock Control Center — endpoint stok lintas semua produk untuk panel web admin.
 * Berbeda dari /products/:id/stock (per-produk): ini memberi overview global,
 * daftar alert restock, detail reserved, bulk restock, dan export inventory CSV.
 */
const db = require('../../models/db');
const { formatDateWIB, getWIBToday } = require('../../utils/helpers');

const LOW_STOCK_THRESHOLD = 3;

// Agregat hitungan stok per produk dalam SATU query (available / reserved / sold / total).
const stockCountsByProduct = () => {
    const rows = db._db.prepare(`
        SELECT product_id,
            SUM(CASE WHEN sold = 0 AND reserved_by IS NULL THEN 1 ELSE 0 END) AS available,
            SUM(CASE WHEN sold = 0 AND reserved_by IS NOT NULL THEN 1 ELSE 0 END) AS reserved,
            SUM(CASE WHEN sold = 1 THEN 1 ELSE 0 END) AS sold,
            COUNT(*) AS total
        FROM stock GROUP BY product_id
    `).all();
    const map = {};
    for (const r of rows) map[r.product_id] = r;
    return map;
};

// ---- GET /stock/overview ----
// Kembalikan: stat global, daftar alert restock, dan tabel semua produk (limited/unlimited).
const getOverview = (req, res) => {
    try {
        const products = db.getProducts();
        const categories = db.getCategories();
        const catMap = Object.fromEntries(categories.map(c => [c.id, c]));
        const counts = stockCountsByProduct();

        let totalAvailable = 0, totalReserved = 0, totalSoldAllTime = 0;
        let inventoryValue = 0, lowStockCount = 0, outOfStockCount = 0, unlimitedCount = 0;

        const rows = products.map(p => {
            const c = counts[p.id] || { available: 0, reserved: 0, sold: 0, total: 0 };
            const effPrice = db.getEffectivePrice(p) || 0;
            const isUnlimited = p.stock_mode === 'unlimited';
            const sold30 = db.getSoldQtyByProduct(p.id, 30);

            if (isUnlimited) {
                unlimitedCount++;
            } else {
                totalAvailable += c.available;
                totalReserved += c.reserved;
                inventoryValue += c.available * effPrice;
                if (c.available === 0) outOfStockCount++;
                else if (c.available < LOW_STOCK_THRESHOLD) lowStockCount++;
            }
            totalSoldAllTime += c.sold;

            return {
                id: p.id,
                name_id: p.name_id,
                name_en: p.name_en,
                category_id: p.category_id,
                category_name: catMap[p.category_id]?.name_id || 'Tanpa Kategori',
                stock_type: p.stock_type,
                stock_mode: p.stock_mode,
                active: p.active === true || p.active === 1,
                price_idr: p.price_idr,
                effective_price: effPrice,
                available: isUnlimited ? null : c.available,
                reserved: c.reserved,
                sold_total: c.sold,
                sold_30d: sold30,
                inventory_value: isUnlimited ? 0 : c.available * effPrice,
                // status: unlimited | out | low | ok
                stock_status: isUnlimited ? 'unlimited'
                    : c.available === 0 ? 'out'
                    : c.available < LOW_STOCK_THRESHOLD ? 'low' : 'ok'
            };
        });

        // Alert restock: produk limited yang habis / menipis, paling kritis di atas.
        const alerts = rows
            .filter(r => r.stock_status === 'out' || r.stock_status === 'low')
            .sort((a, b) => (a.available ?? 0) - (b.available ?? 0));

        res.json({
            stats: {
                totalAvailable,
                totalReserved,
                totalSoldAllTime,
                inventoryValue,
                lowStockCount,
                outOfStockCount,
                unlimitedCount,
                totalProducts: products.length,
                alertCount: alerts.length
            },
            alerts,
            products: rows
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

// ---- GET /stock/:id/reserved ----
// Detail order yang sedang menahan (reserve) stok produk tertentu.
const getReservedDetail = (req, res) => {
    try {
        const { id } = req.params;
        const prod = db.getProductById(id);
        if (!prod) return res.status(404).json({ error: 'Produk tidak ditemukan' });

        const groups = db._db.prepare(`
            SELECT reserved_by AS order_id, COUNT(*) AS qty, MIN(reserved_at) AS reserved_at
            FROM stock
            WHERE product_id = ? AND sold = 0 AND reserved_by IS NOT NULL
            GROUP BY reserved_by
            ORDER BY reserved_at ASC
        `).all(id);

        const items = groups.map(g => {
            const order = db.getOrderById(g.order_id);
            const user = order ? db.getUser(order.user_id) : null;
            return {
                order_id: g.order_id,
                qty: g.qty,
                reserved_at: g.reserved_at,
                order_status: order?.status || 'unknown',
                user_id: order?.user_id || null,
                username: user?.username || null,
                first_name: user?.first_name || null,
                total_idr: order?.total_idr || 0,
                created_at: order?.created_at || null,
                expires_at: order?.expires_at || null
            };
        });

        res.json({
            product: { id: prod.id, name_id: prod.name_id, stock_type: prod.stock_type },
            total_reserved: items.reduce((s, i) => s + i.qty, 0),
            items
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

// ---- POST /stock/bulk-restock ----
// Body: { items: [ { product_id, lines: [..] | "a\nb" }, ... ] }
// Tambah stok ke banyak produk sekaligus.
const bulkRestock = (req, res) => {
    try {
        const items = Array.isArray(req.body.items) ? req.body.items : [];
        if (items.length === 0) return res.status(400).json({ error: 'Tidak ada data restock' });

        const results = [];
        let totalAdded = 0;
        for (const it of items) {
            const prod = db.getProductById(it.product_id);
            if (!prod) {
                results.push({ product_id: it.product_id, ok: false, error: 'Produk tidak ditemukan' });
                continue;
            }
            let raw = it.lines;
            let lines = [];
            if (Array.isArray(raw)) lines = raw;
            else if (typeof raw === 'string') lines = raw.split('\n');
            lines = lines.map(l => String(l).trim()).filter(Boolean);

            if (lines.length === 0) {
                results.push({ product_id: it.product_id, name_id: prod.name_id, ok: false, error: 'Tidak ada baris valid' });
                continue;
            }
            const added = db.addBulkStock(it.product_id, lines);
            totalAdded += added.length;
            const total = db.getAvailableStockCount(it.product_id);
            results.push({ product_id: it.product_id, name_id: prod.name_id, ok: true, added: added.length, total });
            db.dbEvents?.emit('product_change', { type: 'stock_added', productId: it.product_id, added: added.length, total });
        }

        res.json({
            ok: true,
            message: `${totalAdded} item stok ditambahkan ke ${results.filter(r => r.ok).length} produk`,
            totalAdded,
            results
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

// ---- GET /stock/export.csv ----
// Snapshot inventory semua produk.
const exportStock = (req, res) => {
    try {
        const products = db.getProducts();
        const categories = db.getCategories();
        const catMap = Object.fromEntries(categories.map(c => [c.id, c]));
        const counts = stockCountsByProduct();

        const headers = ['Produk', 'Kategori', 'Tipe Stok', 'Mode', 'Tersedia', 'Reserved', 'Terjual (total)', 'Terjual (30h)', 'Total Baris', 'Harga', 'Nilai Inventory', 'Status'];
        const rows = products.map(p => {
            const c = counts[p.id] || { available: 0, reserved: 0, sold: 0, total: 0 };
            const effPrice = db.getEffectivePrice(p) || 0;
            const isUnlimited = p.stock_mode === 'unlimited';
            const available = isUnlimited ? '∞' : c.available;
            const invValue = isUnlimited ? 0 : c.available * effPrice;
            const status = isUnlimited ? 'unlimited'
                : c.available === 0 ? 'habis'
                : c.available < LOW_STOCK_THRESHOLD ? 'menipis' : 'ok';
            return [
                p.name_id, catMap[p.category_id]?.name_id || '-', p.stock_type, p.stock_mode,
                available, c.reserved, c.sold, db.getSoldQtyByProduct(p.id, 30), c.total,
                effPrice, invValue, status
            ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',');
        });
        const csv = [headers.join(','), ...rows].join('\n');
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="stock_${getWIBToday()}.csv"`);
        res.send('\ufeff' + csv); // BOM untuk Excel
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

const registerStockRoutes = (api) => {
    api.get('/stock/overview', getOverview);
    api.get('/stock/export.csv', exportStock); // sebelum :id
    api.get('/stock/:id/reserved', getReservedDetail);
    api.post('/stock/bulk-restock', bulkRestock);
};

module.exports = { registerStockRoutes };
