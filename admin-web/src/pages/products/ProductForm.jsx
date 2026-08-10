import { useState } from 'react';
import { createProduct, updateProduct } from '../../api.js';
import { STOCK_TYPES } from './utils.jsx';

/**
 * Form logic + fields produk yang bisa dipakai di 2 tempat:
 *  - ProductFormModal (center modal, dipakai bila perlu di luar workspace)
 *  - ProductWorkspace (dock mode edit/create) — tanpa scrim
 *
 * Render: tab bar (Umum/Deskripsi/Garansi) + fields. Footer disediakan caller
 * lewat prop `renderFooter` supaya modal & dock bisa beda gaya tombol.
 *
 * §15: field "Status Produk" DIHAPUS dari form. `active` tetap dijaga internal:
 *  - edit: pakai nilai existing produk (tidak diubah dari form)
 *  - create: default true
 */
export default function ProductForm({ prod, categories, onSaved, toast, onCancel, footerClass }) {
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
    active: prod ? prod.active : true, // §15 dijaga internal, tidak diedit dari form
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
    <form onSubmit={handleSubmit} className="pf-form">
      {/* Dark segmented tabs (edit-product-modal-subtabs-fix.md) */}
      <div className="product-edit-tabs">
        <button type="button" className={`product-edit-tab ${formTab === 'general' ? 'active' : ''}`} onClick={() => setFormTab('general')}>Umum</button>
        <button type="button" className={`product-edit-tab ${formTab === 'desc' ? 'active' : ''}`} onClick={() => setFormTab('desc')}>Deskripsi</button>
        <button type="button" className={`product-edit-tab ${formTab === 'terms' ? 'active' : ''}`} onClick={() => setFormTab('terms')}>Garansi &amp; SnK</button>
      </div>

      {formTab === 'general' && (
        <div className="pf-fields">
          <div>
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
        </div>
      )}

      {formTab === 'desc' && (
        <div className="pf-stack">
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
        <div className="pf-stack">
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

      <div className={footerClass || 'modal-actions'} style={{ marginTop: 22 }}>
        <button type="button" className="btn-ghost" onClick={onCancel}>Batal</button>
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? 'Memproses...' : isEdit ? 'Simpan Perubahan' : 'Tambah Produk'}
        </button>
      </div>
    </form>
  );
}
