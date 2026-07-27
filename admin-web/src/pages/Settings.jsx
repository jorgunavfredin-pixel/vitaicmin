import { useEffect, useState, useCallback } from 'react';
import { fetchSettings, toggleSetting, changeAdminPassword, downloadBackup, updateStoreInfo } from '../api.js';
import Icon from '../components/Icons.jsx';
import PaymentTab from './settings/PaymentTab.jsx';

// Tab structure — dibuat extensible biar gampang nambah tab di fase berikutnya.
const TABS = [
  { key: 'general', label: 'Umum', icon: 'settings' },
  { key: 'store', label: 'Info Toko', icon: 'category' },
  { key: 'payment', label: 'Payment Gateway', icon: 'cash' },
  { key: 'security', label: 'Keamanan', icon: 'shield' },
  { key: 'backup', label: 'Backup', icon: 'download' },
  { key: 'system', label: 'Info Sistem', icon: 'terminal' }
];

const TOGGLE_META = {
  maintenance: { label: 'Maintenance Mode', desc: 'Saat aktif, bot berhenti melayani order (mode perbaikan).', icon: 'tool', danger: true },
  qris_enabled: { label: 'Pembayaran QRIS', desc: 'Izinkan user membayar via QRIS.', icon: 'cash' },
  saldo_enabled: { label: 'Pembayaran Saldo', desc: 'Izinkan user membayar pakai saldo akun.', icon: 'wallet' }
};

function Toggle({ on, onChange, disabled }) {
  return (
    <button className={`switch ${on ? 'on' : ''}`} disabled={disabled}
      onClick={() => onChange(!on)} aria-pressed={on} role="switch">
      <span className="switch-knob" />
    </button>
  );
}

