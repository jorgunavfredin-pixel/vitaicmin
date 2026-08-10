/**
 * Flash Sale routes — kelola produk flash sale (harga diskon + rentang waktu).
 * Flash sale disimpan di kolom produk: flash_price, flash_start, flash_end, flash_max_transactions.
 * Reuse helper db existing (setFlashSale/clearFlashSale/getActiveFlashSales). TIDAK ubah logic bot.
 */
const db = require('../../models/db');

const shape = (p) => ({
  product_id: p.id,
  name: p.name_id || p.id,
  normal_price: p.price_idr ?? null,
  flash_price: p.flash_price ?? null,
  flash_start: p.flash_start || null,
  flash_end: p.flash_end || null,
  max_transactions: p.flash_max_transactions ?? null,
  slots: p.flash_slots || null,
});

const listFlashSales = (req, res) => {
  try {
    const products = db.getProducts();
    const now = new Date().toISOString();

    const active = [];
    const scheduled = [];
    const expired = [];
    for (const p of products) {
      if (p.flash_price == null || !p.flash_start || !p.flash_end) continue;
      const s = shape(p);
      if (p.flash_end < now) expired.push(s);
      else if (p.flash_start > now) scheduled.push(s);
      else active.push(s);
    }

    res.json({
      active, scheduled, expired,
      products: products.map((p) => ({ id: p.id, name: p.name_id, price_idr: p.price_idr })),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

const upsertFlashSale = (req, res) => {
  try {
    const { product_id, flash_price, flash_start, flash_end, max_transactions } = req.body || {};
    if (!product_id) return res.status(400).json({ error: 'Produk wajib dipilih' });
    if (!(flash_price > 0)) return res.status(400).json({ error: 'Harga flash sale harus > 0' });
    if (!flash_start || !flash_end) return res.status(400).json({ error: 'Waktu mulai & selesai wajib diisi' });
    if (new Date(flash_end) <= new Date(flash_start)) return res.status(400).json({ error: 'Waktu selesai harus setelah waktu mulai' });

    const prod = db.getProductById(product_id);
    if (!prod) return res.status(404).json({ error: 'Produk tidak ditemukan' });
    if (prod.price_idr != null && flash_price >= prod.price_idr) {
      return res.status(400).json({ error: 'Harga flash harus lebih murah dari harga normal' });
    }

    db.setFlashSale(product_id, Math.round(flash_price), flash_start, flash_end, max_transactions || null);
    res.json({ ok: true, message: 'Flash sale disimpan' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

const removeFlashSale = (req, res) => {
  try {
    const productId = req.params.productId;
    if (!db.getProductById(productId)) return res.status(404).json({ error: 'Produk tidak ditemukan' });
    db.clearFlashSale(productId);
    res.json({ ok: true, message: 'Flash sale dihapus' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

const registerFlashSaleRoutes = (router) => {
  router.get('/flash-sales', listFlashSales);
  router.post('/flash-sales', upsertFlashSale);
  router.delete('/flash-sales/:productId', removeFlashSale);
};

module.exports = { registerFlashSaleRoutes };
