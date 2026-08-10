import { useEffect, useState, useCallback, useMemo } from 'react';
import { fetchBalances, fetchBalanceHistory } from '../api.js';
import Icon from '../components/Icons.jsx';
import { SkeletonTable } from '../components/Skeleton.jsx';
import './balance/balance.css';

const rupiah = (n) => 'Rp ' + new Intl.NumberFormat('id-ID').format(Math.round(Math.abs(n || 0)));
const fmtDate = (iso) => iso ? new Date(iso).toLocaleString('id-ID', {
  timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
}) : '-';
const initial = (u) => (u.name || u.username || '?').trim().charAt(0).toUpperCase();

function StatCard({ icon, label, value, sub, cls = '' }) {
  return <div className={`stat-card ${cls}`}><div className="stat-head"><div className="stat-icon"><Icon name={icon} size={20}/></div></div><div className="stat-body"><div className="stat-label">{label}</div><div className="stat-value">{value}</div><div className="stat-sub">{sub}</div></div></div>;
}

function LocalPager({ page, totalPages, total, setPage }) {
  if (totalPages <= 1) return null;
  const go = n => setPage(Math.max(1, Math.min(totalPages, n)));
  return <div className="balance-pager"><span>Menampilkan {Math.min(total, (page - 1) * 25 + 1)}–{Math.min(total, page * 25)} dari {total}</span><div><button disabled={page === 1} onClick={()=>go(page-1)}>‹</button><b>Hal {page} / {totalPages}</b><button disabled={page === totalPages} onClick={()=>go(page+1)}>›</button></div></div>;
}

function BalanceDetail({ user, onClose }) {
  const [rows, setRows] = useState(null); const [err, setErr] = useState('');
  useEffect(() => { setRows(null); setErr(''); fetchBalanceHistory(user.user_id).then(d=>setRows(d.items||[])).catch(e=>setErr(e.message)); }, [user.user_id]);
  useEffect(() => { const h=e=>e.key==='Escape'&&onClose(); window.addEventListener('keydown',h); return()=>window.removeEventListener('keydown',h); }, [onClose]);
  return <div className="dock-panel balance-detail-panel">
    <div className="dock-head"><h3>Riwayat Saldo</h3><button className="x" onClick={onClose} aria-label="Tutup"><Icon name="x"/></button></div>
    <div className="dock-body">
      <div className="balance-detail-hero"><span className="balance-avatar">{initial(user)}</span><div><div className="balance-detail-name">{user.name}</div><div className="balance-detail-user">{user.username?'@'+user.username:`ID ${user.user_id}`}</div></div></div>
      <div className="balance-current"><span>Saldo Saat Ini</span><b>{rupiah(user.balance)}</b></div>
      <div className="od-section"><div className="od-section-title">INFORMASI CUSTOMER</div><div className="od-summary"><div className="od-sum-cell"><span className="od-sum-label">User ID</span><b className="od-sum-value mono">{user.user_id}</b></div><div className="od-sum-cell"><span className="od-sum-label">Username</span><b className="od-sum-value">{user.username?'@'+user.username:'—'}</b></div></div></div>
      <div className="od-section"><div className="od-section-title">MUTASI SALDO {rows ? `· ${rows.length}` : ''}</div>
        {err&&<div className="empty error-panel hint-icon"><Icon name="warning" size={16}/>{err}</div>}
        {!rows&&!err&&<div className="empty">Memuat…</div>}
        {rows?.length===0&&<div className="balance-empty">Belum ada mutasi saldo</div>}
        {rows?.length>0&&<div className="balance-history-list">{rows.map(r=><div key={r.id} className="balance-history-item"><span className={`balance-history-icon ${(r.amount||0)>=0?'positive':'negative'}`}><Icon name={(r.amount||0)>=0?'plus':'minus'} size={14}/></span><div className="balance-history-main"><div>{r.note||r.type}</div><small>{fmtDate(r.created_at)}{r.method?` · ${r.method}`:''}</small></div><b className={(r.amount||0)>=0?'positive':'negative'}>{(r.amount||0)>=0?'+':'−'}{rupiah(r.amount)}</b></div>)}</div>}
      </div>
    </div>
  </div>;
}

