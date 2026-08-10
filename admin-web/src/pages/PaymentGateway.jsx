import { useState } from 'react';
import Icon from '../components/Icons.jsx';
import PaymentTab from './settings/PaymentTab.jsx';
import QrisCustomTab from './settings/QrisCustomTab.jsx';
import './payment/payment.css';

// Payment Gateway — halaman khusus (dipisah dari Settings).
// Gabung 2 sub-tab yang sebelumnya di Settings: konfigurasi gateway + QRIS Custom twibbon.
const SUBTABS = [
  { key: 'gateway', label: 'Gateway', icon: 'cash', desc: 'Provider pembayaran (QRIS & Binance Pay)' },
  { key: 'qris-custom', label: 'QRIS Custom', icon: 'grid', desc: 'Template twibbon QR pembayaran' },
];

export default function PaymentGateway() {
  const [sub, setSub] = useState('gateway');
  const [toast, setToast] = useState(null);

  const showToast = (msg, kind = 'ok') => {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 3200);
  };

  const active = SUBTABS.find((t) => t.key === sub) || SUBTABS[0];

  return (
    <div className="page payment-page">
      <div className="page-head">
        <div>
          <h2 className="page-title">Payment Gateway</h2>
          <p className="page-sub">Kelola metode & konfigurasi pembayaran toko</p>
        </div>
      </div>

      <div className="subtab-bar">
        {SUBTABS.map((t) => (
          <button
            key={t.key}
            className={`subtab ${sub === t.key ? 'active' : ''}`}
            onClick={() => setSub(t.key)}
          >
            <Icon name={t.icon} size={16} />
            <span>{t.label}</span>
          </button>
        ))}
      </div>
      <p className="subtab-desc">{active.desc}</p>

      <div className="page-body">
        {sub === 'gateway' && <PaymentTab showToast={showToast} />}
        {sub === 'qris-custom' && <QrisCustomTab showToast={showToast} />}
      </div>

      {toast && <div className={`toast ${toast.kind}`}>{toast.msg}</div>}
    </div>
  );
}
