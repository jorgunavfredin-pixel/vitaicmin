const db = require('../../models/db');

// Helper to format product data for admin web
function formatProductForAdmin(p) {
    const cat = p.category_id ? db.getCategories().find(c => c.id === p.category_id) : null;
    const availableStock = db.getAvailableStockCount(p.id);
    // "Terjual" = jumlah ITEM terjual (SUM quantity order sukses), bukan jumlah baris stock sold.
    const soldStock = db.getSoldQtyByProduct(p.id);
    const isFlash = db.isFlashSaleActive(p);
    const effectivePrice = db.getEffectivePrice(p);

    let parsedDiscounts = [];
    if (p.qty_discounts) {
        try { parsedDiscounts = JSON.parse(p.qty_discounts); } catch (e) {}
    }

    return {
        ...p,
        active: p.active === true || p.active === 1,
        category_name_id: cat ? cat.name_id : 'Tanpa Kategori',
        category_name_en: cat ? cat.name_en : 'No Category',
        available_stock: availableStock,
        sold_stock: soldStock,
        is_flash_active: isFlash,
        effective_price: effectivePrice,
        parsed_qty_discounts: parsedDiscounts
    };
}

// ---- CATEGORIES ----
const listCategories = (req, res) => {
    const cats = db.getCategories();
    const prods = db.getProducts();
    const result = cats.map(c => {
        const catProds = prods.filter(p => p.category_id === c.id);
        return {
            ...c,
            product_count: catProds.length,
            active_product_count: catProds.filter(p => p.active === true || p.active === 1).length
        };
    });
    res.json(result);
};

const createCategory = (req, res) => {
    const { name_id, name_en } = req.body;
    if (!name_id) return res.status(400).json({ error: 'Nama kategori (ID) wajib diisi' });

    const newCat = db.addCategory({ name_id: name_id.trim(), name_en: (name_en || name_id).trim() });
    db.dbEvents?.emit('product_change', { type: 'category_created', category: newCat });
    res.json({ ok: true, message: 'Kategori berhasil dibuat', category: newCat });
};

const updateCategory = (req, res) => {
    const { id } = req.params;
    const { name_id, name_en } = req.body;
    if (!name_id) return res.status(400).json({ error: 'Nama kategori (ID) wajib diisi' });

    const updated = db.updateCategory(id, { name_id: name_id.trim(), name_en: (name_en || name_id).trim() });
    if (!updated) return res.status(404).json({ error: 'Kategori tidak ditemukan' });

    db.dbEvents?.emit('product_change', { type: 'category_updated', category: updated });
    res.json({ ok: true, message: 'Kategori berhasil diperbarui', category: updated });
};

const deleteCategory = (req, res) => {
    const { id } = req.params;
    const cats = db.getCategories();
    const cat = cats.find(c => c.id === id);
    if (!cat) return res.status(404).json({ error: 'Kategori tidak ditemukan' });

    db.deleteCategory(id);
    db.dbEvents?.emit('product_change', { type: 'category_deleted', categoryId: id });
    res.json({ ok: true, message: 'Kategori dan produk terkait berhasil dihapus' });
};

// ---- PRODUCTS ----
const listProducts = (req, res) => {
    const { category_id, status, q } = req.query;
    let products = db.getProducts().map(formatProductForAdmin);

    // Filter category
    if (category_id && category_id !== 'all') {
        products = products.filter(p => p.category_id === category_id);
    }

    // Filter status
    if (status && status !== 'all') {
        if (status === 'active') products = products.filter(p => p.active);
        else if (status === 'paused') products = products.filter(p => !p.active);
        else if (status === 'flash') products = products.filter(p => p.is_flash_active);
        else if (status === 'outofstock') products = products.filter(p => p.stock_mode === 'limited' && p.available_stock === 0);
    }

    // Search query
    if (q) {
        const query = q.toLowerCase().trim();
        products = products.filter(p =>
            p.id.toLowerCase().includes(query) ||
            (p.name_id && p.name_id.toLowerCase().includes(query)) ||
            (p.name_en && p.name_en.toLowerCase().includes(query)) ||
            (p.description_id && p.description_id.toLowerCase().includes(query))
        );
    }

    const categories = db.getCategories();

    res.json({
        total: products.length,
        products,
        counts: {
            all: db.getProducts().length,
            active: db.getProducts().filter(p => p.active === true || p.active === 1).length,
            paused: db.getProducts().filter(p => p.active === false || p.active === 0).length,
            flash: db.getProducts().filter(p => db.isFlashSaleActive(p)).length,
            categories: categories.length
        }
    });
};

const getProduct = (req, res) => {
    const p = db.getProductById(req.params.id);
    if (!p) return res.status(404).json({ error: 'Produk tidak ditemukan' });
    res.json(formatProductForAdmin(p));
};