export default function Balance() {
  const [q,setQ]=useState(''); const [data,setData]=useState(null); const [loading,setLoading]=useState(false); const [error,setError]=useState(''); const [selected,setSelected]=useState(null); const [page,setPage]=useState(1);
  const load=useCallback(()=>{setLoading(true);fetchBalances(q).then(d=>{setData(d);setError('');setPage(1);}).catch(e=>setError(e.message)).finally(()=>setLoading(false));},[q]);
  useEffect(()=>{const t=setTimeout(load,q?300:0);return()=>clearTimeout(t);},[load,q]);
  const items=data?.items||[]; const totalPages=Math.max(1,Math.ceil(items.length/25)); const visible=useMemo(()=>items.slice((page-1)*25,page*25),[items,page]); const s=data?.summary||{};
  return <div className={`balance-workspace ${selected?'dock-open':''}`}><div className="balance-main">
    <div className="page-head"><div><h2 className="page-title">Balance</h2><p className="page-sub">Pantau saldo customer dan riwayat mutasi</p></div></div>
    <div className="stat-grid balance-stat-grid"><StatCard icon="wallet" label="Total Saldo Beredar" value={rupiah(s.totalBalance)} sub="seluruh customer" cls="balance-value-stat"/><StatCard icon="users" label="Customer Punya Saldo" value={(s.withBalance||0).toLocaleString('id-ID')} sub="saldo lebih dari Rp 0"/><StatCard icon="user" label="Total Customer" value={(s.totalUsers||0).toLocaleString('id-ID')} sub="customer terdaftar"/></div>
    <div className="balance-toolbar"><div className="search balance-search"><span className="search-icon"><Icon name="search" size={15}/></span><input placeholder="Cari user ID / nama / username…" value={q} onChange={e=>{setQ(e.target.value);setSelected(null);}}/></div><span className="balance-result-count">{items.length.toLocaleString('id-ID')} customer</span></div>
    <div className="panel no-pad balance-table-card">{error?<div className="empty error-panel hint-icon"><Icon name="warning" size={16}/>{error}</div>:loading&&!data?<SkeletonTable rows={8} cols={5}/>:visible.length===0?<div className="empty">Tidak ada data saldo</div>:<div className="table-wrap balance-desktop-table"><table className="table balance-table"><thead><tr><th>Customer</th><th>Username</th><th>User ID</th><th>Saldo</th><th></th></tr></thead><tbody>{visible.map(u=><tr key={u.user_id} className={selected?.user_id===u.user_id?'row-active':''} onClick={()=>setSelected(u)}><td><div className="balance-user-cell"><span className="balance-avatar small">{initial(u)}</span><b>{u.name}</b></div></td><td className="link-cell">{u.username?'@'+u.username:'—'}</td><td className="mono">{u.user_id}</td><td className="amt-cell">{rupiah(u.balance)}</td><td className="act-cell"><button className="row-act" aria-label="Riwayat" onClick={e=>{e.stopPropagation();setSelected(u)}}><Icon name="clock" size={16}/></button></td></tr>)}</tbody></table></div>}</div>
    {visible.length>0&&<div className="balance-mobile-list">{visible.map(u=><button key={u.user_id} className="balance-card" onClick={()=>setSelected(u)}><span className="balance-avatar">{initial(u)}</span><span className="balance-card-main"><span className="balance-card-top"><b>{u.name}</b><strong>{rupiah(u.balance)}</strong></span><span className="balance-card-sub">{u.username?'@'+u.username:`ID ${u.user_id}`}</span><span className="balance-card-id mono">{u.user_id}</span></span><Icon name="chevron" size={16}/></button>)}</div>}
    <LocalPager page={page} totalPages={totalPages} total={items.length} setPage={p=>{setPage(p);setSelected(null);}}/>
  </div><aside className="balance-detail-dock" aria-hidden={!selected}>{selected&&<BalanceDetail user={selected} onClose={()=>setSelected(null)}/>}</aside></div>;
}
