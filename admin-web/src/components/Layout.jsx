import { useState, useEffect } from 'react';
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { clearToken, getToken } from '../api.js';
import Icon from './Icons.jsx';

const NAV = [
  { to: '/', label: 'Dashboard', icon: 'dashboard', end: true },
  { to: '/orders', label: 'Orders', icon: 'receipt' },
  { to: '/products', label: 'Produk', icon: 'package' },
  { label: 'Stok', icon: 'box', soon: true },
  { label: 'Users', icon: 'users', soon: true },
  { label: 'Saldo', icon: 'wallet', soon: true },
  { label: 'Voucher', icon: 'ticket', soon: true },
  { label: 'Broadcast', icon: 'speakerphone', soon: true },
  { label: 'Settings', icon: 'settings', soon: true }
];

export default function Layout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const [orderNotif, setOrderNotif] = useState(null);
  const current = NAV.find((n) => n.to === location.pathname) || NAV[0];

  const showToast = (msg, kind = 'ok') => {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 3200);
  };

  const logout = () => {
    clearToken();
    navigate('/login', { replace: true });
  };

  const fmtNotifyDate = (dateStr) => {
    const d = dateStr ? new Date(dateStr) : new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const day = pad(d.getDate());
    const month = pad(d.getMonth() + 1);
    const year = d.getFullYear();
    const hour = pad(d.getHours());
    const minute = pad(d.getMinutes());
    const second = pad(d.getSeconds());
    return `${day}/${month}/${year}, ${hour}.${minute}.${second} WIB`;
  };

  useEffect(() => {
    // Listen for custom toast requests from other page components
    const handleShowToast = (e) => {
      if (e.detail && e.detail.msg) {
        showToast(e.detail.msg, e.detail.kind || 'ok');
      }
    };
    window.addEventListener('show_toast', handleShowToast);

    // Setup EventSource for SSE live updates
    const token = getToken();
    if (!token) return;

    const es = new EventSource(`/api/admin/live-updates?token=${encodeURIComponent(token)}`);

    es.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === 'order_change') {
          const order = payload.data;

          // Dispatch window event so page components (Dashboard, Orders) can reload their data
          window.dispatchEvent(new CustomEvent('order_updated', { detail: order }));

          // Show in-app notification only for real transaction events (not admin actions like replace/redeliver/refund)
          const skipReasons = ['replace', 'redeliver', 'refund'];
          const successStatuses = ['paid', 'delivered', 'completed', 'success'];
          if (successStatuses.includes(order.status) && !skipReasons.includes(order._reason)) {
            setOrderNotif(order);
          }
        } else if (payload.type === 'product_change') {
          window.dispatchEvent(new CustomEvent('product_updated', { detail: payload.data }));
        }
      } catch (err) {
        console.error('Error handling SSE live update:', err);
      }
    };

    es.onerror = () => {
      // EventSource handles automatic reconnection
    };

    return () => {
      es.close();
      window.removeEventListener('show_toast', handleShowToast);
    };
  }, []);

  // Auto-dismiss in-app notification after 15 seconds
  useEffect(() => {
    if (orderNotif) {
      const t = setTimeout(() => setOrderNotif(null), 15000);
      return () => clearTimeout(t);
    }
  }, [orderNotif]);

  return (
    <div className="app">
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="brand">
          <span className="brand-logo"><Icon name="flash" size={20} stroke={2.2} /></span>
          <span className="brand-name">Store Admin</span>
        </div>
        <nav className="nav">
          {NAV.map((item) =>
            item.soon ? (
              <span key={item.label} className="nav-item disabled" title="Segera hadir">
                <span className="nav-icon"><Icon name={item.icon} size={19} /></span>
                <span>{item.label}</span>
                <span className="soon-badge">soon</span>
              </span>
            ) : (
              <NavLink
                key={item.label}
                to={item.to}
                end={item.end}
                className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                onClick={() => setOpen(false)}
              >
                <span className="nav-icon"><Icon name={item.icon} size={19} /></span>
                <span>{item.label}</span>
              </NavLink>
            )
          )}
        </nav>
        <button className="logout" onClick={logout}>
          <span className="nav-icon"><Icon name="logout" size={18} /></span> Keluar
        </button>
      </aside>

      {open && <div className="scrim" onClick={() => setOpen(false)} />}

      <div className="main">
        <header className="topbar">
          <button className="hamburger" onClick={() => setOpen((v) => !v)} aria-label="Menu"><Icon name="menu" size={22} /></button>
          <div className="topbar-title">{current.label}</div>
          <div className="topbar-right">
            <span className="dot" /> Online
          </div>
        </header>
        <div className="content">
          <Outlet />
        </div>
      </div>

      {toast && <div className={`toast ${toast.kind}`}>{toast.msg}</div>}

      {orderNotif && (
        <div className="order-notif">
          <div className="order-notif-head">
            <span className="order-notif-title"><Icon name="confetti" size={15} /> Transaksi Sukses</span>
            <button className="order-notif-close" onClick={() => setOrderNotif(null)}><Icon name="x" size={15} /></button>
          </div>
          <div className="order-notif-body">
            <div className="order-notif-item"><span><b>Order ID:</b> </span><span className="mono">{orderNotif.id}</span></div>
            <div className="order-notif-item"><span><b>User:</b> </span><span>{orderNotif.username ? `@${orderNotif.username}` : (orderNotif.first_name || 'User')} ({orderNotif.user_id})</span></div>
            <div className="order-notif-item"><span><b>Produk:</b> </span><span>{orderNotif.product_name}</span></div>
            <div className="order-notif-item"><span><b>Jumlah:</b> </span><span>{orderNotif.quantity} pcs</span></div>
            <div className="order-notif-item"><span><b>Metode:</b> </span><span className="up">{orderNotif.payment_method?.toUpperCase()}</span></div>
            <div className="order-notif-item"><span><b>Selesai:</b> </span><span>{fmtNotifyDate(orderNotif.paid_at || orderNotif.delivered_at)}</span></div>
          </div>
        </div>
      )}
    </div>
  );
}
