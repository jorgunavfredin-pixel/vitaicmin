import { useEffect, useState, useCallback } from 'react';
import { fetchTransactions } from '../api.js';
import Icon from '../components/Icons.jsx';
import { SkeletonTable } from '../components/Skeleton.jsx';
import './transactions/transactions.css';

const rupiah = (n) => 'Rp ' + new Intl.NumberFormat('id-ID').format(Math.round(Math.abs(n || 0)));
const fmtDate = (iso) => iso ? new Date(iso).toLocaleString('id-ID', {
  timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
}) : '-';

const STATUS = {
  paid: { label: 'Dibayar', cls: 'st-paid' }, delivered: { label: 'Terkirim', cls: 'st-delivered' },
  pending: { label: 'Pending', cls: 'st-pending' }, processing: { label: 'Proses', cls: 'st-pending' },
  cancelled: { label: 'Batal', cls: 'st-cancelled' }, expired: { label: 'Kadaluarsa', cls: 'st-expired' },
  refunded: { label: 'Refund', cls: 'st-cancelled' }, init: { label: 'Draft', cls: 'st-muted' },
  credit: { label: 'Masuk', cls: 'st-delivered' }, debit: { label: 'Keluar', cls: 'st-cancelled' },
};
const statusMeta = (s) => STATUS[s] || { label: s || '-', cls: 'st-muted' };
const badge = (s) => { const m = statusMeta(s); return <span className={`badge ${m.cls}`}>{m.label}</span>; };
const FILTERS = [{ key: 'all', label: 'Semua' }, { key: 'order', label: 'Order' }, { key: 'balance', label: 'Saldo' }];

function StatCard({ icon, label, value, sub }) {
  return <div className="stat-card"><div className="stat-head"><div className="stat-icon"><Icon name={icon} size={20} /></div></div><div className="stat-body"><div className="stat-label">{label}</div><div className="stat-value">{value}</div><div className="stat-sub">{sub}</div></div></div>;
}

function Pagination({ page, totalPages, pageSize, setPage, setPageSize, total }) {
  const keep = new Set([1, totalPages]);
  for (let i = Math.max(1, page - 2); i <= Math.min(totalPages, page + 2); i++) keep.add(i);
  const nums = [...keep].sort((a, b) => a - b);
  const parts = [];
  nums.forEach((n, i) => { if (i && n - nums[i - 1] > 1) parts.push('…'); parts.push(n); });
  const go = (n) => setPage(Math.min(totalPages, Math.max(1, n)));
  return <div className="tx-pagination">
    <div className="tx-page-info"><span>{total.toLocaleString('id-ID')} transaksi</span><select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }} aria-label="Transaksi per halaman">{[10,25,50,100].map(n => <option key={n} value={n}>{n} / halaman</option>)}</select></div>
    <div className="tx-page-buttons">
      <button disabled={page <= 1} onClick={() => go(page - 5)} aria-label="Mundur 5 halaman">«</button>
      <button disabled={page <= 1} onClick={() => go(page - 1)} aria-label="Halaman sebelumnya">‹</button>
      {parts.map((x, i) => x === '…' ? <span key={`e${i}`} className="tx-ellipsis">…</span> : <button key={x} className={page === x ? 'active' : ''} onClick={() => go(x)}>{x}</button>)}
      <button disabled={page >= totalPages} onClick={() => go(page + 1)} aria-label="Halaman berikutnya">›</button>
      <button disabled={page >= totalPages} onClick={() => go(page + 5)} aria-label="Maju 5 halaman">»</button>
    </div>
  </div>;
}

