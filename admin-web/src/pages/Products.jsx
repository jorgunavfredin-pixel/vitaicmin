import { useEffect, useState, useCallback } from 'react';
import {
  fetchProducts, fetchCategories, fetchProductStats,
  createCategory, updateCategory, deleteCategory,
  createProduct, updateProduct, toggleActiveProduct, setFlashSale, clearFlashSale,
  setBulkDiscount, deleteProduct,
  fetchStock, addStock, deleteStockItem, clearStock
} from '../api.js';
import Icon from '../components/Icons.jsx';

const formatIDR = (n) => 'Rp ' + new Intl.NumberFormat('id-ID').format(Math.round(n || 0));
const compact = (n) => new Intl.NumberFormat('id-ID', { notation: 'compact', maximumFractionDigits: 1 }).format(n || 0);
const fmtDate = (iso) => iso ? new Date(iso).toLocaleString('id-ID', {
  timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
}).replace('.', ':') + ' WIB' : '-';

const STOCK_TYPES = [
  { id: 'email_pass', label: 'Email | Pass' },
  { id: 'email_pass_key', label: 'Email | Pass | 2FA' },
  { id: 'code', label: 'Code / Pin' },
  { id: 'vcc', label: 'Card | Exp | CVV' },
  { id: 'custom', label: 'Custom Text' }
];
const stockTypeLabel = (t) => (STOCK_TYPES.find((s) => s.id === t)?.label || t);

