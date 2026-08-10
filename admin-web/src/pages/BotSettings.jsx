import { useEffect, useState, useCallback } from 'react';
import { fetchSettings, toggleSetting, updateStoreInfo, toggleBanner, uploadBanner, deleteBanner, fetchBannerBlob } from '../api.js';
import Icon from '../components/Icons.jsx';
import './botsettings/botsettings.css';

// Bot Settings — kontrol operasional bot (dipisah dari Settings sistem).
// Isi: toggle layanan bot + info toko + jam operasional. Backend: settings API existing.

const TOGGLE_META = {
  maintenance: { label: 'Maintenance Mode', desc: 'Saat aktif, bot berhenti melayani order (mode perbaikan).', icon: 'tool', danger: true },
  qris_enabled: { label: 'Pembayaran QRIS', desc: 'Izinkan user membayar via QRIS.', icon: 'cash' },
  saldo_enabled: { label: 'Pembayaran Saldo', desc: 'Izinkan user membayar pakai saldo akun.', icon: 'wallet' },
};

function Toggle({ on, onChange, disabled }) {
  return (
    <button className={`switch ${on ? 'on' : ''}`} disabled={disabled}
      onClick={() => onChange(!on)} aria-pressed={on} role="switch">
      <span className="switch-knob" />
    </button>
  );
}

