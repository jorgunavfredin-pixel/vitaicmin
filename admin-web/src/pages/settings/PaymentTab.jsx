import { useEffect, useState, useCallback } from 'react';
import { fetchGateways, createGateway, updateGateway, deleteGateway, testGateway } from '../../api.js';
import Icon from '../../components/Icons.jsx';

// Toko hanya memakai QRIS. Saat >1 gateway aktif, buyer memilih gateway saat checkout.
const PROVIDER_META = {
  pakasir: {
    label: 'PaKasir',
    fields: [
      { key: 'api_key', label: 'API Key', secret: true, placeholder: 'Masukkan API Key' },
      { key: 'slug', label: 'Project Slug', secret: false, placeholder: 'cth: mystore' }
    ]
  },
  wijayapay: {
    label: 'WijayaPay',
    fields: [
      { key: 'code_merchant', label: 'Code Merchant', secret: false, placeholder: 'cth: WP692f1bafd86' },
      { key: 'api_key', label: 'API Key', secret: true, placeholder: 'Masukkan API Key' }
    ]
  }
};

export default function PaymentTab({ showToast }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);

  const load = useCallback(() => {
    fetchGateways().then((d) => { setData(d); setError(''); }).catch((e) => setError(e.message));
  }, []);

  useEffect(() => { load(); }, [load]);

  if (error) return <div className="panel error-panel hint-icon"><Icon name="warning" size={16} /> {error}</div>;
  if (!data) return <div className="panel"><div className="empty">Memuat gateway…</div></div>;

  return (
    <div className="panel settings-panel">
      <div className="settings-head-row">
        <h3 className="settings-section-title" style={{ margin: 0 }}>Payment Gateway</h3>
        <button className="btn-primary btn-icon" style={{ width: 'auto', marginTop: 0, padding: '9px 15px' }}
          onClick={() => setAdding(true)}>
          <Icon name="plus" size={15} /> Tambah Gateway
        </button>
      </div>
      <div className="settings-note hint-icon" style={{ marginTop: 14 }}>
        <Icon name="shield" size={14} /> Hanya QRIS yang dipakai. Jika lebih dari satu gateway aktif, buyer memilih QRIS 1/2 saat checkout. Credential tersamar (••••) dan perubahan langsung aktif tanpa restart.
      </div>

      {data.gateways.length === 0 ? (
        <div className="empty">Belum ada gateway. Klik "Tambah Gateway".</div>
      ) : (
        <div className="gw-list">
          {data.gateways.map((gw) => (
            <GatewayCard key={gw.id} gw={gw} showToast={showToast} onChanged={load} />
          ))}
        </div>
      )}


      {adding && (
        <AddGatewayModal providers={data.providers} onClose={() => setAdding(false)}
          showToast={showToast} onDone={() => { setAdding(false); load(); }} />
      )}
    </div>
  );
}


