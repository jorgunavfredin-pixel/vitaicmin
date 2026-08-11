import { useState, useEffect, useRef } from 'react';
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { clearToken, getToken, fetchBranding } from '../api.js';
import Icon from './Icons.jsx';
import { useBroadcast } from '../context/BroadcastContext.jsx';
import './layout-enhanced.css';
import './topbar-search-inline.css';

// Sidebar dikelompokkan per section (GENERAL/MARKETING/FINANCE/BOT/SYSTEM).
// Setiap menu punya route sendiri (menu gabungan lama dipecah ke halaman masing-masing).
const NAV_SECTIONS = [
  {
    title: 'General',
    items: [
      { to: '/', label: 'Dashboard', icon: 'dashboard', end: true },
      { to: '/orders', label: 'Orders', icon: 'receipt' },
      { to: '/products', label: 'Products', icon: 'package' },
      { to: '/stock', label: 'Stock', icon: 'box' },
      { to: '/users', label: 'Customers', icon: 'users' },
    ],
  },
  {
    title: 'Marketing',
    items: [
      { to: '/vouchers', label: 'Voucher', icon: 'ticket' },
      { to: '/flash-sale', label: 'Flash Sale', icon: 'flash' },
      { to: '/broadcast', label: 'Broadcast', icon: 'speakerphone' },
    ],
  },
  {
    title: 'Finance',
    items: [
      { to: '/transactions', label: 'Transactions', icon: 'exchange' },
      { to: '/balance', label: 'Balance', icon: 'wallet' },
      { to: '/payment-gateway', label: 'Payment Gateway', icon: 'coin' },
    ],
  },
  {
    title: 'Bot',
    items: [
      { to: '/bot-settings', label: 'Bot Settings', icon: 'tool' },
      { to: '/logs', label: 'Logs', icon: 'list' },
    ],
  },
  {
    title: 'System',
    items: [
      { to: '/settings', label: 'Settings', icon: 'settings' },
    ],
  },
];

// Flat list untuk resolusi judul topbar
const NAV = NAV_SECTIONS.flatMap((s) => s.items).filter((i) => i.to);

// Item utama untuk bottom navigation mobile (4 + tombol Menu)
const BOTTOM_NAV = [
  { to: '/', label: 'Home', icon: 'dashboard', end: true },
  { to: '/orders', label: 'Orders', icon: 'receipt' },
  { to: '/products', label: 'Produk', icon: 'package' },
  { to: '/stock', label: 'Stok', icon: 'box' }
];