export default function BotSettings() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [toast, setToast] = useState(null);
  const [busy, setBusy] = useState('');
  const [form, setForm] = useState(null);
  const [storeSection, setStoreSection] = useState('identity');

  const showToast = (msg, kind = 'ok') => { setToast({ msg, kind }); setTimeout(() => setToast(null), 3200); };

  const load = useCallback(() => {
    fetchSettings().then((d) => { setData(d); setForm(d.store || {}); setError(''); }).catch((e) => setError(e.message));
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const refresh = () => load();
    window.addEventListener('settings_updated', refresh);
    return () => window.removeEventListener('settings_updated', refresh);
  }, [load]);

  const onToggle = async (key, value) => {
    setBusy(key);
    setData((d) => ({ ...d, toggles: { ...d.toggles, [key]: value } }));
    try {
      await toggleSetting(key, value);
      showToast(`${TOGGLE_META[key].label}: ${value ? 'ON' : 'OFF'}`);
    } catch (e) {
      setData((d) => ({ ...d, toggles: { ...d.toggles, [key]: !value } }));
      showToast(e.message, 'err');
    } finally { setBusy(''); }
  };

  const saveStore = async () => {
    setBusy('store');
    try { const r = await updateStoreInfo(form); showToast(r.message || 'Info toko disimpan'); load(); }
    catch (e) { showToast(e.message, 'err'); } finally { setBusy(''); }
  };

  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const dirty = !!form && !!data?.store && JSON.stringify(form) !== JSON.stringify(data.store);

  if (error) return <div className="panel error-panel hint-icon"><Icon name="warning" size={16} /> {error}</div>;

  return (
    <div className="page botsettings-page">
      <div className="page-head">
        <div>
          <h2 className="page-title">Bot Settings</h2>
          <p className="page-sub">Kontrol layanan bot, metode bayar, dan identitas toko</p>
        </div>
      </div>

      {!data ? (
        <div className="panel"><div className="empty">Memuat pengaturan…</div></div>
      ) : (
        <>
        <div className="bot-status-strip">
          <div className={`bot-status-item ${data.toggles?.maintenance ? 'danger' : 'ok'}`}><Icon name={data.toggles?.maintenance ? 'warning' : 'check'} size={16}/><span><small>Status Bot</small><b>{data.toggles?.maintenance ? 'Maintenance' : 'Operational'}</b></span></div>
          <div className={`bot-status-item ${data.toggles?.qris_enabled ? 'ok' : 'muted'}`}><Icon name="cash" size={16}/><span><small>QRIS</small><b>{data.toggles?.qris_enabled ? 'Aktif' : 'Nonaktif'}</b></span></div>
          <div className={`bot-status-item ${data.toggles?.saldo_enabled ? 'ok' : 'muted'}`}><Icon name="wallet" size={16}/><span><small>Saldo</small><b>{data.toggles?.saldo_enabled ? 'Aktif' : 'Nonaktif'}</b></span></div>
        </div>
        <div className="botset-layout">
          <div className="botset-top-grid">
          {/* Layanan Bot */}
          <div className="panel bot-services-panel">
            <div className="panel-head"><h3>Layanan Bot</h3></div>
            <div className="toggle-list">
              {Object.entries(TOGGLE_META).map(([key, meta]) => (
                <div key={key} className="toggle-row">
                  <div className={`toggle-icon ${meta.danger ? 'danger' : ''}`}><Icon name={meta.icon} size={18} /></div>
                  <div className="toggle-info">
                    <div className="toggle-label">{meta.label}</div>
                    <div className="toggle-desc">{meta.desc}</div>
                  </div>
                  <Toggle on={!!data.toggles?.[key]} disabled={busy === key} onChange={(v) => onToggle(key, v)} />
                </div>
              ))}
            </div>
          </div>

          {/* Banner Bot */}
          <BannerManager banner={data.banner} showToast={showToast} onChanged={load} />
          </div>

          {/* Info Toko */}
          {form && (
            <div className="panel bot-store-panel">
              <div className="bot-store-head"><div><h3>Informasi Toko</h3><p>Identitas transaksi dan kanal bantuan yang ditampilkan ke customer.</p></div>{dirty&&<span className="bot-unsaved">Belum disimpan</span>}</div>
              <div className="bot-store-tabs">
                <button className={storeSection==='identity'?'active':''} onClick={()=>setStoreSection('identity')}>Identitas & Transaksi</button>
                <button className={storeSection==='support'?'active':''} onClick={()=>setStoreSection('support')}>Kanal Dukungan</button>
              </div>
              <div className={`bot-form-section bot-identity-section ${storeSection==='identity'?'active':''}`}><div className="bot-form-section-title">IDENTITAS & TRANSAKSI</div><div className="form-grid bot-form-grid">
                <label className="field">
                  <span className="field-label">Nama Toko</span>
                  <input className="input" value={form.store_name || ''} onChange={(e) => setField('store_name', e.target.value)} placeholder="Nama toko" />
                </label>
                <label className="field">
                  <span className="field-label">Prefix Order</span>
                  <input className="input" value={form.order_prefix || ''} onChange={(e) => setField('order_prefix', e.target.value)} placeholder="mis. VTC" />
                </label>
                <label className="field">
                  <span className="field-label">Timeout Pembayaran (menit)</span>
                  <input className="input" type="number" min="1" value={form.payment_timeout_minutes ?? ''} onChange={(e) => setField('payment_timeout_minutes', e.target.value)} placeholder="15" />
                </label>
              </div></div>
              <div className={`bot-form-section bot-support-section ${storeSection==='support'?'active':''}`}><div className="bot-form-section-title">KANAL DUKUNGAN</div><div className="form-grid bot-form-grid">
                <label className="field">
                  <span className="field-label">Support — Telegram URL</span>
                  <input className="input" value={form.support_telegram_url || ''} onChange={(e) => setField('support_telegram_url', e.target.value)} placeholder="https://t.me/…" />
                </label>
                <label className="field">
                  <span className="field-label">Support — WhatsApp URL</span>
                  <input className="input" value={form.support_whatsapp_url || ''} onChange={(e) => setField('support_whatsapp_url', e.target.value)} placeholder="https://wa.me/…" />
                </label>
                <label className="field">
                  <span className="field-label">Support — Channel URL</span>
                  <input className="input" value={form.support_channel_url || ''} onChange={(e) => setField('support_channel_url', e.target.value)} placeholder="https://t.me/…" />
                </label>
                <label className="field">
                  <span className="field-label">Support — Grup URL</span>
                  <input className="input" value={form.support_group_url || ''} onChange={(e) => setField('support_group_url', e.target.value)} placeholder="https://t.me/…" />
                </label>
                <label className="field field-full">
                  <span className="field-label">Teks Support</span>
                  <textarea className="input" rows={3} value={form.support_text || ''} onChange={(e) => setField('support_text', e.target.value)} placeholder="Pesan bantuan untuk user" />
                </label>
              </div></div>
              <div className="form-actions">
                <button className="btn-primary" disabled={busy === 'store' || !dirty} onClick={saveStore}>
                  {busy === 'store' ? 'Menyimpan…' : 'Simpan Info Toko'}
                </button>
              </div>
            </div>
          )}
        </div>
        </>
      )}

      {toast && <div className={`toast ${toast.kind}`}>{toast.msg}</div>}
    </div>
  );
}