export default function Products() {
  const [activeTab, setActiveTab] = useState('products'); // 'products' | 'categories'
  const [view, setView] = useState(() => localStorage.getItem('prod_view') || 'table'); // 'table' | 'grid'
  const [categories, setCategories] = useState([]);
  const [productsData, setProductsData] = useState(null);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState(null);

  // Filters
  const [catFilter, setCatFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Modals & Drawers
  const [editingProduct, setEditingProduct] = useState(null); // null | 'new' | product object
  const [flashModalProd, setFlashModalProd] = useState(null);
  const [bulkModalProd, setBulkModalProd] = useState(null);
  const [deleteModalProd, setDeleteModalProd] = useState(null);
  const [stockDrawerProd, setStockDrawerProd] = useState(null); // null | product object

  const [categoryModal, setCategoryModal] = useState(null);
  const [deleteCatModal, setDeleteCatModal] = useState(null);

  const showToast = (msg, kind = 'ok') => {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 3200);
  };

  const setViewPersist = (v) => { setView(v); localStorage.setItem('prod_view', v); };

  const loadData = useCallback(() => {
    setLoading(true);
    Promise.all([
      fetchCategories(),
      fetchProducts({ category_id: catFilter, status: statusFilter, q: searchQuery }),
      fetchProductStats().catch(() => null)
    ])
      .then(([cats, prods, st]) => {
        // Urutkan kategori & produk A-Z (locale ID) agar mudah dicari.
        const byName = (a, b) => (a.name_id || '').localeCompare(b.name_id || '', 'id', { sensitivity: 'base' });
        setCategories([...cats].sort(byName));
        if (prods && Array.isArray(prods.products)) {
          prods.products = [...prods.products].sort(byName);
        }
        setProductsData(prods);
        if (st) setStats(st);
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
          <p className="page-sub">Kelola katalog, harga, promo flash sale, diskon grosir & stok</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          {activeTab === 'products' ? (
            <button className="btn-primary btn-icon" style={{ width: 'auto', padding: '10px 18px' }} onClick={() => setEditingProduct('new')}>
              <Icon name="plus" /> Tambah Produk
            </button>
          ) : (
            <button className="btn-primary btn-icon" style={{ width: 'auto', padding: '10px 18px' }} onClick={() => setCategoryModal({ mode: 'add' })}>
              <Icon name="plus" /> Tambah Kategori
            </button>
          )}
        </div>
      </div>

      {/* Stat Cards */}
      {stats && activeTab === 'products' && (
        <div className="prod-stat-grid">
          <ProdStat icon="package" accent="blue" label="Total Produk" value={stats.totalProducts}
            sub={`${stats.activeProducts} aktif · ${stats.pausedProducts} paused`} />
          <ProdStat icon="box" accent="green" label="Stok Tersedia" value={compact(stats.totalStock)}
            sub={`${stats.totalSold} terjual (30h)`} />
          <ProdStat icon="wallet" accent="violet" label="Nilai Inventory" value={formatIDR(stats.inventoryValue)}
            sub="Estimasi nilai stok tersedia" />
          <ProdStat icon="warning" accent={stats.outOfStockCount > 0 ? 'red' : 'amber'} label="Perlu Restock"
            value={stats.lowStockCount + stats.outOfStockCount}
            sub={`${stats.outOfStockCount} habis · ${stats.lowStockCount} menipis`} />
        </div>
      )}

      {/* Main Tabs */}
      <div className="tab-bar">
        <button className={`tab-item tab-icon ${activeTab === 'products' ? 'active' : ''}`} onClick={() => setActiveTab('products')}>
          <Icon name="package" size={16} /> Produk ({counts.all || 0})
        </button>
        <button className={`tab-item tab-icon ${activeTab === 'categories' ? 'active' : ''}`} onClick={() => setActiveTab('categories')}>
          <Icon name="category" size={16} /> Kategori ({categories.length})
        </button>
      </div>

      {activeTab === 'products' && (
        <>
          {/* Filters & Search Toolbar */}
          <div className="toolbar">
            <div className="chips">
              <button className={`chip ${statusFilter === 'all' ? 'active' : ''}`} onClick={() => setStatusFilter('all')}>
                Semua <span className="chip-count">{counts.all || 0}</span>
              </button>
              <button className={`chip chip-icon ${statusFilter === 'active' ? 'active' : ''}`} onClick={() => setStatusFilter('active')}>
                <Icon name="check" size={15} /> Aktif <span className="chip-count">{counts.active || 0}</span>
              </button>
              <button className={`chip chip-icon ${statusFilter === 'paused' ? 'active' : ''}`} onClick={() => setStatusFilter('paused')}>
                <Icon name="pause" size={15} /> Nonaktif <span className="chip-count">{counts.paused || 0}</span>
              </button>
              <button className={`chip chip-icon ${statusFilter === 'flash' ? 'active' : ''}`} onClick={() => setStatusFilter('flash')}>
                <Icon name="flash" size={15} /> Flash <span className="chip-count">{counts.flash || 0}</span>
              </button>
              <button className={`chip chip-icon ${statusFilter === 'outofstock' ? 'active' : ''}`} onClick={() => setStatusFilter('outofstock')}>
                <Icon name="warning" size={15} /> Stok Habis
              </button>
            </div>

            <div className="toolbar-right">
              <div className="search" style={{ flex: 1, minWidth: 220 }}>
                <span className="search-icon"><Icon name="search" size={15} /></span>
                <input
                  placeholder="Cari nama / ID produk..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>

              <select className="select-field" value={catFilter} onChange={(e) => setCatFilter(e.target.value)}>
                <option value="all">Semua Kategori</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name_id} ({c.product_count})</option>
                ))}
              </select>

              <div className="view-toggle">
                <button className={view === 'table' ? 'active' : ''} onClick={() => setViewPersist('table')} title="Tampilan Tabel"><Icon name="list" /></button>
                <button className={view === 'grid' ? 'active' : ''} onClick={() => setViewPersist('grid')} title="Tampilan Grid"><Icon name="grid" /></button>
              </div>
            </div>
          </div>

          {/* Content */}
          {error ? (
            <div className="panel"><div className="empty error-panel">{error}</div></div>
          ) : loading && !productsData ? (
            <div className="prod-grid">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="skeleton-card" style={{ height: 190 }} />)}</div>
          ) : productsData && productsData.products.length === 0 ? (
            <div className="panel"><div className="empty">Tidak ada produk ditemukan</div></div>
          ) : view === 'grid' ? (
            <div className="prod-grid">
              {productsData?.products.map((p) => (
                <ProductCard key={p.id} p={p}
                  onEdit={() => setEditingProduct(p)}
                  onFlash={() => setFlashModalProd(p)}
                  onBulk={() => setBulkModalProd(p)}
                  onStock={() => setStockDrawerProd(p)}
                  onDelete={() => setDeleteModalProd(p)}
                  onToggle={() => handleToggleActive(p)}
                />
              ))}
            </div>
          ) : (
            <div className="panel no-pad">
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Produk (ID / EN)</th>
                      <th>Kategori</th>
                      <th>Harga</th>
                      <th>Stok</th>
                      <th title="Jumlah item terjual dalam 30 hari terakhir">Terjual (30h)</th>
                      <th>Status</th>
                      <th style={{ textAlign: 'right' }}>Aksi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {productsData?.products.map((p) => (
                      <tr key={p.id}>
                        <td data-label="Produk">
                          <div style={{ fontWeight: 600, color: '#fff' }}>{p.name_id}</div>
                          <div style={{ fontSize: 12, color: '#8a93a6' }}>{p.name_en || '-'}</div>
                        </td>
                        <td data-label="Kategori"><span className="badge st-muted">{p.category_name_id}</span></td>
                        <td data-label="Harga">
                          {p.is_flash_active ? (
                            <div>
                              <span style={{ textDecoration: 'line-through', color: '#8a93a6', fontSize: 12, marginRight: 6 }}>{formatIDR(p.price_idr)}</span>
                              <b style={{ color: '#ff6b6b' }}>{formatIDR(p.flash_price)}</b>
                              <span className="badge-flash badge-icon"><Icon name="flash" size={12} /></span>
                            </div>
                          ) : (
                            <b>{formatIDR(p.price_idr)}</b>
                          )}
                          {p.parsed_qty_discounts?.length > 0 && (
                            <div className="hint-icon" style={{ fontSize: 11, color: '#5b8cff', marginTop: 2 }}><Icon name="tag" size={12} /> {p.parsed_qty_discounts.length} tier bulk</div>
                          )}
                        </td>
                        <td data-label="Stok">
                          <StockPill count={p.available_stock} />
                          <div style={{ fontSize: 11, color: '#8a93a6', marginTop: 2 }}>{stockTypeLabel(p.stock_type)}</div>
                        </td>
                        <td data-label="Terjual (30h)"><b>{p.sold_stock || 0}</b> pcs</td>
                        <td data-label="Status">
                          <button className={`badge badge-icon ${p.active ? 'st-delivered' : 'st-expired'}`} style={{ border: 'none', cursor: 'pointer' }}
                            onClick={() => handleToggleActive(p)} title="Klik untuk toggle status">
                            <Icon name={p.active ? 'check' : 'pause'} size={13} /> {p.active ? 'Aktif' : 'Paused'}
                          </button>
                        </td>
                        <td data-label="Aksi" style={{ textAlign: 'right' }}>
                          <div className="row-actions">
                            <button className="ic-btn" onClick={() => setStockDrawerProd(p)} title="Kelola Stok"><Icon name="box" /></button>
                            <button className="ic-btn" onClick={() => setEditingProduct(p)} title="Edit Produk"><Icon name="edit" /></button>
                            <button className="ic-btn" style={{ color: p.is_flash_active ? '#ff6b6b' : undefined }} onClick={() => setFlashModalProd(p)} title="Flash Sale"><Icon name="flash" /></button>
                            <button className={`ic-btn ${p.parsed_qty_discounts?.length ? 'bulk-active' : ''}`} onClick={() => setBulkModalProd(p)} title="Diskon Grosir"><Icon name="discount" /></button>
                            <button className="ic-btn ic-danger" onClick={() => setDeleteModalProd(p)} title="Hapus"><Icon name="trash" /></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {activeTab === 'categories' && (
        <div className="panel no-pad">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Nama (ID)</th><th>Nama (EN)</th>
                  <th>Jumlah Produk</th><th>Produk Aktif</th><th style={{ textAlign: 'right' }}>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {categories.length === 0 ? (
                  <tr><td colSpan={5} className="empty">Belum ada kategori.</td></tr>
                ) : (
                  categories.map((c) => (
                    <tr key={c.id}>
                      <td data-label="Nama (ID)"><b>{c.name_id}</b></td>
                      <td data-label="Nama (EN)">{c.name_en || '-'}</td>
                      <td data-label="Jumlah Produk"><b>{c.product_count}</b> produk</td>
                      <td data-label="Produk Aktif"><span className="badge st-delivered">{c.active_product_count} aktif</span></td>
                      <td data-label="Aksi" style={{ textAlign: 'right' }}>
                        <div className="row-actions">
                          <button className="ic-btn" onClick={() => setCategoryModal({ mode: 'edit', cat: c })} title="Edit"><Icon name="edit" /></button>
                          <button className="ic-btn ic-danger" onClick={() => setDeleteCatModal(c)} title="Hapus"><Icon name="trash" /></button>
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

      {/* MODALS */}
      {editingProduct && (
        <ProductFormModal
          prod={editingProduct === 'new' ? null : editingProduct}
          categories={categories}
          onClose={() => setEditingProduct(null)}
          onSaved={(msg) => { showToast(msg); setEditingProduct(null); loadData(); }}
          toast={showToast}
        />
      )}
      {flashModalProd && (
        <FlashSaleModal prod={flashModalProd} onClose={() => setFlashModalProd(null)}
          onSaved={(msg) => { showToast(msg); setFlashModalProd(null); loadData(); }} />
      )}
      {bulkModalProd && (
        <BulkDiscountModal prod={bulkModalProd} onClose={() => setBulkModalProd(null)}
          onSaved={(msg) => { showToast(msg); setBulkModalProd(null); loadData(); }} />
      )}
      {stockDrawerProd && (
        <StockDrawer prod={stockDrawerProd} onClose={() => setStockDrawerProd(null)}
          toast={showToast} onChanged={loadData} />
      )}
      {deleteModalProd && (
        <ConfirmDeleteModal
          title={`Hapus Produk ${deleteModalProd.name_id}?`}
          message="Produk dengan histori transaksi akan diarsipkan/nonaktif. Hard-delete hanya berlaku untuk produk baru tanpa histori atau reservasi."
          onClose={() => setDeleteModalProd(null)}
          onConfirm={async () => {
            try { const r = await deleteProduct(deleteModalProd.id); showToast(r.message); setDeleteModalProd(null); loadData(); }
            catch (e) { showToast(e.message, 'err'); }
          }}
        />
      )}
      {categoryModal && (
        <CategoryFormModal data={categoryModal.cat} onClose={() => setCategoryModal(null)}
          onSaved={(msg) => { showToast(msg); setCategoryModal(null); loadData(); }} />
      )}
      {deleteCatModal && (
        <ConfirmDeleteModal
          title={`Hapus Kategori ${deleteCatModal.name_id}?`}
          message={deleteCatModal.product_count > 0
            ? `Kategori masih memiliki ${deleteCatModal.product_count} produk. Pindahkan produknya terlebih dahulu; kategori tidak akan dihapus.`
            : 'Kategori kosong ini akan dihapus permanen.'}
          onClose={() => setDeleteCatModal(null)}
          onConfirm={async () => {
            try { const r = await deleteCategory(deleteCatModal.id); showToast(r.message); setDeleteCatModal(null); loadData(); }
            catch (e) { showToast(e.message, 'err'); }
          }}
        />
      )}

      {toast && <div className={`toast ${toast.kind}`}>{toast.msg}</div>}
    </div>
  );
}

// ---- SMALL PRESENTATIONAL COMPONENTS ----

function ProdStat({ icon, label, value, sub, accent }) {
  return (
    <div className={`stat-card accent-${accent}`}>
      <div className="stat-icon"><Icon name={icon} size={22} /></div>
      <div className="stat-body">
        <div className="stat-label">{label}</div>
        <div className="stat-value">{value}</div>
        {sub && <div className="stat-sub">{sub}</div>}
      </div>
    </div>
  );
}

function StockPill({ count }) {
  if (count > 0 && count < 3) return <b className="hint-icon" style={{ color: '#ffb454' }}>{count} item <Icon name="warning" size={13} /></b>;
  if (count > 0) return <b style={{ color: '#37d399' }}>{count} item</b>;
  return <span className="badge st-cancelled">Habis (0)</span>;
}

function ProductCard({ p, onEdit, onFlash, onBulk, onStock, onDelete, onToggle }) {
  return (
    <div className={`prod-card ${!p.active ? 'is-paused' : ''}`}>
      <div className="prod-card-top">
        <span className="badge st-muted" style={{ fontSize: 11 }}>{p.category_name_id}</span>
        <button className={`badge badge-icon ${p.active ? 'st-delivered' : 'st-expired'}`} style={{ border: 'none', cursor: 'pointer' }} onClick={onToggle}>
          <Icon name={p.active ? 'check' : 'pause'} size={13} /> {p.active ? 'Aktif' : 'Paused'}
        </button>
      </div>
      <div className="prod-card-name">{p.name_id}</div>
      <div className="prod-card-meta">{p.name_en || '-'}</div>

      <div className="prod-card-price">
        {p.is_flash_active ? (
          <>
            <span className="strike">{formatIDR(p.price_idr)}</span>
            <b className="flash">{formatIDR(p.flash_price)}</b>
            <span className="badge-flash badge-icon"><Icon name="flash" size={12} /> Flash</span>
          </>
        ) : (
          <b>{formatIDR(p.price_idr)}</b>
        )}
      </div>
      {p.parsed_qty_discounts?.length > 0 && (
        <div className="prod-card-bulk hint-icon"><Icon name="tag" size={13} /> {p.parsed_qty_discounts.length} tier diskon grosir</div>
      )}

      <div className="prod-card-stock">
        <div>
          <div className="mini-label">Stok</div>
          <StockPill count={p.available_stock} />
        </div>
        <div>
          <div className="mini-label" title="Item terjual dalam 30 hari terakhir">Terjual (30h)</div>
          <b>{p.sold_stock || 0} pcs</b>
        </div>
        <div>
          <div className="mini-label">Tipe</div>
          <span style={{ fontSize: 12 }}>{stockTypeLabel(p.stock_type)}</span>
        </div>
      </div>

      <div className="prod-card-actions">
        <button className="a-btn a-green btn-icon" onClick={onStock}><Icon name="box" size={15} /> Stok</button>
        <button className="a-btn a-blue btn-icon" onClick={onEdit}><Icon name="edit" size={15} /> Edit</button>
        <button className="a-btn a-amber btn-icon" onClick={onFlash} style={{ color: p.is_flash_active ? '#ff6b6b' : undefined }}><Icon name="flash" size={15} /> Flash</button>
        <button className={`a-btn a-violet btn-icon ${p.parsed_qty_discounts?.length ? 'bulk-active' : ''}`} onClick={onBulk}><Icon name="discount" size={15} /> Bulk</button>
        <button className="a-btn a-red" onClick={onDelete}><Icon name="trash" size={15} /></button>
      </div>
    </div>
  );
}

// ---- MODAL COMPONENTS ----

function ProductFormModal({ prod, categories, onClose, onSaved, toast }) {
  const isEdit = !!prod;
  const [formTab, setFormTab] = useState('general');
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

  const handleChange = (field, val) => setFormData((prev) => ({ ...prev, [field]: val }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.name_id.trim()) return toast('Nama produk (ID) wajib diisi', 'err');
    setBusy(true);
    try {
      const r = isEdit ? await updateProduct(prod.id, formData) : await createProduct(formData);
      onSaved(r.message);
    } catch (err) {
      toast(err.message, 'err');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal modal-lg" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{isEdit ? `Edit Produk: ${prod.name_id}` : 'Tambah Produk Baru'}</h3>
          <button className="x" onClick={onClose}><Icon name="x" /></button>
        </div>

        <div className="tab-bar" style={{ marginBottom: 18 }}>
          <button type="button" className={`tab-item tab-icon ${formTab === 'general' ? 'active' : ''}`} onClick={() => setFormTab('general')}><Icon name="settings" size={16} /> Informasi Utama</button>
          <button type="button" className={`tab-item tab-icon ${formTab === 'desc' ? 'active' : ''}`} onClick={() => setFormTab('desc')}><Icon name="desc" size={16} /> Deskripsi</button>
          <button type="button" className={`tab-item tab-icon ${formTab === 'terms' ? 'active' : ''}`} onClick={() => setFormTab('terms')}><Icon name="terms" size={16} /> Garansi & SnK</button>
        </div>

        <form onSubmit={handleSubmit}>
          {formTab === 'general' && (
            <div className="form-grid">
              <div style={{ gridColumn: 'span 2' }}>
                <label className="field-label">Kategori Produk</label>
                <select className="qty-field" value={formData.category_id} onChange={(e) => handleChange('category_id', e.target.value)}>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name_id}</option>)}
                </select>
              </div>
              <div>
                <label className="field-label">Nama Produk (Indonesia) *</label>
                <input type="text" className="qty-field" required placeholder="Contoh: NETFLIX PREMIUM 1 BULAN"
                  value={formData.name_id} onChange={(e) => handleChange('name_id', e.target.value)} />
              </div>
              <div>
                <label className="field-label">Nama Produk (Inggris)</label>
                <input type="text" className="qty-field" placeholder="Contoh: NETFLIX PREMIUM 1 MONTH"
                  value={formData.name_en} onChange={(e) => handleChange('name_en', e.target.value)} />
              </div>
              <div>
                <label className="field-label">Harga Normal (IDR) *</label>
                <input type="number" min="0" className="qty-field" required
                  value={formData.price_idr} onChange={(e) => handleChange('price_idr', e.target.value)} />
              </div>
              <div>
                <label className="field-label">Format Stok (Stock Type)</label>
                <select className="qty-field" value={formData.stock_type} onChange={(e) => handleChange('stock_type', e.target.value)}>
                  {STOCK_TYPES.map((st) => <option key={st.id} value={st.id}>{st.label}</option>)}
                </select>
              </div>
              <div>
                <label className="field-label">Status Produk</label>
                <select className="qty-field" value={formData.active ? 'true' : 'false'} onChange={(e) => handleChange('active', e.target.value === 'true')}>
                  <option value="true">Aktif (Bisa dibeli)</option>
                  <option value="false">Paused (Nonaktif)</option>
                </select>
              </div>
            </div>
          )}

          {formTab === 'desc' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label className="field-label">Deskripsi Produk (Indonesia)</label>
                <textarea rows={3} className="qty-field" style={{ resize: 'vertical' }} placeholder="Penjelasan fitur & detail produk..."
                  value={formData.description_id} onChange={(e) => handleChange('description_id', e.target.value)} />
                <div className="muted small" style={{ marginTop: 6 }}>
                  Disarankan maksimal 100 karakter agar tampilan buyer tetap ringkas. Teks lebih panjang tetap diperbolehkan. ({formData.description_id.length} karakter)
                </div>
              </div>
              <div>
                <label className="field-label">Deskripsi Produk (Inggris)</label>
                <textarea rows={3} className="qty-field" style={{ resize: 'vertical' }} placeholder="Product features & details..."
                  value={formData.description_en} onChange={(e) => handleChange('description_en', e.target.value)} />
                <div className="muted small" style={{ marginTop: 6 }}>
                  Recommended maximum 100 characters for a compact buyer view. Longer text is still allowed. ({formData.description_en.length} characters)
                </div>
              </div>

            </div>
          )}

          {formTab === 'terms' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label className="field-label">Format Teks S&K</label>
                <select className="qty-field" value={formData.terms_format} onChange={(e) => handleChange('terms_format', e.target.value)}>
                  <option value="markdown">Markdown / Plain Text</option>
                  <option value="html">HTML Format</option>
                </select>
              </div>
              <div>
                <label className="field-label">Garansi & SnK (Indonesia)</label>
                <textarea rows={4} className="qty-field" style={{ resize: 'vertical' }} placeholder="Aturan garansi, klaim, & instruksi pemakaian..."
                  value={formData.terms_id} onChange={(e) => handleChange('terms_id', e.target.value)} />
              </div>
              <div>
                <label className="field-label">Garansi & SnK (Inggris)</label>
                <textarea rows={4} className="qty-field" style={{ resize: 'vertical' }} placeholder="Warranty rules, claim & usage instructions..."
                  value={formData.terms_en} onChange={(e) => handleChange('terms_en', e.target.value)} />
              </div>
            </div>
          )}

          <div className="modal-actions" style={{ marginTop: 22 }}>
            <button type="button" className="btn-ghost" onClick={onClose}>Batal</button>
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy ? 'Memproses...' : isEdit ? 'Simpan Perubahan' : 'Tambah Produk'}
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
  const [limitEnabled, setLimitEnabled] = useState(!!prod.flash_max_transactions);
  const [maxTransactions, setMaxTransactions] = useState(prod.flash_max_transactions || 10);

  const discountPct = prod.price_idr > 0 ? Math.round((1 - price / prod.price_idr) * 100) : 0;

  const handleSet = async () => {
    setBusy(true); setErr('');
    try { const r = await setFlashSale(prod.id, { flash_price: price, flash_start: startDate, flash_end: endDate, flash_limit_enabled: limitEnabled, flash_max_transactions: limitEnabled ? maxTransactions : null }); onSaved(r.message); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const handleClear = async () => {
    setBusy(true); setErr('');
    try { const r = await clearFlashSale(prod.id); onSaved(r.message); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="modal-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ maxWidth: 440, textAlign: 'left' }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="h3-icon"><Icon name="flash" size={18} /> Flash Sale: {prod.name_id}</h3>
          <button className="x" onClick={onClose}><Icon name="x" /></button>
        </div>
        <p style={{ fontSize: 13, color: '#8a93a6', margin: '0 0 14px' }}>
          Harga Normal: <b>{formatIDR(prod.price_idr)}</b>
          {price > 0 && price < prod.price_idr && <span className="badge-flash" style={{ marginLeft: 8 }}>Hemat {discountPct}%</span>}
        </p>
        {err && <div className="empty error-panel" style={{ marginBottom: 12 }}>{err}</div>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label className="field-label">Harga Diskon Flash Sale (IDR) *</label>
            <input type="number" className="qty-field" value={price} onChange={(e) => setPrice(parseInt(e.target.value) || 0)} />
          </div>
          <div className="form-grid">
            <div>
              <label className="field-label">Waktu Mulai *</label>
              <input type="datetime-local" className="qty-field" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div>
              <label className="field-label">Waktu Selesai *</label>
              <input type="datetime-local" className="qty-field" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
          </div>
          <label className="toggle-line" style={{ marginTop: 4 }}>
            <input type="checkbox" checked={limitEnabled} onChange={(e) => setLimitEnabled(e.target.checked)} />
            <span>Batasi jumlah transaksi flash sale</span>
          </label>
          {limitEnabled && (
            <div>
              <label className="field-label">Maksimal Transaksi / Slot *</label>
              <input type="number" min="1" className="qty-field" value={maxTransactions} onChange={(e) => setMaxTransactions(parseInt(e.target.value) || 0)} />
              <div className="muted small" style={{ marginTop: 6 }}>Satu order sukses dihitung sebagai satu slot.</div>
            </div>
          )}
        </div>
        <div className="modal-actions" style={{ marginTop: 20 }}>
          {prod.is_flash_active && (
            <button type="button" className="btn-ghost" style={{ color: '#ff6b6b' }} onClick={handleClear} disabled={busy}>Matikan Promo</button>
          )}
          <button type="button" className="btn-primary" onClick={handleSet} disabled={busy}>{busy ? 'Memproses...' : 'Simpan Flash Sale'}</button>
        </div>
      </div>
    </div>
  );
}

function BulkDiscountModal({ prod, onClose, onSaved }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [tiers, setTiers] = useState((prod.parsed_qty_discounts || []).map(t => ({ ...t, type: t.type || (t.price != null ? 'fixed_price' : 'percent') })));
  const addTier = () => setTiers([...tiers, { min_qty: 2, type: 'percent', percent: 10 }]);
  const removeTier = (idx) => setTiers(tiers.filter((_, i) => i !== idx));
  const updateTier = (idx, field, val) => {
    const updated = [...tiers];
    if (field === 'type') {
      updated[idx] = val === 'fixed_price'
        ? { min_qty: updated[idx].min_qty, type: val, price: Math.max(1, Math.floor(prod.price_idr * 0.85)) }
        : { min_qty: updated[idx].min_qty, type: 'percent', percent: 10 };
    } else updated[idx][field] = parseInt(val) || 0;
    setTiers(updated);
  };
  const handleSave = async () => {
    setBusy(true); setErr('');
    try { const r = await setBulkDiscount(prod.id, tiers); onSaved(r.message); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="modal-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal bulk-discount-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="h3-icon"><Icon name="discount" size={18} /> Diskon Grosir: {prod.name_id}</h3>
          <button className="x" onClick={onClose}><Icon name="x" /></button>
        </div>
        <p style={{ fontSize: 13, color: '#8a93a6', margin: '0 0 14px' }}>
          Atur diskon persen atau harga per pcs berdasarkan minimal jumlah pembelian.
        </p>
        {err && <div className="empty error-panel" style={{ marginBottom: 12 }}>{err}</div>}
        <div className="bulk-tier-list">
          {tiers.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 20, color: '#8a93a6', fontSize: 13 }}>
              Belum ada tier diskon grosir. Klik tombol di bawah untuk menambahkan.
            </div>
          ) : (
            tiers.map((t, idx) => (
              <div key={idx} className="tier-row">
                <span style={{ fontSize: 13, color: '#8a93a6', minWidth: 44 }}>Beli &ge;</span>
                <input type="number" min="2" className="qty-field" style={{ width: 80 }} value={t.min_qty} onChange={(e) => updateTier(idx, 'min_qty', e.target.value)} />
                <span style={{ fontSize: 13, color: '#8a93a6' }}>pcs</span>
                <select className="select-field" style={{ width: 112 }} value={t.type || 'percent'} onChange={(e) => updateTier(idx, 'type', e.target.value)}>
                  <option value="percent">Persen</option>
                  <option value="fixed_price">Harga/pcs</option>
                </select>
                {t.type === 'fixed_price' ? (
                  <input type="number" min="1" max={Math.max(1, prod.price_idr - 1)} className="qty-field" style={{ width: 105 }} value={t.price || 0} onChange={(e) => updateTier(idx, 'price', e.target.value)} />
                ) : (
                  <><input type="number" min="1" max="99" className="qty-field" style={{ width: 80 }} value={t.percent || 0} onChange={(e) => updateTier(idx, 'percent', e.target.value)} /><span style={{ fontSize: 13, color: '#8a93a6' }}>%</span></>
                )}
                <button type="button" className="x" style={{ color: '#ff6b6b', marginLeft: 'auto' }} onClick={() => removeTier(idx)}><Icon name="x" size={16} /></button>
              </div>
            ))
          )}
        </div>
        <button type="button" className="btn-ghost btn-icon" style={{ width: '100%', marginTop: 12, borderStyle: 'dashed', justifyContent: 'center' }} onClick={addTier}>
          <Icon name="plus" size={15} /> Tambah Tier Diskon
        </button>
        <div className="modal-actions" style={{ marginTop: 20 }}>
          <button type="button" className="btn-ghost" onClick={onClose}>Batal</button>
          <button type="button" className="btn-primary" onClick={handleSave} disabled={busy}>{busy ? 'Memproses...' : 'Simpan Diskon Grosir'}</button>
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
    setBusy(true); setErr('');
    try {
      const r = isEdit ? await updateCategory(data.id, { name_id: nameId, name_en: nameEn }) : await createCategory({ name_id: nameId, name_en: nameEn });
      onSaved(r.message);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="modal-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ maxWidth: 400, textAlign: 'left' }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{isEdit ? 'Edit Kategori' : 'Tambah Kategori'}</h3>
          <button className="x" onClick={onClose}><Icon name="x" /></button>
        </div>
        {err && <div className="empty error-panel" style={{ marginBottom: 12 }}>{err}</div>}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label className="field-label">Nama Kategori (Indonesia) *</label>
            <input type="text" required className="qty-field" placeholder="Contoh: STREAMING ACCOUNTS" value={nameId} onChange={(e) => setNameId(e.target.value)} />
          </div>
          <div>
            <label className="field-label">Nama Kategori (Inggris)</label>
            <input type="text" className="qty-field" placeholder="Contoh: STREAMING SERVICES" value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
          </div>
          <div className="modal-actions" style={{ marginTop: 14 }}>
            <button type="button" className="btn-ghost" onClick={onClose}>Batal</button>
            <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Memproses...' : isEdit ? 'Simpan' : 'Buat Kategori'}</button>
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
        <div className="modal-icon modal-icon-danger"><Icon name="warning" size={30} /></div>
        <h4>{title}</h4>
        <p style={{ margin: '10px 0 20px', color: '#8a93a6', fontSize: 13.5 }}>{message}</p>
        <div className="modal-actions">
          <button className="btn-ghost" onClick={onClose} disabled={busy}>Batal</button>
          <button className="btn-danger" disabled={busy} onClick={async () => { setBusy(true); await onConfirm(); setBusy(false); }}>
            {busy ? 'Menghapus...' : 'Ya, Hapus Permanen'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- STOCK MANAGEMENT DRAWER ----
// Diekspor agar bisa dipakai ulang di halaman Stok (Stock Control Center).

export function StockDrawer({ prod, onClose, toast, onChanged }) {
  const [data, setData] = useState(null);
  const [filter, setFilter] = useState('available'); // available | reserved | sold | all
  const [q, setQ] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState('list'); // 'list' | 'add' | 'removeData'
  const [bulkText, setBulkText] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    fetchStock(prod.id, { filter, q })
      .then((d) => { setData(d); setErr(''); })
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }, [prod.id, filter, q]);

  useEffect(() => {
    const t = setTimeout(load, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  const refresh = () => { load(); onChanged?.(); };

  const doAdd = async () => {
    const lines = bulkText.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) return toast('Masukkan minimal 1 baris data stok', 'err');
    setBusy(true);
    try {
      const r = await addStock(prod.id, lines);
      toast(r.message);
      setBulkText('');
      setMode('list');
      setFilter('available');
      refresh();
    } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };

  const doDeleteItem = async (stockId) => {
    setBusy(true);
    try { const r = await deleteStockItem(prod.id, stockId); toast(r.message); refresh(); }
    catch (e) { toast(e.message, 'err'); } finally { setBusy(false); setConfirm(null); }
  };

  const doClear = async () => {
    setBusy(true);
    try { const r = await clearStock(prod.id); toast(r.message); refresh(); }
    catch (e) { toast(e.message, 'err'); } finally { setBusy(false); setConfirm(null); }
  };

  const c = data?.counts || {};

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer drawer-wide">
        <div className="drawer-head">
          <div>
            <h3 className="h3-icon"><Icon name="box" size={18} /> Kelola Stok</h3>
            <div style={{ fontSize: 12.5, color: '#8a93a6', marginTop: 2 }}>{prod.name_id} · {stockTypeLabel(prod.stock_type)}</div>
          </div>
          <button className="x" onClick={onClose}><Icon name="x" /></button>
        </div>

        <div className="drawer-body">
          {/* Stock summary */}
          <div className="stock-summary">
            <div className="ss-item"><span className="ss-val" style={{ color: '#37d399' }}>{c.available ?? 0}</span><span className="ss-lbl">Tersedia</span></div>
            <div className="ss-item"><span className="ss-val" style={{ color: '#ffb454' }}>{c.reserved ?? 0}</span><span className="ss-lbl">Direserve</span></div>
            <div className="ss-item"><span className="ss-val" style={{ color: '#5b8cff' }}>{c.sold ?? 0}</span><span className="ss-lbl">Terjual</span></div>
            <div className="ss-item"><span className="ss-val">{c.all ?? 0}</span><span className="ss-lbl">Total</span></div>
          </div>

          {/* Action buttons */}
          {mode === 'list' && (
            <div className="stock-actions">
              <button className="a-btn a-green btn-icon" onClick={() => setMode('add')}><Icon name="plus" size={15} /> Tambah Stok</button>
              <button className="a-btn a-red btn-icon" onClick={() => setConfirm({ type: 'clear' })} disabled={!c.available}><Icon name="trash" size={15} /> Kosongkan</button>
            </div>
          )}

          {/* ADD stock form */}
          {mode === 'add' && (
            <div className="stock-form">
              <label className="field-label">Tempel data stok (1 baris = 1 item)</label>
              <textarea rows={8} className="qty-field" style={{ resize: 'vertical', fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12.5 }}
                placeholder={"email@mail.com|password123\nemail2@mail.com|password456"}
                value={bulkText} onChange={(e) => setBulkText(e.target.value)} />
              <div style={{ fontSize: 12, color: '#8a93a6', marginTop: 6 }}>
                {bulkText.split('\n').map((l) => l.trim()).filter(Boolean).length} baris siap ditambahkan
              </div>
              <div className="modal-actions" style={{ marginTop: 14 }}>
                <button className="btn-ghost" onClick={() => { setMode('list'); setBulkText(''); }}>Batal</button>
                <button className="btn-primary" onClick={doAdd} disabled={busy}>{busy ? 'Memproses...' : 'Tambah Stok'}</button>
              </div>
            </div>
          )}

          {/* LIST view */}
          {mode === 'list' && (
            <>
              <div className="stock-filter-bar">
                <div className="chips">
                  {[['available', `Tersedia (${c.available ?? 0})`], ['reserved', `Reserve (${c.reserved ?? 0})`], ['sold', `Terjual (${c.sold ?? 0})`], ['all', `Semua (${c.all ?? 0})`]].map(([k, lbl]) => (
                    <button key={k} className={`chip ${filter === k ? 'active' : ''}`} onClick={() => setFilter(k)}>{lbl}</button>
                  ))}
                </div>
                <div className="search" style={{ marginTop: 10, maxWidth: '100%' }}>
                  <span className="search-icon"><Icon name="search" size={15} /></span>
                  <input placeholder="Cari data stok..." value={q} onChange={(e) => setQ(e.target.value)} />
                </div>
              </div>

              {err && <div className="empty error-panel">{err}</div>}
              {loading && !data ? (
                <div className="empty">Memuat stok...</div>
              ) : data && data.items.length === 0 ? (
                <div className="empty">Tidak ada item stok pada filter ini.</div>
              ) : (
                <div className="stock-list">
                  {data?.items.map((s) => (
                    <div key={s.id} className={`stock-item ${s.sold ? 'sold' : s.reserved_by ? 'reserved' : ''}`}>
                      <div className="stock-item-main">
                        <code className="stock-data">{s.data}</code>
                        <div className="stock-item-meta">
                          {s.sold ? (
                            <span className="badge st-paid badge-icon"><Icon name="coin" size={12} /> Terjual{s.order_id ? ` · ${s.order_id}` : ''}</span>
                          ) : s.reserved_by ? (
                            <span className="badge st-pending badge-icon"><Icon name="clock" size={12} /> Reserved · {s.reserved_by}</span>
                          ) : (
                            <span className="badge st-delivered badge-icon"><Icon name="check" size={12} /> Tersedia</span>
                          )}
                          <span className="stock-date"><Icon name="clock" size={12} /> {fmtDate(s.added_at)}</span>
                        </div>
                      </div>
                      {!s.sold && (
                        <button className="ic-btn ic-danger" title="Hapus item"
                          onClick={() => setConfirm({ type: 'delItem', id: s.id, data: s.data })}><Icon name="trash" /></button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </aside>

      {confirm?.type === 'clear' && (
        <ConfirmDeleteModal
          title="Kosongkan Semua Stok Tersedia?"
          message={`${c.available} item stok yang belum terjual akan dihapus permanen. Stok terjual tidak terpengaruh.`}
          onClose={() => setConfirm(null)}
          onConfirm={doClear}
        />
      )}
      {confirm?.type === 'delItem' && (
        <ConfirmDeleteModal
          title="Hapus Item Stok Ini?"
          message={confirm.data}
          onClose={() => setConfirm(null)}
          onConfirm={() => doDeleteItem(confirm.id)}
        />
      )}
    </>
  );
}


