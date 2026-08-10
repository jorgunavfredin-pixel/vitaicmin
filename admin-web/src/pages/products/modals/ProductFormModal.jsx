import { useState } from 'react';
import { createProduct, updateProduct } from '../../../api.js';
import Icon from '../../../components/Icons.jsx';
import { STOCK_TYPES } from '../utils.jsx';

export default function ProductFormModal({ prod, categories, onClose, onSaved, toast }) {
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
