import { useEffect, useState, useCallback, useRef } from 'react';
import {
  fetchOrder, redeliverOrder, replaceOrder, refundOrder, deleteOrder
} from '../../api.js';
import Icon from '../../components/Icons.jsx';
import { badge, rupiah, fmtDate, STATUS } from './utils.jsx';
import { TimelineItem } from './OrderTimeline.jsx';
import DeliveredData, { CopyBtn, CopyAllBtn } from './DeliveredData.jsx';

export default function OrderDrawer({ id, onClose, onChanged, toast }) {
  const [order, setOrder] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const [confirm, setConfirm] = useState(null);
  const qtyRef = useRef(null);

  // Escape menutup drawer (spec: accessibility)
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { if (confirm) setConfirm(null); else onClose(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, confirm]);

  const load = useCallback(() => {
    fetchOrder(id).then(setOrder).catch((e) => setErr(e.message));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const handleUpdate = (e) => {
      if (e.detail && e.detail.id === id) {
        load();
      }
    };
    window.addEventListener('order_updated', handleUpdate);
    return () => window.removeEventListener('order_updated', handleUpdate);
  }, [id, load]);

  const run = async (action, fn) => {
    setBusy(action);
    try {
      const r = await fn(id);
      toast(r.message || 'Berhasil');
      setConfirm(null);
      load();
      onChanged();
      if (action === 'delete') onClose();
    } catch (e) {
      toast(e.message, 'err');
    } finally {
      setBusy('');
    }
  };

  const runReplace = async (count) => {
    setBusy('replace');
    try {
      const r = await replaceOrder(id, count);
      toast(r.message || 'Berhasil');
      setConfirm(null);
      load();
      onChanged();
    } catch (e) {
      toast(e.message, 'err');
    } finally {
      setBusy('');
    }
  };

  // Setelah refund: akun sudah ditarik balik ke admin, jadi kirim ulang & replace TIDAK boleh lagi.
  // Order refunded hanya menyisakan opsi Hapus.
  const isRefunded = order?.status === 'refunded';
  const actions = order ? [
    { key: 'redeliver', icon: 'refresh', label: 'Resend', fn: redeliverOrder, show: !isRefunded && order.delivered_data?.length > 0, cls: 'a-blue' },
    { key: 'replace', icon: 'exchange', label: 'Replace', fn: replaceOrder, show: !isRefunded && order.status === 'delivered', cls: 'a-violet' },
    { key: 'refund', icon: 'arrow-back', label: 'Refund', fn: refundOrder, show: ['delivered', 'paid'].includes(order.status), danger: true, cls: 'a-amber' },
    { key: 'delete', icon: 'trash', label: 'Delete', fn: deleteOrder, show: true, danger: true, cls: 'a-red' }
  ].filter(a => a.show) : [];


  return (
    <>
      <div className="dock-panel">
        <div className="dock-head">
          <h3>Detail Order</h3>
          <button className="x" onClick={onClose} aria-label="Tutup detail"><Icon name="x" /></button>
        </div>

        {err && <div className="empty error-panel hint-icon"><Icon name="warning" size={16} /> {err}</div>}
        {!order && !err && (
          <div className="dock-body">
            <div className="skeleton-card" style={{ height: 70 }} />
            <div className="skeleton-card" style={{ height: 90 }} />
            <div className="skeleton-card" style={{ height: 120 }} />
          </div>
        )}

        {order && (
          <div className="dock-body">
            {/* HERO SUMMARY */}
            <div className="od-hero">
              <div className="od-hero-top">
                <span className="od-hero-id mono">{order.id}</span>
                {badge(order.status)}
              </div>
              <div className="od-hero-meta">
                <span className="ohm-item"><Icon name="clock" size={13} /> {fmtDate(order.created_at)}</span>
                <span className="ohm-item up"><Icon name="wallet" size={13} /> {order.payment_method || '-'}</span>
              </div>
            </div>

            {/* RINGKASAN — 4 kolom: label atas, value bawah */}
            <div className="od-section">
              <div className="od-section-title">Ringkasan</div>
              <div className="od-summary">
                <div className="od-sum-cell">
                  <span className="od-sum-label">Total</span>
                  <b className="od-sum-value">{rupiah(order.total_idr)}</b>
                  {order.total_usd != null && <span className="od-sum-sub">≈ ${order.total_usd}</span>}
                </div>
                <div className="od-sum-cell">
                  <span className="od-sum-label">Metode</span>
                  <b className="od-sum-value up">{order.payment_method || '-'}</b>
                </div>
                {order.product_id !== 'TOPUP' && (
                  <div className="od-sum-cell">
                    <span className="od-sum-label">Qty</span>
                    <b className="od-sum-value">{order.quantity}</b>
                  </div>
                )}
                <div className="od-sum-cell">
                  <span className="od-sum-label">Status</span>
                  <span className="od-sum-value">{badge(order.status)}</span>
                </div>
              </div>
            </div>

            {/* PRODUK */}
            <div className="od-section">
              <div className="od-section-title">Produk</div>
              <div className="od-product">
                <div className="od-prod-thumb">{order.product_id === 'TOPUP' ? <Icon name="wallet" size={18} /> : (order.product_name || '?').charAt(0).toUpperCase()}</div>
                <div className="od-prod-info">
                  <div className="od-prod-name">{order.product_name}</div>
                  {order.product_id !== 'TOPUP' && <div className="od-prod-sub">{order.quantity} × {rupiah(Math.round((order.total_idr || 0) / (order.quantity || 1)))}</div>}
                </div>
                <div className="od-prod-total">{rupiah(order.total_idr)}</div>
              </div>
            </div>

            {/* CUSTOMER */}
            <div className="od-section">
              <div className="od-section-title">Customer</div>
              <div className="od-customer">
                <div className="od-cust-avatar">{(order.user?.first_name || order.user?.username || 'U').charAt(0).toUpperCase()}</div>
                <div className="od-cust-info">
                  <div className="od-cust-name">{order.user?.username ? '@' + order.user.username : (order.user?.first_name || 'Unknown')}</div>
                  <div className="od-cust-id mono">ID: {order.user_id} <CopyBtn text={String(order.user_id)} /></div>
                </div>
              </div>
            </div>

            {/* TIMELINE */}
            <div className="od-section">
              <div className="od-section-title">Timeline</div>
              <div className="od-timeline">
                <TimelineItem label="Order dibuat" time={order.created_at} done />
                {order.paid_at && <TimelineItem label="Pembayaran berhasil" time={order.paid_at} done ok />}
                {order.delivered_at && <TimelineItem label="Terkirim" time={order.delivered_at} done ok />}
                {order.status === 'refunded' && <TimelineItem label="Refund" time={order.refunded_at || order.delivered_at} done danger last />}
                {order.status === 'cancelled' && <TimelineItem label="Dibatalkan" time={order.created_at} done danger last />}
                {order.status === 'expired' && <TimelineItem label="Kadaluarsa" time={order.created_at} done danger last />}
              </div>
            </div>

            {/* DATA TERKIRIM — satu-satunya section yang scroll sendiri */}
            {order.delivered_data?.length > 0 && (
              <div className="od-section od-section-scroll">
                <div className="od-section-titlerow">
                  <span className="od-section-title hint-icon"><Icon name="clipboard" size={14} /> Data Terkirim ({order.delivered_data.length})</span>
                  <CopyAllBtn items={order.delivered_data} />
                </div>
                <div className="d-accounts">
                  <DeliveredData items={order.delivered_data} />
                </div>
                {order.status === 'delivered' && (
                  <div className="od-stock-note hint-icon"><Icon name="box" size={13} /> Stok tersedia untuk replace: <b>{order.available_stock}</b></div>
                )}
              </div>
            )}

            {/* Kalau tidak ada data terkirim, tetap tampilkan stock note (delivered) */}
            {(!order.delivered_data || order.delivered_data.length === 0) && order.status === 'delivered' && (
              <div className="d-hint hint-icon"><Icon name="box" size={14} /> Stok tersedia untuk replace: <b>{order.available_stock}</b></div>
            )}
          </div>
        )}

        {/* ACTIONS — sticky footer */}
        {order && actions.length > 0 && (
          <div className="dock-footer">
            <div className="od-actions">
              {actions.map((a) => (
                <button
                  key={a.key}
                  className={`a-btn btn-icon ${a.cls}`}
                  disabled={!!busy}
                  onClick={() => (a.danger || a.key === 'replace') ? setConfirm(a) : run(a.key, a.fn)}
                >
                  {busy === a.key ? '…' : <><Icon name={a.icon} size={15} /> {a.label}</>}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>{/* /dock-panel */}

      {confirm && (
        <div className="modal-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) setConfirm(null); }}>
          <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
            <div className={`modal-icon ${confirm.key === 'replace' ? '' : 'modal-icon-danger'}`}><Icon name={confirm.key === 'replace' ? 'exchange' : 'warning'} size={30} /></div>
            <h4>{confirm.label}?</h4>
            {confirm.key === 'replace' ? (
              <div style={{ margin: '14px 0', textAlign: 'left' }}>
                <label style={{ marginBottom: 8, display: 'block', fontSize: 13, color: '#8a93a6' }}>
                  Jumlah akun yang ingin dikirim:
                </label>
                <input
                  ref={qtyRef}
                  type="text"
                  inputMode="numeric"
                  placeholder="Masukkan jumlah"
                  defaultValue="1"
                  className="qty-field"
                />
                <div style={{ marginTop: '8px', fontSize: '12px', color: '#8a93a6' }}>
                  Maksimal: <b>{order.available_stock}</b> (stok tersedia)
                </div>
              </div>
            ) : (
              <p>
                {confirm.key === 'refund' && 'Akun yang sudah terkirim ditarik balik ke stok admin & user diberi notifikasi refund. Setelah ini order hanya bisa dihapus (tidak bisa kirim ulang / replace).'}
                {confirm.key === 'delete' && 'Order dihapus permanen. Aksi ini tidak bisa dibatalkan.'}
              </p>
            )}
            <div className="modal-actions">
              <button className="btn-ghost" onClick={() => setConfirm(null)}>Batal</button>
              <button
                className={confirm.key === 'replace' ? 'btn-primary' : 'btn-danger'}
                disabled={!!busy || (confirm.key === 'replace' && order.available_stock === 0)}
                onClick={() => {
                  if (confirm.key === 'replace') {
                    const val = parseInt(qtyRef.current?.value);
                    if (!val || val < 1) return toast('Jumlah harus minimal 1', 'err');
                    if (val > order.available_stock) return toast(`Stok tidak cukup! Maksimal ${order.available_stock}`, 'err');
                    runReplace(val);
                  } else {
                    run(confirm.key, confirm.fn);
                  }
                }}
              >
                {busy ? 'Memproses…' : 'Ya, Lanjut'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