const createProduct = (req, res) => {
    const {
        category_id, name_id, name_en, description_id, description_en,
        price_idr, warranty_id, warranty_en, terms_id, terms_en,
        stock_type, stock_mode, terms_format, active
    } = req.body;

    if (!name_id) return res.status(400).json({ error: 'Nama produk (ID) wajib diisi' });
    if (price_idr == null || isNaN(price_idr) || price_idr < 0) {
        return res.status(400).json({ error: 'Harga produk harus berupa angka valid >= 0' });
    }

    const newProd = db.addProduct({
        category_id: category_id || null,
        name_id: name_id.trim(),
        name_en: (name_en || name_id).trim(),
        description_id: (description_id || '').trim(),
        description_en: (description_en || description_id || '').trim(),
        price_idr: parseInt(price_idr) || 0,
        warranty_id: (warranty_id || '').trim(),
        warranty_en: (warranty_en || warranty_id || '').trim(),
        terms_id: (terms_id || '').trim(),
        terms_en: (terms_en || terms_id || '').trim(),
        stock_type: stock_type || 'email_pass',
        stock_mode: 'limited', // hanya mode limited yang didukung (unlimited dihapus)
        terms_format: terms_format || 'markdown',
        active: active !== false
    });

    db.dbEvents?.emit('product_change', { type: 'product_created', product: newProd });
    res.json({ ok: true, message: 'Produk berhasil ditambahkan', product: formatProductForAdmin(newProd) });
};

const updateProduct = (req, res) => {
    const { id } = req.params;
    const existing = db.getProductById(id);
    if (!existing) return res.status(404).json({ error: 'Produk tidak ditemukan' });

    const updates = { ...req.body };
    if (updates.price_idr != null) updates.price_idr = parseInt(updates.price_idr) || 0;
    if (updates.active != null) updates.active = updates.active === true || updates.active === 1 || updates.active === 'true';
    updates.stock_mode = 'limited'; // hanya mode limited yang didukung (unlimited dihapus)

    const updated = db.updateProduct(id, updates);
    db.dbEvents?.emit('product_change', { type: 'product_updated', product: updated });
    res.json({ ok: true, message: 'Produk berhasil diperbarui', product: formatProductForAdmin(updated) });
};

const toggleActiveProduct = (req, res) => {
    const { id } = req.params;
    const existing = db.getProductById(id);
    if (!existing) return res.status(404).json({ error: 'Produk tidak ditemukan' });

    const newActiveState = !(existing.active === true || existing.active === 1);
    const updated = db.updateProduct(id, { active: newActiveState });
    db.dbEvents?.emit('product_change', { type: 'product_updated', product: updated });
    res.json({
        ok: true,
        message: `Produk ${newActiveState ? 'diaktifkan' : 'dinonaktifkan'}`,
        active: newActiveState
    });
};

const setFlashSale = (req, res) => {
    const { id } = req.params;
    const { flash_price, flash_start, flash_end } = req.body;

    const prod = db.getProductById(id);
    if (!prod) return res.status(404).json({ error: 'Produk tidak ditemukan' });

    if (!flash_price || isNaN(flash_price) || flash_price <= 0) {
        return res.status(400).json({ error: 'Harga flash sale harus berupa angka positif' });
    }
    if (!flash_start || !flash_end) {
        return res.status(400).json({ error: 'Waktu mulai dan selesai flash sale wajib diisi' });
    }

    const updated = db.setFlashSale(id, parseInt(flash_price), new Date(flash_start).toISOString(), new Date(flash_end).toISOString());
    db.dbEvents?.emit('product_change', { type: 'flash_sale_updated', product: updated });
    res.json({ ok: true, message: 'Flash sale berhasil dipasang', product: formatProductForAdmin(updated) });
};

const clearFlashSale = (req, res) => {
    const { id } = req.params;
    const prod = db.getProductById(id);
    if (!prod) return res.status(404).json({ error: 'Produk tidak ditemukan' });

    const updated = db.clearFlashSale(id);
    db.dbEvents?.emit('product_change', { type: 'flash_sale_cleared', product: updated });
    res.json({ ok: true, message: 'Flash sale berhasil dihapus', product: formatProductForAdmin(updated) });
};

