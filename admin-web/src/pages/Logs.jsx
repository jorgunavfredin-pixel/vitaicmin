import { useEffect, useState, useCallback, useRef } from 'react';
import { fetchLogs, fetchActivity } from '../api.js';
import Icon from '../components/Icons.jsx';
import './logs/logs.css';

const fmtSize=b=>{if(!b)return'0 B';const u=['B','KB','MB','GB'],i=Math.floor(Math.log(b)/Math.log(1024));return`${(b/Math.pow(1024,i)).toFixed(1)} ${u[i]}`};
const fmtDate=iso=>iso?new Date(iso).toLocaleString('id-ID',{timeZone:'Asia/Jakarta',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}):'-';
const lineLevel=line=>{const l=line.toLowerCase();if(/\b(error|err|fail|failed|exception|✕|❌)\b/.test(l))return'err';if(/\b(warn|warning|⚠)\b/.test(l))return'warn';if(/\b(✅|success|ok|started|running)\b/.test(l))return'ok';return''};
const META={order:['receipt','Order'],payment:['cash','Pembayaran'],stock:['box','Stok'],customer:['user','Customer'],broadcast:['speakerphone','Broadcast'],voucher:['ticket','Voucher'],settings:['settings','Pengaturan'],system:['terminal','Sistem']};

function ActivityView(){
 const[data,setData]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(false);
 const load=useCallback(()=>{setLoading(true);fetchActivity().then(d=>{setData(d);setError('')}).catch(e=>setError(e.message)).finally(()=>setLoading(false))},[]);
 useEffect(()=>{load()},[load]);
 return <><div className="logs-simple-head"><div><b>50 aktivitas terbaru</b><span>Gabungan aktivitas toko dan operasi web admin</span></div><button className="btn-ghost logs-refresh" onClick={load} disabled={loading}><Icon name="refresh" size={15}/>{loading?'Memuat…':'Refresh'}</button></div><div className="panel activity-panel">{error?<div className="empty error-panel">{error}</div>:!data?<div className="empty">Memuat aktivitas…</div>:!data.items.length?<div className="empty">Belum ada aktivitas</div>:<div className="activity-list">{data.items.map(item=>{const m=META[item.category]||META.system;return <div key={item.id} className={`activity-item ${item.status||'info'}`}><div className={`activity-icon ${item.category}`}><Icon name={m[0]} size={16}/></div><div className="activity-main"><div className="activity-top"><b>{item.title}</b><span>{fmtDate(item.created_at)}</span></div><div className="activity-summary">{item.summary}</div><div className="activity-meta"><span>{m[1]}</span><span>{item.source==='admin-web'?'Web Admin':'Aktivitas Toko'}</span>{item.http_status&&<span>HTTP {item.http_status}</span>}</div></div></div>})}</div>}</div></>;
}

function TerminalView(){
 const[data,setData]=useState(null),[error,setError]=useState(''),[q,setQ]=useState(''),[loading,setLoading]=useState(false),boxRef=useRef(null);
 const load=useCallback(()=>{setLoading(true);fetchLogs({lines:50,q}).then(d=>{setData(d);setError('')}).catch(e=>setError(e.message)).finally(()=>setLoading(false))},[q]);
 useEffect(()=>{const t=setTimeout(load,q?250:0);return()=>clearTimeout(t)},[load,q]);useEffect(()=>{if(boxRef.current)boxRef.current.scrollTop=boxRef.current.scrollHeight},[data]);
 return <><div className="logs-simple-head terminal-simple-head"><div><b>50 baris terminal terbaru</b><span>{data?.available?`${data.count} tampil · ${fmtSize(data.size)}`:'Log bot'}</span></div><div className="logs-terminal-controls"><div className="search logs-search"><span className="search-icon"><Icon name="search" size={15}/></span><input placeholder="Filter 50 baris…" value={q} onChange={e=>setQ(e.target.value)}/></div><button className="btn-ghost logs-refresh" onClick={load} disabled={loading}><Icon name="refresh" size={15}/></button></div></div><div className="panel no-pad terminal-panel">{error?<div className="empty error-panel">{error}</div>:!data?<div className="empty">Memuat log…</div>:!data.available?<div className="empty">{data.message||'File log belum ada'}</div>:!data.lines.length?<div className="empty">Tidak ada baris cocok dalam 50 log terbaru</div>:<div className="log-viewer" ref={boxRef}>{data.lines.map((line,i)=><div key={i} className={`log-line ${lineLevel(line)}`}><span className="log-ln">{i+1}</span><span className="log-text">{line}</span></div>)}</div>}</div></>;
}

export default function Logs(){const[tab,setTab]=useState('activity');return <div className="page logs-page"><div className="page-head"><div><h2 className="page-title">Logs</h2><p className="page-sub">50 aktivitas dan log sistem terbaru</p></div></div><div className="subtab-bar logs-tabs"><button className={`subtab ${tab==='activity'?'active':''}`} onClick={()=>setTab('activity')}><Icon name="clock" size={16}/><span>Aktivitas</span></button><button className={`subtab ${tab==='terminal'?'active':''}`} onClick={()=>setTab('terminal')}><Icon name="terminal" size={16}/><span>Sistem & Terminal</span></button></div>{tab==='activity'?<ActivityView/>:<TerminalView/>}</div>}