function GatewayCard({ gw, showToast, onChanged }) {
  const meta = PROVIDER_META[gw.provider] || { label: gw.provider, fields: [] };
  const [label, setLabel] = useState(gw.label);
  const [enabled, setEnabled] = useState(gw.enabled);
  const [creds, setCreds] = useState({});   // hanya field yang diubah
  const [busy, setBusy] = useState('');
  const [testResult, setTestResult] = useState(null);
  const [confirmDel, setConfirmDel] = useState(false);

  useEffect(() => {
    setEnabled(gw.enabled);
    setLabel(gw.label);
  }, [gw.enabled, gw.label]);

  const setCred = (k, v) => setCreds((c) => ({ ...c, [k]: v }));

  const save = async () => {
    setBusy('save');
    try {
      const payload = { label };
      if (Object.keys(creds).length) payload.credentials = creds;

      await updateGateway(gw.id, payload);
      showToast('Gateway disimpan');
      setCreds({});
      onChanged();
    } catch (e) { showToast(e.message, 'err'); } finally { setBusy(''); }
  };

  const toggleEnabled = async () => {
    if (busy) return;
    const next = !enabled;
    setEnabled(next);
    setBusy('toggle');
    try {
      const result = await updateGateway(gw.id, { enabled: next });
      setEnabled(result.gateway?.enabled ?? next);
      showToast(`Gateway ${next ? 'diaktifkan' : 'dinonaktifkan'}`);
      await onChanged();
    } catch (e) {
      setEnabled(!next);
      showToast(e.message, 'err');
    } finally { setBusy(''); }
  };

  const test = async () => {
    setBusy('test'); setTestResult(null);
    try {
      // Kirim credential yang sedang diedit (kalau ada) supaya bisa tes sebelum simpan.
      const r = await testGateway(gw.id, creds);
      setTestResult(r);
    } catch (e) { setTestResult({ ok: false, message: e.message }); } finally { setBusy(''); }
  };

  const doDelete = async () => {
    setBusy('del');
    try {
      const r = await deleteGateway(gw.id);
      showToast(r.message);
      onChanged();
    } catch (e) { showToast(e.message, 'err'); setBusy(''); }
  };

  return (
    <div className={`gw-card ${enabled ? '' : 'disabled'}`}>
      <div className="gw-card-head">
        <div className="gw-card-title">
          <div className="gw-card-ident">
            <div className="gw-card-badges">
              <span className="gw-provider-badge">{meta.label}</span>
              {gw.buyer_label
                ? <span className="gw-buyer-badge">Buyer: {gw.buyer_label}</span>
                : <span className="gw-buyer-badge muted">Tidak tampil ke buyer</span>}
            </div>
            <input className="gw-label-input" value={label} onChange={(e) => setLabel(e.target.value)} />
            <span className="gw-mapping-detail">
              {gw.buyer_label
                ? `${gw.buyer_label} menggunakan ${meta.label} · ${gw.label}`
                : `${meta.label} · ${gw.label}`}
            </span>
          </div>
        </div>
        <div className="gw-card-actions">
          <span className={`gw-status ${enabled ? 'on' : 'off'}`}>{enabled ? 'Aktif' : 'Nonaktif'}</span>
          <button type="button" role="switch" aria-checked={enabled}
            aria-label={`${enabled ? 'Nonaktifkan' : 'Aktifkan'} ${gw.label}`}
            className={`gw-toggle ${enabled ? 'on' : ''}`}
            onClick={toggleEnabled} disabled={!!busy}>
            <span className="gw-toggle-knob" />
          </button>
        </div>
      </div>

      <div className="gw-fields">
        {meta.fields.map((f) => (
          <div key={f.key} className="gw-field">
            <label className="field-label">{f.label}</label>
            <input
              type={f.secret ? 'password' : 'text'}
              className="qty-field"
              placeholder={gw.credentials[f.key] ? `Tersimpan: ${gw.credentials[f.key]} (kosongkan = tetap)` : f.placeholder}
              value={creds[f.key] ?? ''}
              onChange={(e) => setCred(f.key, e.target.value)}
            />
          </div>
        ))}

      </div>

      {testResult && (
        <div className={`gw-test-result ${testResult.ok ? 'ok' : 'err'}`}>
          <Icon name={testResult.ok ? 'check' : 'warning'} size={14} /> {testResult.message}
        </div>
      )}

      <div className="gw-card-footer">
        <button className="a-btn btn-icon" onClick={test} disabled={!!busy}>
          <Icon name="refresh" size={14} /> {busy === 'test' ? 'Mengetes…' : 'Test Koneksi'}
        </button>
        <button className="a-btn a-blue btn-icon" onClick={save} disabled={!!busy}>
          <Icon name="check" size={14} /> {busy === 'save' ? 'Menyimpan…' : 'Simpan'}
        </button>
        <button className="a-btn a-red btn-icon" onClick={() => setConfirmDel(true)} disabled={!!busy}>
          <Icon name="trash" size={14} /> Hapus
        </button>
      </div>

      {confirmDel && (
        <div className="modal-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) setConfirmDel(false); }}>
          <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-icon modal-icon-danger"><Icon name="warning" size={30} /></div>
            <h4>Hapus Gateway?</h4>
            <p>Gateway <b>{gw.label}</b> akan dihapus. Kalau ini satu-satunya gateway aktif, pembayaran QRIS bisa berhenti. Pastikan ada gateway lain atau .env sebagai fallback.</p>
            <div className="modal-actions">
              <button className="btn-ghost" onClick={() => setConfirmDel(false)}>Batal</button>
              <button className="btn-danger" onClick={doDelete}>Ya, Hapus</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AddGatewayModal({ providers, onClose, showToast, onDone }) {
  const [provider, setProvider] = useState(providers[0] || 'pakasir');
  const [label, setLabel] = useState('');
  const [creds, setCreds] = useState({});
  const [busy, setBusy] = useState(false);
  const meta = PROVIDER_META[provider] || { label: provider, fields: [] };

  const submit = async () => {
    for (const f of meta.fields) {
      if (!creds[f.key]) return showToast(`${f.label} wajib diisi`, 'err');
    }
    setBusy(true);
    try {
      const r = await createGateway({ provider, label: label || meta.label, credentials: creds, enabled: true });
      showToast(r.message);
      onDone();
    } catch (e) { showToast(e.message, 'err'); } finally { setBusy(false); }
  };

  return (
    <div className="modal-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ maxWidth: 440, textAlign: 'left' }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="h3-icon"><Icon name="cash" size={18} /> Tambah Payment Gateway</h3>
          <button className="x" onClick={onClose}><Icon name="x" /></button>
        </div>

        <label className="field-label">Provider</label>
        <select className="select-field" style={{ width: '100%' }} value={provider} onChange={(e) => setProvider(e.target.value)}>
          {providers.map((p) => <option key={p} value={p}>{PROVIDER_META[p]?.label || p}</option>)}
        </select>

        <label className="field-label" style={{ marginTop: 12 }}>Label (opsional)</label>
        <input className="qty-field" placeholder={meta.label} value={label} onChange={(e) => setLabel(e.target.value)} />

        {meta.fields.map((f) => (
          <div key={f.key}>
            <label className="field-label" style={{ marginTop: 12 }}>{f.label}</label>
            <input type={f.secret ? 'password' : 'text'} className="qty-field" placeholder={f.placeholder}
              value={creds[f.key] ?? ''} onChange={(e) => setCreds((c) => ({ ...c, [f.key]: e.target.value }))} />
          </div>
        ))}

        <div className="modal-actions" style={{ marginTop: 18 }}>
          <button className="btn-ghost" onClick={onClose}>Batal</button>
          <button className="btn-primary" onClick={submit} disabled={busy}>{busy ? 'Menyimpan…' : 'Tambah'}</button>
        </div>
      </div>
    </div>
  );
}