// Banner Bot — upload/ganti/hapus + toggle tampil. Reuse API banner existing.
function BannerManager({ banner, showToast, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);

  useEffect(() => {
    let url = '';
    if (banner?.exists) {
      setPreviewLoading(true);
      fetchBannerBlob()
        .then((blob) => { url = URL.createObjectURL(blob); setPreview(url); })
        .catch(() => setPreview(''))
        .finally(() => setPreviewLoading(false));
    } else { setPreview(''); setPreviewLoading(false); }
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [banner?.exists, banner?.filename]);

  const onFile = async (e) => {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return showToast('Format harus PNG, JPG, atau WebP', 'err');
    if (file.size > 5 * 1024 * 1024) return showToast('Ukuran maksimal 5 MB', 'err');
    setBusy(true);
    try {
      const dataUrl = await new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(file); });
      const result = await uploadBanner(dataUrl); showToast(result.message); onChanged();
    } catch (err) { showToast(err.message, 'err'); } finally { setBusy(false); }
  };

  const setEnabled = async (enabled) => {
    setBusy(true);
    try { const r = await toggleBanner(enabled); showToast(r.message); onChanged(); }
    catch (e) { showToast(e.message, 'err'); } finally { setBusy(false); }
  };

  const remove = async () => {
    setBusy(true);
    try { const r = await deleteBanner(); showToast(r.message); onChanged(); }
    catch (e) { showToast(e.message, 'err'); } finally { setBusy(false); }
  };

  return (
    <div className="panel bot-banner-panel">
      <div className="panel-head"><h3>Banner Bot</h3></div>
      <div className="banner-manager-head">
        <div>
          <div className="toggle-label">Tampilkan Banner</div>
          <div className="toggle-desc">Muncul pada sambutan & navigasi buyer.</div>
        </div>
        <button className={`switch ${banner?.enabled ? 'on' : ''}`} disabled={busy}
          onClick={() => setEnabled(!banner?.enabled)} aria-pressed={!!banner?.enabled} role="switch">
          <span className="switch-knob" />
        </button>
      </div>
      <div className={`banner-preview ${previewLoading ? 'is-loading' : ''}`}>
        {previewLoading ? <span className="banner-loading"><i /> Memuat banner…</span> : preview ? <img src={preview} alt="Preview banner" /> : <span>Belum ada banner</span>}
      </div>
      <div className="bc-hint">File aktif: <b>{banner?.filename || '—'}</b> · PNG/JPG/WebP · maks. 5 MB</div>
      <div className="banner-actions">
        <label className="btn-primary">{busy ? 'Memproses…' : banner?.exists ? 'Ganti Banner' : 'Upload Banner'}
          <input type="file" accept="image/png,image/jpeg,image/webp" hidden disabled={busy} onChange={onFile} />
        </label>
        {banner?.exists && <button className="btn-ghost danger" disabled={busy} onClick={remove}>Hapus</button>}
      </div>
    </div>
  );
}