export default function Layout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const [orderNotif, setOrderNotif] = useState(null);
  const [connection, setConnection] = useState('connecting');
  const [notifOpen, setNotifOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [menuQuery, setMenuQuery] = useState('');
  const [branding, setBranding] = useState({ store_name: 'VITAICMIN', admin_label: 'STORE ADMIN' });
  const [notifications, setNotifications] = useState(() => {
    try { return JSON.parse(localStorage.getItem('admin_notifications') || '[]').slice(0, 20); }
    catch (_) { return []; }
  });
  const lastBroadcastStatus = useRef(null);
  const notifRef = useRef(null);
  const helpRef = useRef(null);
  const searchRef = useRef(null);
  const searchInputRef = useRef(null);
  const { job: bcJob, running: bcRunning, clear: bcClear } = useBroadcast();
  const current = NAV.find((n) => n.to === location.pathname) || NAV[0];
  const onBroadcastPage = location.pathname === '/broadcast';

  const refreshBranding = () => {
    fetchBranding().then((data) => setBranding({
      store_name: data?.store_name || 'VITAICMIN',
      admin_label: data?.admin_label || 'STORE ADMIN'
    })).catch(() => {});
  };

  useEffect(() => {
    refreshBranding();
  }, []);

  const addNotification = (item) => {
    setNotifications((prev) => {
      const next = [{ id: `${Date.now()}-${Math.random()}`, read: false, time: new Date().toISOString(), ...item }, ...prev].slice(0, 20);
      localStorage.setItem('admin_notifications', JSON.stringify(next));
      return next;
    });
  };
  const unread = notifications.filter((n) => !n.read).length;
  const markNotificationsRead = () => {
    const next = notifications.map((n) => ({ ...n, read: true }));
    setNotifications(next); localStorage.setItem('admin_notifications', JSON.stringify(next));
  };

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
    es.onopen = () => setConnection('online');

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
            addNotification({ type: 'payment', title: 'Pembayaran berhasil', detail: `${order.id} · ${order.product_name || order.product_id}`, to: '/orders' });
          }
        } else if (payload.type === 'product_change') {
          window.dispatchEvent(new CustomEvent('product_updated', { detail: payload.data }));
          addNotification({ type: 'stock', title: 'Produk atau stok diperbarui', detail: payload.data?.name_id || payload.data?.id || 'Perubahan inventory', to: '/stock' });
        } else if (payload.type === 'voucher_change') {
          window.dispatchEvent(new CustomEvent('voucher_updated', { detail: payload.data }));
        } else if (payload.type === 'balance_change' || payload.type === 'user_change') {
          window.dispatchEvent(new CustomEvent('user_updated', { detail: payload.data }));
          addNotification({ type: 'customer', title: payload.type === 'balance_change' ? 'Saldo customer berubah' : 'Data customer berubah', detail: payload.data?.user_id || payload.data?.id || 'Customer', to: '/users' });
        } else if (payload.type === 'settings_change') {
          window.dispatchEvent(new CustomEvent('settings_updated', { detail: payload.data }));
          if (payload.data?.updates && Object.prototype.hasOwnProperty.call(payload.data.updates, 'store_name')) {
            refreshBranding();
          }
        }
      } catch (err) {
        console.error('Error handling SSE live update:', err);
      }
    };

    es.onerror = () => {
      setConnection('offline');
    };

    return () => {
      es.close();
      setConnection('offline');
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

  useEffect(() => {
    const status = bcJob?.status;
    if (!status || lastBroadcastStatus.current === status) return;
    if (status === 'done' || status === 'error') {
      addNotification({ type: 'broadcast', title: status === 'done' ? 'Broadcast selesai' : 'Broadcast gagal', detail: `${bcJob.sent || 0} berhasil · ${bcJob.failed || 0} gagal`, to: '/broadcast' });
    }
    lastBroadcastStatus.current = status;
  }, [bcJob?.status]);

  useEffect(() => {
    const key = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault(); setSearchOpen(true); setTimeout(() => searchInputRef.current?.focus(), 0);
      }
      if (e.key === 'Escape') { setSearchOpen(false); setMenuQuery(''); setNotifOpen(false); setHelpOpen(false); }
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, []);

  useEffect(() => {
    const outside = (e) => {
      if (notifOpen && !notifRef.current?.contains(e.target)) setNotifOpen(false);
      if (helpOpen && !helpRef.current?.contains(e.target)) setHelpOpen(false);
      if (searchOpen && !searchRef.current?.contains(e.target)) { setSearchOpen(false); setMenuQuery(''); }
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [notifOpen, helpOpen, searchOpen]);

  const menuResults = NAV_SECTIONS.flatMap((s) => s.items.map((i) => ({ ...i, section: s.title })))
    .filter((i) => !menuQuery || `${i.label} ${i.section}`.toLowerCase().includes(menuQuery.toLowerCase()));
  const goMenu = (to) => { navigate(to); setSearchOpen(false); setMenuQuery(''); };

  return (
    <div className="app">
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="brand">
          <span className="brand-logo"><Icon name="shield" size={20} stroke={2.2} /></span>
          <span className="brand-text">
            <span className="brand-name">{branding.store_name}</span>
            <span className="brand-sub">{branding.admin_label}</span>
          </span>
        </div>
        <nav className="nav">
          {NAV_SECTIONS.map((section) => (
            <div key={section.title} className="nav-section">
              <div className="nav-section-label">{section.title}</div>
              {section.items.map((item) =>
                item.soon ? (
                  <span key={item.label} className="nav-item disabled" title="Segera hadir">
                    <span className="nav-icon"><Icon name={item.icon} size={18} /></span>
                    <span className="nav-text">{item.label}</span>
                    <span className="soon-badge">Soon</span>
                  </span>
                ) : (
                  <NavLink
                    key={item.label}
                    to={item.to}
                    end={item.end}
                    className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                    onClick={() => setOpen(false)}
                  >
                    <span className="nav-icon"><Icon name={item.icon} size={18} /></span>
                    <span className="nav-text">{item.label}</span>
                  </NavLink>
                )
              )}
            </div>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="sf-avatar">A</div>
          <div className="sf-info">
            <div className="sf-name">Administrator</div>
            <div className="sf-role">Super Admin</div>
          </div>
          <button className="sf-logout" onClick={logout} title="Keluar">
            <Icon name="logout" size={17} />
          </button>
        </div>
      </aside>

      {open && <div className="scrim" onClick={() => setOpen(false)} />}

      <div className="main">
        <header className="topbar">
          <button className="hamburger" onClick={() => setOpen((v) => !v)} aria-label="Menu" aria-expanded={open}><Icon name="menu" size={22} /></button>
          <div className="topbar-titlewrap">
            <div className="topbar-title">{current.label}</div>
            <div className="topbar-sub">Overview toko kamu</div>
          </div>
          <div className={`topbar-search-wrap ${searchOpen ? 'open' : ''}`} ref={searchRef} onClick={() => { setSearchOpen(true); setTimeout(() => searchInputRef.current?.focus(), 0); }}>
            <div className="topbar-search">
              <Icon name="search" size={15} />
              <input ref={searchInputRef} value={menuQuery} onFocus={() => setSearchOpen(true)} onChange={(e) => { setMenuQuery(e.target.value); setSearchOpen(true); }} placeholder="Cari menu & submenu…" aria-label="Cari menu" />
              {menuQuery ? <button className="topbar-search-clear" onClick={() => { setMenuQuery(''); searchInputRef.current?.focus(); }} aria-label="Hapus pencarian"><Icon name="x" size={13}/></button> : <span className="topbar-kbd">⌘K</span>}
            </div>
            {searchOpen && <SearchSuggestions results={menuResults} query={menuQuery} go={goMenu} />}
          </div>
          <div className="topbar-right">
            <div className="topbar-pop-wrap" ref={notifRef}>
              <button className={`topbar-iconbtn ${notifOpen ? 'active' : ''}`} aria-label="Notifikasi" onClick={() => { setNotifOpen(v => !v); setHelpOpen(false); if (!notifOpen) markNotificationsRead(); }}>
                <Icon name="speakerphone" size={17} />{unread > 0 && <span className="topbar-badge">{unread > 99 ? '99+' : unread}</span>}
              </button>
              {notifOpen && <NotificationPopover items={notifications} navigate={navigate} close={() => setNotifOpen(false)} clear={() => { setNotifications([]); localStorage.removeItem('admin_notifications'); }} />}
            </div>
            <div className="topbar-pop-wrap" ref={helpRef}>
              <button className={`topbar-iconbtn ${helpOpen ? 'active' : ''}`} aria-label="Bantuan" onClick={() => { setHelpOpen(v => !v); setNotifOpen(false); }}><Icon name="info" size={17} /></button>
              {helpOpen && <HelpPopover connection={connection} />}
            </div>
            <span className={`topbar-status ${connection}`} title="Status koneksi realtime"><span className="dot" /> {connection === 'online' ? 'Online' : connection === 'offline' ? 'Offline' : 'Menghubungkan'}</span>
          </div>
        </header>
        <div className="content">
          <Outlet />
        </div>
      </div>

      {/* Bottom navigation — hanya tampil di mobile (via CSS) */}
      <nav className="bottom-nav">
        {BOTTOM_NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) => `bnav-item ${isActive ? 'active' : ''}`}
          >
            <span className="bnav-icon"><Icon name={item.icon} size={22} /></span>
            <span className="bnav-label">{item.label}</span>
          </NavLink>
        ))}
        <button
          className={`bnav-item ${open ? 'active' : ''}`}
          onClick={() => setOpen(true)}
          aria-label="Menu lainnya"
        >
          <span className="bnav-icon"><Icon name="menu" size={22} /></span>
          <span className="bnav-label">Menu</span>
        </button>
      </nav>

      {toast && <div className={`toast ${toast.kind}`}>{toast.msg}</div>}

      {/* Indikator broadcast global — muncul di semua menu kecuali halaman Broadcast sendiri */}
      {bcJob && !onBroadcastPage && (
        <div className={`bc-float ${bcJob.status === 'error' ? 'err' : ''} ${bcJob.status === 'done' ? 'done' : ''}`}>
          <div className="bc-float-head">
            <span className="bc-float-title">
              <Icon name="speakerphone" size={14} />
              {bcRunning ? 'Broadcast berjalan…' : bcJob.status === 'done' ? 'Broadcast selesai' : 'Broadcast gagal'}
            </span>
            <span className="bc-float-actions">
              <button className="bc-float-btn" title="Buka halaman Broadcast" onClick={() => navigate('/broadcast')}>
                <Icon name="eye" size={14} />
              </button>
              {!bcRunning && (
                <button className="bc-float-btn" title="Tutup" onClick={bcClear}><Icon name="x" size={14} /></button>
              )}
            </span>
          </div>
          <div className="bc-float-bar-wrap">
            <div className={`bc-float-bar ${bcJob.status === 'error' ? 'err' : ''}`} style={{ width: `${bcJob.pct || 0}%` }} />
          </div>
          <div className="bc-float-stats">
            <span>{bcJob.pct || 0}% · {bcJob.processed || 0}/{bcJob.total}</span>
            <span className="bc-float-rep">
              <span className="bc-rep-ok">✓ {bcJob.sent || 0}</span>
              <span className="bc-rep-fail">✕ {bcJob.failed || 0}</span>
            </span>
          </div>
        </div>
      )}

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

function NotificationPopover({ items, navigate, close, clear }) {
  return <div className="topbar-pop notification-pop"><div className="topbar-pop-head"><div><b>Notifikasi</b><span>{items.length ? `${items.length} aktivitas terakhir` : 'Belum ada notifikasi'}</span></div>{items.length > 0 && <button onClick={clear}>Bersihkan</button>}</div><div className="notification-list">{items.length === 0 ? <div className="topbar-pop-empty"><Icon name="speakerphone" size={22}/><span>Aktivitas penting akan muncul di sini.</span></div> : items.map(n => <button key={n.id} className="notification-item" onClick={() => { if (n.to) navigate(n.to); close(); }}><span className={`notification-icon ${n.type}`}><Icon name={n.type === 'payment' ? 'cash' : n.type === 'stock' ? 'box' : n.type === 'customer' ? 'user' : 'speakerphone'} size={14}/></span><span className="notification-copy"><b>{n.title}</b><small>{n.detail}</small><time>{new Date(n.time).toLocaleString('id-ID',{hour:'2-digit',minute:'2-digit',day:'2-digit',month:'short'})}</time></span></button>)}</div></div>;
}

function HelpPopover({ connection }) {
  return <div className="topbar-pop help-pop"><div className="topbar-pop-head"><div><b>Bantuan Cepat</b><span>Informasi panel admin</span></div></div><div className="help-status"><span className={`dot ${connection}`}/><div><b>{connection === 'online' ? 'Sistem terhubung' : connection === 'offline' ? 'Koneksi terputus' : 'Sedang menghubungkan'}</b><small>Status realtime Web Admin</small></div></div><div className="help-shortcut"><span>Command Palette</span><kbd>Ctrl / ⌘ + K</kbd></div><a className="help-developer" href="https://t.me/GREEBEL" target="_blank" rel="noreferrer"><Icon name="speakerphone" size={16}/><span><b>Hubungi Developer</b><small>@GREEBEL via Telegram</small></span><Icon name="chevron" size={15}/></a></div>;
}

function SearchSuggestions({ results, query, go }) {
  return <div className="topbar-suggestions"><div className="suggestion-head"><span>{query ? `Hasil untuk “${query}”` : 'Menu & submenu'}</span><small>{results.length} hasil</small></div><div className="suggestion-list">{results.length ? results.map(r=><button key={r.to} onClick={(e)=>{ e.stopPropagation(); go(r.to); }}><span className="suggestion-icon"><Icon name={r.icon} size={16}/></span><span><b>{r.label}</b><small>{r.section}</small></span><Icon name="chevron" size={14}/></button>) : <div className="suggestion-empty">Menu tidak ditemukan</div>}</div><div className="suggestion-foot">Klik menu untuk membuka · ESC untuk menutup</div></div>;
}
