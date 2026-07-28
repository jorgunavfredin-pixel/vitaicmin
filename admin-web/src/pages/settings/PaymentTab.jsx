import { useEffect, useState, useCallback } from 'react';
import { fetchGateways, createGateway, updateGateway, deleteGateway, testGateway, fetchRouting, updateRouting } from '../../api.js';
import Icon from '../../components/Icons.jsx';

// Label & deskripsi tiap strategi routing (Fase 4).
const STRATEGY_META = {
  priority: { label: 'Prioritas', desc: 'Selalu pakai gateway dengan prioritas tertinggi (angka terkecil). Gateway lain jadi cadangan.' },
  round_robin: { label: 'Round Robin', desc: 'Bergilir merata antar gateway aktif tiap transaksi — bagi beban.' },
  manual: { label: 'Manual', desc: 'Selalu pakai satu gateway yang kamu pilih.' }
};

// Metadata field per provider (label & apakah rahasia). Fase 4 bisa nambah provider.
const PROVIDER_META = {
  pakasir: {
    label: 'PaKasir',
    fields: [
      { key: 'api_key', label: 'API Key', secret: true, placeholder: 'Masukkan API Key' },
      { key: 'slug', label: 'Project Slug', secret: false, placeholder: 'cth: mystore' }
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
        <Icon name="shield" size={14} /> Credential disimpan aman & ditampilkan tersamar (••••). Kosongkan field saat edit kalau tidak ingin mengubahnya. Perubahan langsung dipakai bot tanpa restart.
      </div>

      {data.gateways.length === 0 ? (
        <div className="empty">Belum ada gateway. Klik "Tambah Gateway".</div>
      ) : (
        <div className="gw-list">
          {data.gateways.map((gw) => (
            <GatewayCard key={gw.id} gw={gw} showToast={showToast} onChanged={load}
              showPriority={data.gateways.length > 1} />
          ))}
        </div>
      )}

      {/* Routing hanya relevan kalau ada >1 gateway (Fase 4). */}
      {data.gateways.length > 1 && (
        <RoutingPanel gateways={data.gateways} showToast={showToast} />
      )}

      {adding && (
        <AddGatewayModal providers={data.providers} onClose={() => setAdding(false)}
          showToast={showToast} onDone={() => { setAdding(false); load(); }} />
      )}
    </div>
  );
}

function RoutingPanel({ gateways, showToast }) {
  const [routing, setRouting] = useState(null);
  const [strategy, setStrategy] = useState('priority');
  const [manualId, setManualId] = useState('');
  const [busy, setBusy] = useState(false);

  const enabledGws = gateways.filter((g) => g.enabled);

  useEffect(() => {
    fetchRouting().then((r) => {
      setRouting(r);
      setStrategy(r.strategy || 'priority');
      setManualId(r.manual_id || (enabledGws[0]?.id ?? ''));
    }).catch(() => { });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    setBusy(true);
    try {
      const payload = { strategy };
      if (strategy === 'manual') payload.manual_id = manualId;
      const r = await updateRouting(payload);
      showToast(r.message || 'Strategi routing disimpan');
      const fresh = await fetchRouting();
      setRouting(fresh);
    } catch (e) { showToast(e.message, 'err'); } finally { setBusy(false); }
  };

  return (
    <div className="gw-routing">
      <div className="settings-head-row" style={{ marginBottom: 6 }}>
        <h4 className="settings-section-title" style={{ margin: 0, fontSize: 14 }}>Strategi Routing</h4>
        {routing?.active_gateway && (
          <span className="gw-routing-active">Aktif: <b>{routing.active_gateway.label}</b></span>
        )}
      </div>
      <div className="settings-note hint-icon" style={{ marginTop: 0, marginBottom: 12 }}>
        <Icon name="info" size={14} /> Menentukan gateway mana yang dipakai saat pelanggan membuat pembayaran QRIS baru.
      </div>

      <div className="gw-strategy-opts">
        {Object.entries(STRATEGY_META).map(([key, meta]) => (
          <label key={key} className={`gw-strategy-opt ${strategy === key ? 'sel' : ''}`}>
            <input type="radio" name="gw-strategy" value={key}
              checked={strategy === key} onChange={() => setStrategy(key)} />
            <span className="gw-strategy-body">
              <b>{meta.label}</b>
              <span className="gw-strategy-desc">{meta.desc}</span>
            </span>
          </label>
        ))}
      </div>

      {strategy === 'manual' && (
        <div className="gw-field" style={{ marginTop: 10 }}>
          <label className="field-label">Gateway pilihan</label>
          <select className="select-field" style={{ width: '100%' }}
            value={manualId} onChange={(e) => setManualId(e.target.value)}>
            {enabledGws.length === 0 && <option value="">(tidak ada gateway aktif)</option>}
            {enabledGws.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
          </select>
        </div>
      )}

      <button className="a-btn a-blue btn-icon" style={{ marginTop: 12 }} onClick={save}
        disabled={busy || (strategy === 'manual' && !manualId)}>
        <Icon name="check" size={14} /> {busy ? 'Menyimpan…' : 'Simpan Strategi'}
      </button>
    </div>
  );
}

function GatewayCard({ gw, showToast, onChanged, showPriority }) {
  const meta = PROVIDER_META[gw.provider] || { label: gw.provider, fields: [] };
  const [label, setLabel] = useState(gw.label);
  const [priority, setPriority] = useState(gw.priority ?? 0);
  const [creds, setCreds] = useState({});   // hanya field yang diubah
  const [busy, setBusy] = useState('');
  const [testResult, setTestResult] = useState(null);
  const [confirmDel, setConfirmDel] = useState(false);

  const setCred = (k, v) => setCreds((c) => ({ ...c, [k]: v }));

  const save = async () => {
    setBusy('save');
    try {
      const payload = { label };
      if (Object.keys(creds).length) payload.credentials = creds;
      const p = parseInt(priority);
      if (!isNaN(p)) payload.priority = p;
      await updateGateway(gw.id, payload);
      showToast('Gateway disimpan');
      setCreds({});
      onChanged();
    } catch (e) { showToast(e.message, 'err'); } finally { setBusy(''); }
  };

  const toggleEnabled = async () => {
    setBusy('toggle');
    try {
      await updateGateway(gw.id, { enabled: !gw.enabled });
      showToast(`Gateway ${!gw.enabled ? 'diaktifkan' : 'dinonaktifkan'}`);
      onChanged();
    } catch (e) { showToast(e.message, 'err'); } finally { setBusy(''); }
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
    <div className={`gw-card ${gw.enabled ? '' : 'disabled'}`}>
      <div className="gw-card-head">
        <div className="gw-card-title">
          <span className="gw-provider-badge">{meta.label}</span>
          <input className="gw-label-input" value={label} onChange={(e) => setLabel(e.target.value)} />
        </div>
        <div className="gw-card-actions">
          <span className={`gw-status ${gw.enabled ? 'on' : 'off'}`}>{gw.enabled ? 'Aktif' : 'Nonaktif'}</span>
          <button className="switch-sm" onClick={toggleEnabled} disabled={busy === 'toggle'}>
            <span className={`switch ${gw.enabled ? 'on' : ''}`}><span className="switch-knob" /></span>
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
        {showPriority && (
          <div className="gw-field">
            <label className="field-label">Prioritas <span className="field-hint">(kecil = didahulukan)</span></label>
            <input type="number" className="qty-field" min="0" step="1"
              value={priority} onChange={(e) => setPriority(e.target.value)} />
          </div>
        )}
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
      if (f.secret && !creds[f.key]) return showToast(`${f.label} wajib diisi`, 'err');
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