const setBulkDiscount = (req, res) => {
    const { id } = req.params;
    const { tiers } = req.body; // Array of { min_qty, percent }

    const prod = db.getProductById(id);
    if (!prod) return res.status(404).json({ error: 'Produk tidak ditemukan' });

    let qtyDiscountsStr = '';
    if (Array.isArray(tiers) && tiers.length > 0) {
        const validTiers = tiers
            .map(t => ({ min_qty: parseInt(t.min_qty), percent: parseInt(t.percent) }))
            .filter(t => !isNaN(t.min_qty) && t.min_qty >= 2 && !isNaN(t.percent) && t.percent > 0 && t.percent < 100)
            .sort((a, b) => a.min_qty - b.min_qty);

        qtyDiscountsStr = validTiers.length > 0 ? JSON.stringify(validTiers) : '';
    }

    const updated = db.updateProduct(id, { qty_discounts: qtyDiscountsStr });
    db.dbEvents?.emit('product_change', { type: 'bulk_discount_updated', product: updated });
    res.json({ ok: true, message: 'Diskon grosir berhasil diperbarui', product: formatProductForAdmin(updated) });
};

const deleteProduct = (req, res) => {
    const { id } = req.params;
    const prod = db.getProductById(id);
    if (!prod) return res.status(404).json({ error: 'Produk tidak ditemukan' });

    db.deleteProduct(id);
    db.dbEvents?.emit('product_change', { type: 'product_deleted', productId: id });
    res.json({ ok: true, message: 'Produk dan stok terkait berhasil dihapus' });
};