function TransactionDetail({ tx, onClose }) {
  useEffect(() => { const h = (e) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, [onClose]);
  const negative = tx.kind === 'balance' && tx.amount < 0;
  return <div className="dock-panel tx-detail-panel">
    <div className="dock-head"><h3>Detail Transaksi</h3><button className="x" onClick={onClose} aria-label="Tutup"><Icon name="x" /></button></div>
    <div className="dock-body">
      <div className="tx-detail-hero"><div className={`tx-detail-icon ${tx.kind}`}><Icon name={tx.kind === 'order' ? 'receipt' : 'wallet'} size={20} /></div><div><div className="tx-detail-kind">{tx.kind === 'order' ? 'Transaksi Order' : 'Mutasi Saldo'}</div><div className={`tx-detail-amount ${negative ? 'negative' : ''}`}>{tx.kind === 'balance' ? (tx.amount >= 0 ? '+' : '−') : ''}{rupiah(tx.amount)}</div></div>{badge(tx.status)}</div>
      <div className="od-section"><div className="od-section-title">RINGKASAN</div><div className="od-summary">
        <div className="od-sum-cell"><span className="od-sum-label">ID Transaksi</span><b className="od-sum-value mono">{tx.id}</b></div>
        <div className="od-sum-cell"><span className="od-sum-label">User ID</span><b className="od-sum-value mono">{tx.user_id}</b></div>
        <div className="od-sum-cell"><span className="od-sum-label">Metode</span><b className="od-sum-value up">{tx.method || '-'}</b></div>
        <div className="od-sum-cell"><span className="od-sum-label">Tanggal</span><b className="od-sum-value">{fmtDate(tx.created_at)}</b></div>
      </div></div>
      <div className="od-section"><div className="od-section-title">KETERANGAN</div><div className="tx-detail-label">{tx.label || '-'}</div></div>
      {tx.balance_after != null && <div className="od-section"><div className="od-section-title">SALDO SETELAH TRANSAKSI</div><div className="tx-balance-after">{rupiah(tx.balance_after)}</div></div>}
    </div>
  </div>;
}

export default function Transactions() {
  const [type, setType] = useState('all'); const [q, setQ] = useState(''); const [page, setPage] = useState(1); const [pageSize, setPageSize] = useState(25);
  const [data, setData] = useState(null); const [loading, setLoading] = useState(false); const [error, setError] = useState(''); const [selected, setSelected] = useState(null);
  const load = useCallback(() => { setLoading(true); fetchTransactions({ type, q, page, pageSize }).then(d => { setData(d); setError(''); }).catch(e => setError(e.message)).finally(() => setLoading(false)); }, [type, q, page, pageSize]);
  useEffect(() => { const t = setTimeout(load, q ? 300 : 0); return () => clearTimeout(t); }, [load, q]);
  const s = data?.summary || {};
  return <div className={`transactions-workspace ${selected ? 'dock-open' : ''}`}><div className="transactions-main">
    <div className="page-head"><div><h2 className="page-title">Transactions</h2><p className="page-sub">{data ? `${data.total.toLocaleString('id-ID')} transaksi keuangan` : 'Memuat…'}</p></div></div>
    <div className="stat-grid tx-stat-grid"><StatCard icon="cash" label="Total Pendapatan" value={rupiah(s.totalIncome)} sub="dari penjualan produk"/><StatCard icon="wallet" label="Total Top-up Saldo" value={rupiah(s.topupTotal)} sub="saldo masuk"/><StatCard icon="receipt" label="Transaksi Order" value={(s.orderCount || 0).toLocaleString('id-ID')} sub="catatan order"/><StatCard icon="exchange" label="Mutasi Saldo" value={(s.balanceCount || 0).toLocaleString('id-ID')} sub="catatan saldo"/></div>
    <div className="transactions-toolbar"><div className="chips">{FILTERS.map(f => <button key={f.key} className={`chip ${type === f.key ? 'active' : ''}`} onClick={() => { setType(f.key); setPage(1); setSelected(null); }}>{f.label}</button>)}</div><div className="search tx-search"><span className="search-icon"><Icon name="search" size={15}/></span><input placeholder="Cari ID / user / produk…" value={q} onChange={e => { setQ(e.target.value); setPage(1); }}/></div></div>
    <div className="panel no-pad tx-table-card">{error ? <div className="empty error-panel hint-icon"><Icon name="warning" size={16}/>{error}</div> : loading && !data ? <SkeletonTable rows={8} cols={8}/> : <div className="table-wrap tx-desktop-table"><table className="table transactions-table"><thead><tr><th>ID</th><th>Tipe</th><th>Keterangan</th><th>User</th><th>Nominal</th><th>Metode</th><th>Status</th><th>Tanggal</th></tr></thead><tbody>{data?.items.length === 0 ? <tr><td colSpan={8} className="empty">Tidak ada transaksi</td></tr> : data?.items.map(t => <tr key={`${t.kind}-${t.id}`} className={selected?.id === t.id && selected.kind === t.kind ? 'row-active' : ''} onClick={() => setSelected(t)}><td className="mono">{t.id}</td><td><span className={`tx-kind ${t.kind}`}>{t.kind === 'order' ? 'Order' : 'Saldo'}</span></td><td className="ellip">{t.label}</td><td className="mono">{t.user_id}</td><td className={`amt-cell ${t.kind === 'balance' && t.amount < 0 ? 'amt-neg' : ''}`}>{t.kind === 'balance' ? (t.amount >= 0 ? '+' : '−') : ''}{rupiah(t.amount)}</td><td className="up">{t.method}</td><td>{badge(t.status)}</td><td className="muted-cell">{fmtDate(t.created_at)}</td></tr>)}</tbody></table></div>}</div>
    {data && data.items.length > 0 && <div className="transactions-mobile-list">{data.items.map(t => { const neg=t.kind==='balance'&&t.amount<0; return <button key={`${t.kind}-${t.id}`} className="transaction-card" onClick={() => setSelected(t)}><span className="tx-card-top"><span className="mono tx-card-id">{t.id}</span>{badge(t.status)}</span><span className="tx-card-label">{t.label}</span><span className="tx-card-meta"><span>{t.kind==='order'?'Order':'Saldo'} · {String(t.method||'-').toUpperCase()}</span><b className={neg?'negative':''}>{t.kind==='balance'?(t.amount>=0?'+':'−'):''}{rupiah(t.amount)}</b></span><span className="tx-card-bottom"><span className="mono">User {t.user_id}</span><span>{fmtDate(t.created_at)}</span></span></button>; })}</div>}
    {data && <Pagination page={data.page} totalPages={data.totalPages} pageSize={pageSize} setPage={(p)=>{setPage(p);setSelected(null);}} setPageSize={setPageSize} total={data.total}/>} 
  </div><aside className="transactions-detail-dock" aria-hidden={!selected}>{selected && <TransactionDetail tx={selected} onClose={()=>setSelected(null)}/>}</aside></div>;
}
