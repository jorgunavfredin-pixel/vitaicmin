import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchQrisCustom, previewQrisCustom, saveQrisCustom, uploadQrisCustom } from '../../api.js';
import Icon from '../../components/Icons.jsx';

const DEF = { x: 23.4375, y: 23.4375, size: 53.125 };

export default function QrisCustomTab({ showToast }) {
  const [data, setData] = useState(null);
  const [source, setSource] = useState('preset');
  const [presetId, setPresetId] = useState('');
  const [layout, setLayout] = useState(DEF);
  const [preview, setPreview] = useState('');
  const [busy, setBusy] = useState('');
  const timer = useRef(null);

  const load = useCallback(async () => {
    try {
      const d = await fetchQrisCustom();
      setData(d); setSource(d.config.source); setPresetId(d.config.preset_id || d.presets[0]?.id || '');
      setLayout(d.config.layout || d.defaults || DEF);
    } catch (e) { showToast(e.message, 'err'); }
  }, [showToast]);
  useEffect(() => { load(); }, [load]);

  const refreshPreview = useCallback((s = source, p = presetId, l = layout) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      if (s === 'preset' && (!p || !data?.presets.some(item => item.id === p))) return setPreview('');
      if (s === 'custom' && !data?.config.custom_exists) return setPreview('');
      try {
        const url = await previewQrisCustom({ source: s, preset_id: p, layout: l });
        setPreview(old => { if (old) URL.revokeObjectURL(old); return url; });
      } catch (e) { setPreview(''); }
    }, 250);
  }, [source, presetId, layout, data, showToast]);
  useEffect(() => { if (data) refreshPreview(); return () => clearTimeout(timer.current); }, [data, source, presetId, layout, refreshPreview]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const update = (key, value) => {
    const next = { ...layout, [key]: Number(value) };
    const max = 100 - next.size;
    next.x = Math.max(0, Math.min(max, next.x)); next.y = Math.max(0, Math.min(max, next.y));
    setLayout(next);
  };
  const reset = () => {
    const preset = data?.presets.find(p => p.id === presetId);
    setLayout(source === 'preset' ? (preset?.layout || data?.defaults || DEF) : (data?.defaults || DEF));
  };
  const center = () => { const v = (100 - layout.size) / 2; setLayout({ ...layout, x: v, y: v }); };

  const save = async () => {
    setBusy('save');
    try {
      const r = await saveQrisCustom({ enabled: true, source, preset_id: presetId, layout });
      showToast(r.message); await load();
    } catch (e) { showToast(e.message, 'err'); } finally { setBusy(''); }
  };

  const upload = (file) => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return showToast('Ukuran gambar maksimal 5 MB', 'err');
    const reader = new FileReader();
    reader.onload = async () => {
      setBusy('upload');
      try {
        const r = await uploadQrisCustom(reader.result); showToast(r.message);
        const d = await fetchQrisCustom(); setData(d); setSource('custom'); setPresetId(''); setLayout(d.defaults || DEF);
      } catch (e) { showToast(e.message, 'err'); } finally { setBusy(''); }
    };
    reader.readAsDataURL(file);
  };

  if (!data) return <div className="panel"><div className="empty">Memuat QRIS Custom…</div></div>;
  return <div className="panel settings-panel qcustom">
    <h3 className="settings-section-title">QRIS Custom</h3>
    <div className="settings-note hint-icon"><Icon name="info" size={14}/> Pilih tema bawaan atau upload twibbon sendiri, sesuaikan posisi QR, lalu simpan.</div>

    <div className="qcustom-source">
      <div>
        <label className="field-label">Pilih twibbon</label>
        <select className="select-field" value={source === 'custom' ? '__custom' : presetId} onChange={e => {
          if (e.target.value === '__custom') { setSource('custom'); setPresetId(''); setLayout(data.defaults || DEF); return; }
          setSource('preset'); setPresetId(e.target.value); const p=data.presets.find(x=>x.id===e.target.value); setLayout(p?.layout || data.defaults || DEF);
        }}>
          <option value="" disabled>{data.presets.length || data.config.custom_exists ? 'Pilih twibbon' : 'Belum ada twibbon'}</option>
          {data.presets.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          {data.config.custom_exists && <option value="__custom">Twibbon Custom</option>}
        </select>
      </div>
      <label className="qcustom-upload">
        <Icon name="upload" size={18}/><span><b>Punya twibbon sendiri?</b><small>Upload PNG, JPG, atau WebP — maks. 5 MB</small></span>
        <input type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>upload(e.target.files?.[0])}/>
      </label>
    </div>
    {!data.presets.length && <div className="settings-note hint-icon" style={{marginTop:12}}><Icon name="info" size={14}/> Tema bawaan dibaca dari <code>{data.preset_dir}</code>. Tambahkan PNG/JPG/WebP lalu buka ulang submenu ini.</div>}

    <div className="qcustom-editor">
      <div className="qcustom-controls">
        {['x','y','size'].map(key => <div className="qcustom-row" key={key}>
          <label>{key === 'size' ? 'Ukuran' : key.toUpperCase()}</label>
          <input type="range" min={key==='size'?10:0} max={key==='size'?90:100-layout.size} step="0.05" value={layout[key]} onChange={e=>update(key,e.target.value)}/>
          <input type="number" min={key==='size'?10:0} max={key==='size'?90:100-layout.size} step="0.05" value={Number(layout[key]).toFixed(2)} onChange={e=>update(key,e.target.value)}/>
        </div>)}
        <div className="button-row"><button className="a-btn" onClick={reset}>Reset Default</button><button className="a-btn" onClick={center}>Tepatkan ke Tengah</button></div>
        <button className="btn-primary" onClick={save} disabled={!!busy || (source==='preset'&&!presetId) || (source==='custom'&&!data.config.custom_exists)}>{busy==='save'?'Menyimpan…':'Simpan'}</button>
      </div>
      <div className="qcustom-preview">{preview ? <img src={preview} alt="Preview QRIS Custom"/> : <div className="empty">Pilih tema atau upload twibbon</div>}<span className="pill">{source==='custom'?'Twibbon sendiri':data.presets.find(p=>p.id===presetId)?.name||'Tema bawaan'}</span></div>
    </div>
  </div>;
}