// ---- PRODUCT STATS (overview cards) ----
const getProductStats = (req, res) => {
    try {
        const products = db.getProducts();
        const categories = db.getCategories();

        let totalStock = 0, totalSold = 0, lowStockCount = 0, outOfStockCount = 0, unlimitedCount = 0;
        let inventoryValue = 0; // nilai stok tersedia (harga efektif * jumlah)

        for (const p of products) {
            const effPrice = db.getEffectivePrice(p);
            if (p.stock_mode === 'unlimited') {
                unlimitedCount++;
            } else {
                const avail = db.getAvailableStockCount(p.id);
                totalStock += avail;
                inventoryValue += avail * (effPrice || 0);
                if (avail === 0) outOfStockCount++;
                else if (avail < 3) lowStockCount++;
            }
            totalSold += db.getSoldQtyByProduct(p.id);
        }

        res.json({
            totalProducts: products.length,
            activeProducts: products.filter(p => p.active === true || p.active === 1).length,
            pausedProducts: products.filter(p => p.active === false || p.active === 0).length,
            flashProducts: products.filter(p => db.isFlashSaleActive(p)).length,
            totalCategories: categories.length,
            totalStock,
            totalSold,
            lowStockCount,
            outOfStockCount,
            unlimitedCount,
            inventoryValue
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

// ---- STOCK MANAGEMENT ----

// GET /products/:id/stock?filter=available|sold|all&q=...
const listStock = (req, res) => {
    const { id } = req.params;
    const prod = db.getProductById(id);
    if (!prod) return res.status(404).json({ error: 'Produk tidak ditemukan' });

    const filter = (req.query.filter || 'available').toLowerCase();
    const q = (req.query.q || '').trim().toLowerCase();

    let items = db.getStock().filter(s => s.product_id === id);

    // Compute counts before filtering
    const counts = {
        all: items.length,
        available: items.filter(s => !s.sold && !s.reserved_by).length,
        reserved: items.filter(s => !s.sold && s.reserved_by).length,
        sold: items.filter(s => s.sold).length
    };

    if (filter === 'available') items = items.filter(s => !s.sold && !s.reserved_by);
    else if (filter === 'reserved') items = items.filter(s => !s.sold && s.reserved_by);
    else if (filter === 'sold') items = items.filter(s => s.sold);

    if (q) items = items.filter(s => String(s.data).toLowerCase().includes(q));

    // newest first
    items.sort((a, b) => (b.added_at || '').localeCompare(a.added_at || ''));

    res.json({
        product: { id: prod.id, name_id: prod.name_id, stock_type: prod.stock_type, stock_mode: prod.stock_mode },
        counts,
        items: items.map(s => ({
            id: s.id,
            data: s.data,
            sold: s.sold,
            sold_to: s.sold_to,
            sold_at: s.sold_at,
            order_id: s.order_id,
            reserved_by: s.reserved_by || null,
            added_at: s.added_at
        }))
    });
};

// POST /products/:id/stock  { lines: "a\nb\nc" | [ "a","b" ] }
const addStockRoute = (req, res) => {
    const { id } = req.params;
    const prod = db.getProductById(id);
    if (!prod) return res.status(404).json({ error: 'Produk tidak ditemukan' });

    let raw = req.body.lines;
    let lines = [];
    if (Array.isArray(raw)) lines = raw;
    else if (typeof raw === 'string') lines = raw.split('\n');
    lines = lines.map(l => String(l).trim()).filter(Boolean);

    if (lines.length === 0) return res.status(400).json({ error: 'Tidak ada data stok yang valid' });

    const added = db.addBulkStock(id, lines);
    const total = db.getAvailableStockCount(id);
    db.dbEvents?.emit('product_change', { type: 'stock_added', productId: id, added: added.length, total });
    res.json({ ok: true, message: `${added.length} item stok ditambahkan`, added: added.length, total });
};

// DELETE /products/:id/stock/:stockId
const deleteStockRoute = (req, res) => {
    const { id, stockId } = req.params;
    const prod = db.getProductById(id);
    if (!prod) return res.status(404).json({ error: 'Produk tidak ditemukan' });

    const item = db.getStock().find(s => s.id === stockId && s.product_id === id);
    if (!item) return res.status(404).json({ error: 'Item stok tidak ditemukan' });
    if (item.sold) return res.status(400).json({ error: 'Tidak bisa hapus stok yang sudah terjual' });

    db.deleteStock(stockId);
    const total = db.getAvailableStockCount(id);
    db.dbEvents?.emit('product_change', { type: 'stock_deleted', productId: id, total });
    res.json({ ok: true, message: 'Item stok dihapus', total });
};

// POST /products/:id/stock/remove-last  { count }
const removeLastStockRoute = (req, res) => {
    const { id } = req.params;
    const prod = db.getProductById(id);
    if (!prod) return res.status(404).json({ error: 'Produk tidak ditemukan' });

    const count = Math.max(1, parseInt(req.body.count) || 0);
    if (!count) return res.status(400).json({ error: 'Jumlah tidak valid' });

    const removed = db.removeLastStock(id, count);
    const total = db.getAvailableStockCount(id);
    db.dbEvents?.emit('product_change', { type: 'stock_removed', productId: id, removed, total });
    res.json({ ok: true, message: `${removed} item stok terakhir dihapus`, removed, total });
};

// POST /products/:id/stock/remove-by-data  { lines }
const removeStockByDataRoute = (req, res) => {
    const { id } = req.params;
    const prod = db.getProductById(id);
    if (!prod) return res.status(404).json({ error: 'Produk tidak ditemukan' });

    let raw = req.body.lines;
    let lines = [];
    if (Array.isArray(raw)) lines = raw;
    else if (typeof raw === 'string') lines = raw.split('\n');
    lines = lines.map(l => String(l).trim()).filter(Boolean);
    if (lines.length === 0) return res.status(400).json({ error: 'Tidak ada data untuk dihapus' });

    const stock = db.getStock().filter(s => s.product_id === id && !s.sold);
    let deleted = 0;
    const notFound = [];
    for (const line of lines) {
        const match = stock.find(s => s.data === line);
        if (match) {
            db.deleteStock(match.id);
            deleted++;
            stock.splice(stock.indexOf(match), 1);
        } else {
            notFound.push(line);
        }
    }
    const total = db.getAvailableStockCount(id);
    db.dbEvents?.emit('product_change', { type: 'stock_removed', productId: id, removed: deleted, total });
    res.json({
        ok: true,
        message: `${deleted} dari ${lines.length} item dihapus`,
        deleted,
        notFound,
        total
    });
};

// DELETE /products/:id/stock  (clear all unsold)
const clearStockRoute = (req, res) => {
    const { id } = req.params;
    const prod = db.getProductById(id);
    if (!prod) return res.status(404).json({ error: 'Produk tidak ditemukan' });

    const before = db.getAvailableStockCount(id);
    db.clearProductStock(id);
    db.dbEvents?.emit('product_change', { type: 'stock_cleared', productId: id, total: 0 });
    res.json({ ok: true, message: `Semua stok tersedia dihapus (${before} item)`, total: 0 });
};

const registerProductRoutes = (api) => {
    // Categories
    api.get('/categories', listCategories);
    api.post('/categories', createCategory);
    api.put('/categories/:id', updateCategory);
    api.delete('/categories/:id', deleteCategory);

    // Product stats (overview cards)
    api.get('/products-stats', getProductStats);

    // Products
    api.get('/products', listProducts);
    api.get('/products/:id', getProduct);
    api.post('/products', createProduct);
    api.put('/products/:id', updateProduct);
    api.patch('/products/:id/toggle-active', toggleActiveProduct);
    api.post('/products/:id/flash-sale', setFlashSale);
    api.delete('/products/:id/flash-sale', clearFlashSale);
    api.post('/products/:id/bulk-discount', setBulkDiscount);

    // Stock management (order matters: specific routes before :stockId)
    api.get('/products/:id/stock', listStock);
    api.post('/products/:id/stock', addStockRoute);
    api.post('/products/:id/stock/remove-last', removeLastStockRoute);
    api.post('/products/:id/stock/remove-by-data', removeStockByDataRoute);
    api.delete('/products/:id/stock/:stockId', deleteStockRoute);
    api.delete('/products/:id/stock', clearStockRoute);

    api.delete('/products/:id', deleteProduct);
};

module.exports = { registerProductRoutes };
