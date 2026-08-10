import { useState } from 'react';
import { createCategory, updateCategory } from '../../../api.js';
import Icon from '../../../components/Icons.jsx';

export default function CategoryFormModal({ data, onClose, onSaved }) {
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