export default function Settings() {
  const [tab, setTab] = useState('general');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [toast, setToast] = useState(null);
  const [busy, setBusy] = useState('');

  const showToast = (msg, kind = 'ok') => {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 3200);
  };

  const load = useCallback(() => {
    fetchSettings().then((d) => { setData(d); setError(''); }).catch((e) => setError(e.message));
  }, []);

  useEffect(() => { load(); }, [load]);

  const onToggle = async (key, value) => {
    setBusy(key);
    // Optimistic update
    setData((d) => ({ ...d, toggles: { ...d.toggles, [key]: value } }));
    try {
      await toggleSetting(key, value);
      showToast(`${TOGGLE_META[key].label}: ${value ? 'ON' : 'OFF'}`);
    } catch (e) {
      setData((d) => ({ ...d, toggles: { ...d.toggles, [key]: !value } })); // rollback
      showToast(e.message, 'err');
    } finally { setBusy(''); }
  };

  if (error) return <div className="panel error-panel hint-icon"><Icon name="warning" size={16} /> {error}</div>;

  return (
    <div className="settings-page">
      <div className="page-head">
        <div>
          <h2 className="page-title">Settings</h2>
          <p className="page-sub">Kelola konfigurasi sistem, keamanan, dan backup.</p>
        </div>
      </div>

      {/* Tab bar */}
      <div className="settings-tabs">
        {TABS.map((t) => (
          <button key={t.key} className={`settings-tab ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
            <Icon name={t.icon} size={16} /> {t.label}
          </button>
        ))}
      </div>

      {!data ? (
        <div className="panel"><div className="empty">Memuat pengaturan…</div></div>
      ) : (
        <>
          {tab === 'general' && (
            <div className="panel settings-panel">
              <h3 className="settings-section-title">Sistem</h3>
              <div className="toggle-list">
                {Object.entries(TOGGLE_META).map(([key, meta]) => (
                  <div key={key} className="toggle-row">
                    <div className={`toggle-icon ${meta.danger ? 'danger' : ''}`}><Icon name={meta.icon} size={18} /></div>
                    <div className="toggle-info">
                      <div className="toggle-label">{meta.label}</div>
                      <div className="toggle-desc">{meta.desc}</div>
                    </div>
                    <Toggle on={data.toggles[key]} disabled={busy === key} onChange={(v) => onToggle(key, v)} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === 'store' && <StoreTab store={data.store} showToast={showToast} onChanged={load} />}

          {tab === 'payment' && <PaymentTab showToast={showToast} />}

          {tab === 'security' && <SecurityTab data={data} showToast={showToast} onChanged={load} />}

          {tab === 'backup' && <BackupTab showToast={showToast} busy={busy} setBusy={setBusy} />}

          {tab === 'system' && <SystemTab env={data.env} />}
        </>
      )}

      {toast && <div className={`toast ${toast.kind}`}>{toast.msg}</div>}
    </div>
  );
}

// ---- Store info tab ----
function StoreTab({ store, showToast, onChanged }) {
  const [form, setForm] = useState({
    store_name: store.store_name || '',
    support_username: store.support_username || '',
    support_hours: store.support_hours || '',
    order_prefix: store.order_prefix || '',
    payment_timeout_minutes: store.payment_timeout_minutes || 15
  });
  const [busy, setBusy] = useState(false);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    const prefix = String(form.order_prefix).trim().toUpperCase();
    if (prefix && !/^[A-Z0-9]{1,10}$/.test(prefix)) return showToast('Prefix order hanya huruf/angka, maks 10 karakter', 'err');
    const mins = parseInt(form.payment_timeout_minutes);
    if (isNaN(mins) || mins < 1 || mins > 1440) return showToast('Timeout pembayaran harus 1–1440 menit', 'err');
    setBusy(true);
    try {
      const r = await updateStoreInfo({ ...form, order_prefix: prefix, payment_timeout_minutes: mins });
      showToast(r.message);
      onChanged();
    } catch (e) { showToast(e.message, 'err'); } finally { setBusy(false); }
  };

  const sampleOrderId = `${(form.order_prefix || 'ORD').toUpperCase()}20260728XXXX`;

  return (
    <div className="panel settings-panel">
      <h3 className="settings-section-title">Info Toko & Pesan</h3>
      <div className="settings-note hint-icon">
        <Icon name="check" size={14} /> Perubahan langsung aktif di bot (tanpa restart). Kalau dikosongkan, sistem pakai nilai dari .env atau default.
      </div>

      <div className="settings-form">
        <label className="field-label">Nama Toko</label>
        <input type="text" className="qty-field" placeholder="cth: Blackscout Store"
          value={form.store_name} onChange={(e) => set('store_name', e.target.value)} />
        <div className="bc-hint">Muncul di pesan sambutan bot, banner QRIS, dll.</div>

        <label className="field-label" style={{ marginTop: 14 }}>Username Support (Telegram)</label>
        <div className="input-prefix">
          <span className="input-prefix-at">@</span>
          <input type="text" className="qty-field" placeholder="username_admin" style={{ paddingLeft: 30 }}
            value={form.support_username} onChange={(e) => set('support_username', e.target.value.replace(/^@+/, ''))} />
        </div>
        <div className="bc-hint">Ditampilkan di menu "Hubungi Support". Tanpa tanda @.</div>

        <label className="field-label" style={{ marginTop: 14 }}>Jam Operasional Support</label>
        <input type="text" className="qty-field" placeholder="09:00 - 22:00 WIB"
          value={form.support_hours} onChange={(e) => set('support_hours', e.target.value)} />

        <label className="field-label" style={{ marginTop: 14 }}>Prefix Order ID</label>
        <input type="text" className="qty-field" placeholder="ORD" style={{ textTransform: 'uppercase', maxWidth: 200 }}
          value={form.order_prefix} onChange={(e) => set('order_prefix', e.target.value.toUpperCase())} />
        <div className="bc-hint">Contoh order ID: <code>{sampleOrderId}</code></div>

        <label className="field-label" style={{ marginTop: 14 }}>Timeout Pembayaran (menit)</label>
        <input type="number" min="1" max="1440" className="qty-field" style={{ maxWidth: 200 }}
          value={form.payment_timeout_minutes} onChange={(e) => set('payment_timeout_minutes', e.target.value)} />
        <div className="bc-hint">Batas waktu QRIS sebelum order kedaluwarsa (1–1440 menit). Default 15.</div>

        <button className="btn-primary" style={{ marginTop: 20 }} onClick={submit} disabled={busy}>
          {busy ? 'Menyimpan…' : 'Simpan Perubahan'}
        </button>
      </div>
    </div>
  );
}

// ---- Security tab: ganti password ----
function SecurityTab({ data, showToast, onChanged }) {
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!cur) return showToast('Masukkan password lama', 'err');
    if (next.length < 6) return showToast('Password baru minimal 6 karakter', 'err');
    if (next !== confirm) return showToast('Konfirmasi password tidak cocok', 'err');
    setBusy(true);
    try {
      const r = await changeAdminPassword(cur, next);
      showToast(r.message);
      setCur(''); setNext(''); setConfirm('');
      onChanged();
    } catch (e) { showToast(e.message, 'err'); } finally { setBusy(false); }
  };

  return (
    <div className="panel settings-panel">
      <h3 className="settings-section-title">Ganti Password Panel</h3>
      <div className="settings-note hint-icon">
        <Icon name={data.security.password_source === 'custom' ? 'check' : 'warning'} size={14} />
        {data.security.password_source === 'custom'
          ? ' Password saat ini: custom (tersimpan aman di database).'
          : ' Password saat ini masih dari .env. Ganti di sini untuk keamanan lebih baik.'}
      </div>

      <div className="settings-form">
        <label className="field-label">Password Lama</label>
        <input type="password" className="qty-field" value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" />

        <label className="field-label" style={{ marginTop: 12 }}>Password Baru (min. 6 karakter)</label>
        <input type="password" className="qty-field" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />

        <label className="field-label" style={{ marginTop: 12 }}>Konfirmasi Password Baru</label>
        <input type="password" className="qty-field" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />

        <button className="btn-primary" style={{ marginTop: 18 }} onClick={submit} disabled={busy}>
          {busy ? 'Menyimpan…' : 'Ganti Password'}
        </button>
      </div>
    </div>
  );
}

// ---- Backup tab ----
function BackupTab({ showToast }) {
  const [downloading, setDownloading] = useState(false);
  const doBackup = async () => {
    setDownloading(true);
    try {
      await downloadBackup();
      showToast('Backup database berhasil diunduh');
    } catch (e) { showToast(e.message, 'err'); } finally { setDownloading(false); }
  };

  return (
    <div className="panel settings-panel">
      <h3 className="settings-section-title">Backup Database</h3>
      <div className="settings-note hint-icon">
        <Icon name="box" size={14} /> Unduh salinan lengkap database (store.db). Simpan di tempat aman sebagai cadangan.
      </div>
      <div className="backup-box">
        <div className="backup-info">
          <Icon name="download" size={26} />
          <div>
            <div className="backup-title">Snapshot Database</div>
            <div className="backup-sub">File SQLite berisi semua data: order, user, produk, stok, voucher.</div>
          </div>
        </div>
        <button className="btn-primary btn-icon" style={{ width: 'auto', marginTop: 0, padding: '11px 18px' }}
          onClick={doBackup} disabled={downloading}>
          <Icon name="download" size={16} /> {downloading ? 'Menyiapkan…' : 'Unduh Backup'}
        </button>
      </div>
    </div>
  );
}

// ---- System info tab (env read-only) ----
function SystemTab({ env }) {
  const rows = [
    { label: 'Nama Toko', value: env.store_name, key: 'STORE_NAME' },
    { label: 'Username Support', value: env.support_username, key: 'SUPPORT_USERNAME' },
    { label: 'Prefix Order', value: env.order_prefix, key: 'ORDER_PREFIX' },
    { label: 'Admin ID', value: env.admin_id, key: 'ADMIN_ID' },
    { label: 'Port Server', value: env.port, key: 'PORT' },
    { label: 'Webhook URL', value: env.webhook_url, key: 'WEBHOOK_URL' },
    { label: 'Bot Token', value: env.bot_token, key: 'BOT_TOKEN', masked: true },
    { label: 'PaKasir API Key', value: env.pakasir_api_key, key: 'PAKASIR_API_KEY', masked: true },
    { label: 'PaKasir Slug', value: env.pakasir_slug, key: 'PAKASIR_SLUG' }
  ];

  return (
    <div className="panel settings-panel">
      <h3 className="settings-section-title">Info Sistem (read-only)</h3>
      <div className="settings-note hint-icon">
        <Icon name="warning" size={14} /> Nilai ini dari .env dan hanya bisa diubah dengan restart server. Ditampilkan sebagai referensi. Konfigurasi yang bisa diedit dari panel akan hadir di fase berikutnya.
      </div>
      <div className="sysinfo-list">
        {rows.map((r) => (
          <div key={r.key} className="sysinfo-row">
            <div className="sysinfo-label">
              {r.label}
              <span className="sysinfo-key">{r.key}</span>
            </div>
            <div className="sysinfo-value mono">
              {r.value != null && r.value !== '' ? r.value : <span className="muted">— belum diset</span>}
              {r.masked && r.value && <span className="sysinfo-masked-badge">masked</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
