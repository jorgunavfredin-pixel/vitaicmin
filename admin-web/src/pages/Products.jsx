import { useEffect, useState, useCallback } from 'react';
import {
  fetchProducts, fetchCategories, createCategory, updateCategory, deleteCategory,
  createProduct, updateProduct, toggleActiveProduct, setFlashSale, clearFlashSale,
  setBulkDiscount, deleteProduct
} from '../api.js';

const formatIDR = (n) => 'Rp ' + new Intl.NumberFormat('id-ID').format(Math.round(n || 0));

const STOCK_TYPES = [
  { id: 'email_pass', label: '👤 Email|Pass' },
  { id: 'email_pass_key', label: '🔑 Email|Pass|2FA' },
  { id: 'code', label: '🎫 Code / Pin' },
  { id: 'vcc', label: '💳 Card|Exp|CVV' },
  { id: 'custom', label: '📦 Custom Text' }
];

export default function Products() {
  const [activeTab, setActiveTab] = useState('products'); // 'products' | 'categories'
  const [categories, setCategories] = useState([]);
  const [productsData, setProductsData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState(null);

  // Filters
  const [catFilter, setCatFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Modals & Drawers
  const [editingProduct, setEditingProduct] = useState(null); // null | 'new' | product object
  const [flashModalProd, setFlashModalProd] = useState(null); // null | product object
  const [bulkModalProd, setBulkModalProd] = useState(null); // null | product object
  const [deleteModalProd, setDeleteModalProd] = useState(null); // null | product object

  const [categoryModal, setCategoryModal] = useState(null); // null | { mode: 'add'|'edit', cat?: obj }
  const [deleteCatModal, setDeleteCatModal] = useState(null); // null | category object

  const showToast = (msg, kind = 'ok') => {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 3200);
  };

  const loadData = useCallback(() => {
    setLoading(true);
    Promise.all([
      fetchCategories(),
      fetchProducts({ category_id: catFilter, status: statusFilter, q: searchQuery })
    ])
      .then(([cats, prods]) => {
        setCategories(cats);
        setProductsData(prods);
        setError('');
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [catFilter, statusFilter, searchQuery]);

  useEffect(() => {
    const t = setTimeout(loadData, searchQuery ? 300 : 0);
    return () => clearTimeout(t);
  }, [loadData, searchQuery]);

  useEffect(() => {
    const handleUpdate = () => loadData();
    window.addEventListener('product_updated', handleUpdate);
    return () => window.removeEventListener('product_updated', handleUpdate);
  }, [loadData]);

  // Quick action: Toggle Active Status
  const handleToggleActive = async (p) => {
    try {
      const r = await toggleActiveProduct(p.id);
      showToast(r.message);
      loadData();
    } catch (e) {
      showToast(e.message, 'err');
    }
  };

  const counts = productsData?.counts || {};

  return (
    <div className="products-page">
      {/* Header */}
      <div className="page-head">
        <div>
          <h2 className="page-title">Manajemen Produk & Kategori</h2>
          <p className="page-sub">Kelola katalog produk, harga, promo flash sale, dan stok</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          {activeTab === 'products' ? (
            <button className="btn-primary" style={{ width: 'auto', padding: '10px 18px' }} onClick={() => setEditingProduct('new')}>
              ➕ Tambah Produk Baru
            </button>
          ) : (
            <button className="btn-primary" style={{ width: 'auto', padding: '10px 18px' }} onClick={() => setCategoryModal({ mode: 'add' })}>
              ➕ Tambah Kategori
            </button>
          )}
        </div>
      </div>

      {/* Main Tabs */}
      <div className="tab-bar">
        <button
          className={`tab-item ${activeTab === 'products' ? 'active' : ''}`}
          onClick={() => setActiveTab('products')}
        >
          📦 Produk ({counts.all || 0})
        </button>
        <button
          className={`tab-item ${activeTab === 'categories' ? 'active' : ''}`}
          onClick={() => setActiveTab('categories')}
        >
          📂 Kategori ({categories.length})
        </button>
      </div>

      {activeTab === 'products' && (
        <>
          {/* Filters & Search Toolbar */}
          <div className="toolbar">
            <div className="chips">
              <button className={`chip ${statusFilter === 'all' ? 'active' : ''}`} onClick={() => setStatusFilter('all')}>
                Semua ({counts.all || 0})
              </button>
              <button className={`chip ${statusFilter === 'active' ? 'active' : ''}`} onClick={() => setStatusFilter('active')}>
                Aktif ({counts.active || 0})
              </button>
              <button className={`chip ${statusFilter === 'paused' ? 'active' : ''}`} onClick={() => setStatusFilter('paused')}>
                Nonaktif ({counts.paused || 0})
              </button>
              <button className={`chip ${statusFilter === 'flash' ? 'active' : ''}`} onClick={() => setStatusFilter('flash')}>
                ⚡ Flash Sale ({counts.flash || 0})
              </button>
              <button className={`chip ${statusFilter === 'outofstock' ? 'active' : ''}`} onClick={() => setStatusFilter('outofstock')}>
                ⚠️ Stok Habis
              </button>
            </div>

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', width: '100%', marginTop: 10 }}>
              <div className="search" style={{ flex: 1, minWidth: 240 }}>
                <span className="search-icon">🔎</span>
                <input
                  placeholder="Cari nama produk ID/EN, ID..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>

              <select
                className="qty-field"
                style={{ width: 'auto', minWidth: 180, padding: '8px 12px', fontSize: 13.5 }}
                value={catFilter}
                onChange={(e) => setCatFilter(e.target.value)}
              >
                <option value="all">📁 Semua Kategori</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    📁 {c.name_id} ({c.product_count})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Product Grid / Table */}
          <div className="panel no-pad">
            {error ? (
              <div className="empty error-panel">⚠️ {error}</div>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Produk (ID / EN)</th>
                      <th>Kategori</th>
                      <th>Harga</th>
                      <th>Stok Tersedia</th>
                      <th>Terjual</th>
                      <th>Status</th>
                      <th style={{ textAlign: 'right' }}>Aksi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading && !productsData ? (
                      <tr><td colSpan={7} className="empty">Memuat produk…</td></tr>
                    ) : productsData && productsData.products.length === 0 ? (
                      <tr><td colSpan={7} className="empty">Tidak ada produk ditemukan</td></tr>
                    ) : (
                      productsData?.products.map((p) => (
                        <tr key={p.id}>
                          <td>
                            <div style={{ fontWeight: 600, color: '#fff' }}>{p.name_id}</div>
                            <div style={{ fontSize: 12, color: '#8a93a6' }}>{p.name_en || '-'} • <code style={{ fontSize: 11 }}>{p.id}</code></div>
                          </td>
                          <td>
                            <span className="badge st-muted" style={{ background: 'rgba(255,255,255,0.06)' }}>
                              📁 {p.category_name_id}
                            </span>
                          </td>
                          <td>
                            {p.is_flash_active ? (
                              <div>
                                <span style={{ textDecoration: 'line-through', color: '#8a93a6', fontSize: 12, marginRight: 6 }}>
                                  {formatIDR(p.price_idr)}
                                </span>
                                <b style={{ color: '#ff6b6b' }}>{formatIDR(p.flash_price)}</b>
                                <span className="badge-flash">⚡ Flash Sale</span>
                              </div>
                            ) : (
                              <b>{formatIDR(p.price_idr)}</b>
                            )}
                            {p.parsed_qty_discounts?.length > 0 && (
                              <div style={{ fontSize: 11, color: '#5b8cff', marginTop: 2 }}>
                                🏷️ {p.parsed_qty_discounts.length} Tier Diskon Bulk
                              </div>
                            )}
                          </td>
                          <td>
                            {p.stock_mode === 'unlimited' ? (
                              <span className="badge st-paid">♾️ Unlimited</span>
                            ) : p.available_stock > 0 ? (
                              <b style={{ color: '#37d399' }}>{p.available_stock} item</b>
                            ) : (
                              <span className="badge st-cancelled">Habis (0)</span>
                            )}
                            <div style={{ fontSize: 11, color: '#8a93a6' }}>Tipe: {p.stock_type}</div>
                          </td>
                          <td>
                            <b>{p.sold_stock || 0}</b> pcs
                          </td>
                          <td>
                            <button
                              className={`badge ${p.active ? 'st-delivered' : 'st-expired'}`}
                              style={{ border: 'none', cursor: 'pointer' }}
                              onClick={() => handleToggleActive(p)}
                              title="Klik untuk mengubah status aktif/pause"
                            >
                              {p.active ? '✅ Aktif' : '⏸️ Paused'}
                            </button>
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                              <button
                                className="btn-ghost"
                                style={{ padding: '5px 10px', fontSize: 12 }}
                                onClick={() => setEditingProduct(p)}
                                title="Edit Detail Produk"
                              >
                                ✏️ Edit
                              </button>
                              <button
                                className="btn-ghost"
                                style={{ padding: '5px 10px', fontSize: 12, color: p.is_flash_active ? '#ff6b6b' : undefined }}
                                onClick={() => setFlashModalProd(p)}
                                title="Pengaturan Flash Sale"
                              >
                                ⚡ Flash
                              </button>
                              <button
                                className="btn-ghost"
                                style={{ padding: '5px 10px', fontSize: 12 }}
                                onClick={() => setBulkModalProd(p)}
                                title="Diskon Grosir"
                              >
                                🏷️ Bulk
                              </button>
                              <button
                                className="btn-ghost"
                                style={{ padding: '5px 10px', fontSize: 12, color: '#ff6b6b' }}
                                onClick={() => setDeleteModalProd(p)}
                                title="Hapus Produk"
                              >
                                🗑️
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {activeTab === 'categories' && (
        <div className="panel no-pad">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>ID Kategori</th>
                  <th>Nama (Bahasa Indonesia)</th>
                  <th>Nama (Bahasa Inggris)</th>
                  <th>Jumlah Produk</th>
                  <th>Produk Aktif</th>
                  <th style={{ textAlign: 'right' }}>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {categories.length === 0 ? (
                  <tr><td colSpan={6} className="empty">Belum ada kategori. Klik "Tambah Kategori" untuk membuat.</td></tr>
                ) : (
                  categories.map((c) => (
                    <tr key={c.id}>
                      <td className="mono">{c.id}</td>
                      <td><b>{c.name_id}</b></td>
                      <td>{c.name_en || '-'}</td>
                      <td><b>{c.product_count}</b> produk</td>
                      <td><span className="badge st-delivered">{c.active_product_count} aktif</span></td>
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                          <button
                            className="btn-ghost"
                            style={{ padding: '5px 10px', fontSize: 12 }}
                            onClick={() => setCategoryModal({ mode: 'edit', cat: c })}
                          >
                            ✏️ Edit
                          </button>
                          <button
                            className="btn-ghost"
                            style={{ padding: '5px 10px', fontSize: 12, color: '#ff6b6b' }}
                            onClick={() => setDeleteCatModal(c)}
                          >
                            🗑️ Hapus
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* MODAL: Product Form (Create / Edit) */}
      {editingProduct && (
        <ProductFormModal
          prod={editingProduct === 'new' ? null : editingProduct}
          categories={categories}
          onClose={() => setEditingProduct(null)}
          onSaved={(msg) => {
            showToast(msg);
            setEditingProduct(null);
            loadData();
          }}
          toast={showToast}
        />
      )}

      {/* MODAL: Flash Sale */}
      {flashModalProd && (
        <FlashSaleModal
          prod={flashModalProd}
          onClose={() => setFlashModalProd(null)}
          onSaved={(msg) => {
            showToast(msg);
            setFlashModalProd(null);
            loadData();
          }}
        />
      )}

      {/* MODAL: Bulk Discount */}
      {bulkModalProd && (
        <BulkDiscountModal
          prod={bulkModalProd}
          onClose={() => setBulkModalProd(null)}
          onSaved={(msg) => {
            showToast(msg);
            setBulkModalProd(null);
            loadData();
          }}
        />
      )}

      {/* MODAL: Delete Product */}
      {deleteModalProd && (
        <ConfirmDeleteModal
          title={`Hapus Produk ${deleteModalProd.name_id}?`}
          message="Produk dan entri stok yang belum terjual akan dihapus permanen."
          onClose={() => setDeleteModalProd(null)}
          onConfirm={async () => {
            try {
              const r = await deleteProduct(deleteModalProd.id);
              showToast(r.message);
              setDeleteModalProd(null);
              loadData();
            } catch (e) {
              showToast(e.message, 'err');
            }
          }}
        />
      )}

      {/* MODAL: Add/Edit Category */}
      {categoryModal && (
        <CategoryFormModal
          data={categoryModal.cat}
          onClose={() => setCategoryModal(null)}
          onSaved={(msg) => {
            showToast(msg);
            setCategoryModal(null);
            loadData();
          }}
        />
      )}

      {/* MODAL: Delete Category */}
      {deleteCatModal && (
        <ConfirmDeleteModal
          title={`Hapus Kategori ${deleteCatModal.name_id}?`}
          message={`Kategori ini memiliki ${deleteCatModal.product_count} produk. Semua produk di dalamnya juga akan ikut terhapus!`}
          onClose={() => setDeleteCatModal(null)}
          onConfirm={async () => {
            try {
              const r = await deleteCategory(deleteCatModal.id);
              showToast(r.message);
              setDeleteCatModal(null);
              loadData();
            } catch (e) {
              showToast(e.message, 'err');
            }
          }}
        />
      )}

      {toast && <div className={`toast ${toast.kind}`}>{toast.msg}</div>}
    </div>
  );
}

// ---- MODAL COMPONENTS ----

function ProductFormModal({ prod, categories, onClose, onSaved, toast }) {
  const isEdit = !!prod;
  const [formTab, setFormTab] = useState('general'); // 'general' | 'desc' | 'terms'
  const [busy, setBusy] = useState(false);

  const [formData, setFormData] = useState({
    category_id: prod?.category_id || (categories[0]?.id || ''),
    name_id: prod?.name_id || '',
    name_en: prod?.name_en || '',
    price_idr: prod?.price_idr || 0,
    stock_type: prod?.stock_type || 'email_pass',
    stock_mode: prod?.stock_mode || 'limited',
    active: prod ? prod.active : true,
    description_id: prod?.description_id || '',
    description_en: prod?.description_en || '',
    warranty_id: prod?.warranty_id || '',
    warranty_en: prod?.warranty_en || '',
    terms_id: prod?.terms_id || '',
    terms_en: prod?.terms_en || '',
    terms_format: prod?.terms_format || 'markdown'
  });

  const handleChange = (field, val) => {
    setFormData((prev) => ({ ...prev, [field]: val }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.name_id.trim()) return toast('Nama produk (ID) wajib diisi', 'err');
    setBusy(true);
    try {
      if (isEdit) {
        const r = await updateProduct(prod.id, formData);
        onSaved(r.message);
      } else {
        const r = await createProduct(formData);
        onSaved(r.message);
      }
    } catch (err) {
      toast(err.message, 'err');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ maxWidth: 640, textAlign: 'left' }} onMouseDown={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0 }}>{isEdit ? `✏️ Edit Produk: ${prod.name_id}` : '➕ Tambah Produk Baru'}</h3>
          <button className="x" onClick={onClose}>✕</button>
        </div>

        {/* Form Sub-Tabs */}
        <div className="tab-bar" style={{ marginBottom: 18 }}>
          <button className={`tab-item ${formTab === 'general' ? 'active' : ''}`} onClick={() => setFormTab('general')}>
            ⚙️ Informasi Utama
          </button>
          <button className={`tab-item ${formTab === 'desc' ? 'active' : ''}`} onClick={() => setFormTab('desc')}>
            📌 Deskripsi & Garansi
          </button>
          <button className={`tab-item ${formTab === 'terms' ? 'active' : ''}`} onClick={() => setFormTab('terms')}>
            📜 Syarat & Ketentuan
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          {formTab === 'general' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <div style={{ gridColumn: 'span 2' }}>
                <label className="field-label">Kategori Produk</label>
                <select
                  className="qty-field"
                  value={formData.category_id}
                  onChange={(e) => handleChange('category_id', e.target.value)}
                >
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>📁 {c.name_id}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="field-label">Nama Produk (Indonesia) *</label>
                <input
                  type="text"
                  className="qty-field"
                  required
                  placeholder="Contoh: NETFLIX PREMIUM 1 BULAN"
                  value={formData.name_id}
                  onChange={(e) => handleChange('name_id', e.target.value)}
                />
              </div>

              <div>
                <label className="field-label">Nama Produk (Inggris)</label>
                <input
                  type="text"
                  className="qty-field"
                  placeholder="Contoh: NETFLIX PREMIUM 1 MONTH"
                  value={formData.name_en}
                  onChange={(e) => handleChange('name_en', e.target.value)}
                />
              </div>

              <div>
                <label className="field-label">Harga Normal (IDR) *</label>
                <input
                  type="number"
                  min="0"
                  className="qty-field"
                  required
                  value={formData.price_idr}
                  onChange={(e) => handleChange('price_idr', e.target.value)}
                />
              </div>

              <div>
                <label className="field-label">Format Stok (Stock Type)</label>
                <select
                  className="qty-field"
                  value={formData.stock_type}
                  onChange={(e) => handleChange('stock_type', e.target.value)}
                >
                  {STOCK_TYPES.map((st) => (
                    <option key={st.id} value={st.id}>{st.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="field-label">Mode Stok</label>
                <select
                  className="qty-field"
                  value={formData.stock_mode}
                  onChange={(e) => handleChange('stock_mode', e.target.value)}
                >
                  <option value="limited">📦 Limited (Butuh entri stok)</option>
                  <option value="unlimited">♾️ Unlimited (Stok tak terbatas)</option>
                </select>
              </div>

              <div>
                <label className="field-label">Status Produk</label>
                <select
                  className="qty-field"
                  value={formData.active ? 'true' : 'false'}
                  onChange={(e) => handleChange('active', e.target.value === 'true')}
                >
                  <option value="true">✅ Aktif (Bisa dibeli)</option>
                  <option value="false">⏸️ Paused (Nonaktif)</option>
                </select>
              </div>
            </div>
          )}

          {formTab === 'desc' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label className="field-label">Deskripsi Produk (Indonesia)</label>
                <textarea
                  rows={3}
                  className="qty-field"
                  style={{ resize: 'vertical' }}
                  placeholder="Penjelasan fitur & detail produk..."
                  value={formData.description_id}
                  onChange={(e) => handleChange('description_id', e.target.value)}
                />
              </div>

              <div>
                <label className="field-label">Deskripsi Produk (Inggris)</label>
                <textarea
                  rows={3}
                  className="qty-field"
                  style={{ resize: 'vertical' }}
                  placeholder="Product features & details explanation..."
                  value={formData.description_en}
                  onChange={(e) => handleChange('description_en', e.target.value)}
                />
              </div>

              <div>
                <label className="field-label">Garansi (Indonesia)</label>
                <input
                  type="text"
                  className="qty-field"
                  placeholder="Contoh: Garansi Full 30 Hari"
                  value={formData.warranty_id}
                  onChange={(e) => handleChange('warranty_id', e.target.value)}
                />
              </div>

              <div>
                <label className="field-label">Garansi (Inggris)</label>
                <input
                  type="text"
                  className="qty-field"
                  placeholder="Contoh: Full 30 Days Warranty"
                  value={formData.warranty_en}
                  onChange={(e) => handleChange('warranty_en', e.target.value)}
                />
              </div>
            </div>
          )}

          {formTab === 'terms' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label className="field-label">Format Teks S&K</label>
                <select
                  className="qty-field"
                  value={formData.terms_format}
                  onChange={(e) => handleChange('terms_format', e.target.value)}
                >
                  <option value="markdown">📝 Markdown / Plain Text</option>
                  <option value="html">🌐 HTML Format</option>
                </select>
              </div>

              <div>
                <label className="field-label">Syarat & Ketentuan (Indonesia)</label>
                <textarea
                  rows={4}
                  className="qty-field"
                  style={{ resize: 'vertical' }}
                  placeholder="Aturan garansi, klaim, & instruksi pemakaian..."
                  value={formData.terms_id}
                  onChange={(e) => handleChange('terms_id', e.target.value)}
                />
              </div>

              <div>
                <label className="field-label">Syarat & Ketentuan (Inggris)</label>
                <textarea
                  rows={4}
                  className="qty-field"
                  style={{ resize: 'vertical' }}
                  placeholder="Warranty rules, claim & usage instructions..."
                  value={formData.terms_en}
                  onChange={(e) => handleChange('terms_en', e.target.value)}
                />
              </div>
            </div>
          )}

          <div className="modal-actions" style={{ marginTop: 22 }}>
            <button type="button" className="btn-ghost" onClick={onClose}>Batal</button>
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy ? 'Memproses…' : isEdit ? 'Simpan Perubahan' : 'Tambah Produk'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function FlashSaleModal({ prod, onClose, onSaved }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const now = new Date();
  const defaultStart = prod.flash_start ? prod.flash_start.slice(0, 16) : now.toISOString().slice(0, 16);
  const defaultEnd = prod.flash_end ? prod.flash_end.slice(0, 16) : new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 16);

  const [price, setPrice] = useState(prod.flash_price || Math.round(prod.price_idr * 0.8));
  const [startDate, setStartDate] = useState(defaultStart);
  const [endDate, setEndDate] = useState(defaultEnd);

  const handleSet = async () => {
    setBusy(true);
    setErr('');
    try {
      const r = await setFlashSale(prod.id, {
        flash_price: price,
        flash_start: startDate,
        flash_end: endDate
      });
      onSaved(r.message);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const handleClear = async () => {
    setBusy(true);
    setErr('');
    try {
      const r = await clearFlashSale(prod.id);
      onSaved(r.message);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ maxWidth: 420, textAlign: 'left' }} onMouseDown={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h3 style={{ margin: 0 }}>⚡ Flash Sale: {prod.name_id}</h3>
          <button className="x" onClick={onClose}>✕</button>
        </div>

        <p style={{ fontSize: 13, color: '#8a93a6', margin: '0 0 14px' }}>
          Harga Normal: <b>{formatIDR(prod.price_idr)}</b>
        </p>

        {err && <div className="empty error-panel" style={{ marginBottom: 12 }}>⚠️ {err}</div>}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label className="field-label">Harga Diskon Flash Sale (IDR) *</label>
            <input
              type="number"
              className="qty-field"
              value={price}
              onChange={(e) => setPrice(parseInt(e.target.value) || 0)}
            />
          </div>

          <div>
            <label className="field-label">Waktu Mulai *</label>
            <input
              type="datetime-local"
              className="qty-field"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>

          <div>
            <label className="field-label">Waktu Selesai *</label>
            <input
              type="datetime-local"
              className="qty-field"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>
        </div>

        <div className="modal-actions" style={{ marginTop: 20 }}>
          {prod.is_flash_active && (
            <button type="button" className="btn-ghost" style={{ color: '#ff6b6b' }} onClick={handleClear} disabled={busy}>
              Matikan Promo
            </button>
          )}
          <button type="button" className="btn-primary" onClick={handleSet} disabled={busy}>
            {busy ? 'Memproses…' : 'Simpan Flash Sale'}
          </button>
        </div>
      </div>
    </div>
  );
}

function BulkDiscountModal({ prod, onClose, onSaved }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [tiers, setTiers] = useState(prod.parsed_qty_discounts || []);

  const addTier = () => {
    setTiers([...tiers, { min_qty: 2, percent: 10 }]);
  };

  const removeTier = (idx) => {
    setTiers(tiers.filter((_, i) => i !== idx));
  };

  const updateTier = (idx, field, val) => {
    const updated = [...tiers];
    updated[idx][field] = parseInt(val) || 0;
    setTiers(updated);
  };

  const handleSave = async () => {
    setBusy(true);
    setErr('');
    try {
      const r = await setBulkDiscount(prod.id, tiers);
      onSaved(r.message);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ maxWidth: 440, textAlign: 'left' }} onMouseDown={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h3 style={{ margin: 0 }}>🏷️ Diskon Grosir: {prod.name_id}</h3>
          <button className="x" onClick={onClose}>✕</button>
        </div>

        <p style={{ fontSize: 13, color: '#8a93a6', margin: '0 0 14px' }}>
          Atur diskon persentase berdasarkan jumlah pcs pembelian (bulk purchase).
        </p>

        {err && <div className="empty error-panel" style={{ marginBottom: 12 }}>⚠️ {err}</div>}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 280, overflowY: 'auto' }}>
          {tiers.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 20, color: '#8a93a6', fontSize: 13 }}>
              Belum ada tier diskon grosir. Klik tombol di bawah untuk menambahkan.
            </div>
          ) : (
            tiers.map((t, idx) => (
              <div key={idx} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <span style={{ fontSize: 13, color: '#8a93a6', minWidth: 50 }}>Beli ≥</span>
                <input
                  type="number"
                  min="2"
                  className="qty-field"
                  style={{ width: 80 }}
                  value={t.min_qty}
                  onChange={(e) => updateTier(idx, 'min_qty', e.target.value)}
                />
                <span style={{ fontSize: 13, color: '#8a93a6' }}>pcs → Diskon</span>
                <input
                  type="number"
                  min="1"
                  max="99"
                  className="qty-field"
                  style={{ width: 80 }}
                  value={t.percent}
                  onChange={(e) => updateTier(idx, 'percent', e.target.value)}
                />
                <span style={{ fontSize: 13, color: '#8a93a6' }}>%</span>
                <button
                  type="button"
                  className="x"
                  style={{ color: '#ff6b6b', marginLeft: 'auto' }}
                  onClick={() => removeTier(idx)}
                >
                  ✕
                </button>
              </div>
            ))
          )}
        </div>

        <button
          type="button"
          className="btn-ghost"
          style={{ width: '100%', marginTop: 12, borderStyle: 'dashed' }}
          onClick={addTier}
        >
          ➕ Tambah Tier Diskon
        </button>

        <div className="modal-actions" style={{ marginTop: 20 }}>
          <button type="button" className="btn-ghost" onClick={onClose}>Batal</button>
          <button type="button" className="btn-primary" onClick={handleSave} disabled={busy}>
            {busy ? 'Memproses…' : 'Simpan Diskon Grosir'}
          </button>
        </div>
      </div>
    </div>
  );
}

function CategoryFormModal({ data, onClose, onSaved }) {
  const isEdit = !!data;
  const [nameId, setNameId] = useState(data?.name_id || '');
  const [nameEn, setNameEn] = useState(data?.name_en || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      if (isEdit) {
        const r = await updateCategory(data.id, { name_id: nameId, name_en: nameEn });
        onSaved(r.message);
      } else {
        const r = await createCategory({ name_id: nameId, name_en: nameEn });
        onSaved(r.message);
      }
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ maxWidth: 400, textAlign: 'left' }} onMouseDown={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h3 style={{ margin: 0 }}>{isEdit ? '✏️ Edit Kategori' : '➕ Tambah Kategori'}</h3>
          <button className="x" onClick={onClose}>✕</button>
        </div>

        {err && <div className="empty error-panel" style={{ marginBottom: 12 }}>⚠️ {err}</div>}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label className="field-label">Nama Kategori (Indonesia) *</label>
            <input
              type="text"
              required
              className="qty-field"
              placeholder="Contoh: STREAMING ACCOUNTS"
              value={nameId}
              onChange={(e) => setNameId(e.target.value)}
            />
          </div>

          <div>
            <label className="field-label">Nama Kategori (Inggris)</label>
            <input
              type="text"
              className="qty-field"
              placeholder="Contoh: STREAMING SERVICES"
              value={nameEn}
              onChange={(e) => setNameEn(e.target.value)}
            />
          </div>

          <div className="modal-actions" style={{ marginTop: 14 }}>
            <button type="button" className="btn-ghost" onClick={onClose}>Batal</button>
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy ? 'Memproses…' : isEdit ? 'Simpan' : 'Buat Kategori'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ConfirmDeleteModal({ title, message, onClose, onConfirm }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="modal-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-icon">⚠️</div>
        <h4>{title}</h4>
        <p style={{ margin: '10px 0 20px', color: '#8a93a6', fontSize: 13.5 }}>{message}</p>
        <div className="modal-actions">
          <button className="btn-ghost" onClick={onClose} disabled={busy}>Batal</button>
          <button
            className="btn-danger"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await onConfirm();
              setBusy(false);
            }}
          >
            {busy ? 'Menghapus…' : 'Ya, Hapus Permanen'}
          </button>
        </div>
      </div>
    </div>
  );
}
