import { useEffect, useState, useRef, useCallback } from 'react';
import {
  fetchBroadcastTargets, previewBroadcast, startBroadcast, fetchBroadcastStatus
} from '../api.js';
import Icon from '../components/Icons.jsx';

const DEFAULT_HEADER = '📢 BROADCAST MESSAGE';
const MAX_PHOTO_MB = 8;

// Escape teks header buat preview (biar konsisten sama backend yg bold + escape header).
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export default function Broadcast() {
  const [targets, setTargets] = useState(null);
  const [target, setTarget] = useState('all');        // all | category
  const [categoryId, setCategoryId] = useState('');
  const [count, setCount] = useState(null);           // jumlah target hasil preview

  const [header, setHeader] = useState('');
  const [body, setBody] = useState('');
  const [photo, setPhoto] = useState(null);           // { dataUrl, name }

  const [confirm, setConfirm] = useState(false);
  const [job, setJob] = useState(null);               // { pct, sent, failed, processed, total, status }
  const [toast, setToast] = useState(null);
  const bodyRef = useRef(null);
  const pollRef = useRef(null);

  const showToast = (msg, kind = 'ok') => {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 3600);
  };

  // Load daftar target (kategori + jumlah semua user)
  useEffect(() => {
    fetchBroadcastTargets().then(setTargets).catch((e) => showToast(e.message, 'err'));
  }, []);

  // Hitung ulang jumlah target tiap ganti mode/kategori
  const refreshCount = useCallback(() => {
    if (target === 'category' && !categoryId) { setCount(null); return; }
    previewBroadcast(target, categoryId)
      .then((r) => setCount(r.count))
      .catch(() => setCount(null));
  }, [target, categoryId]);

  useEffect(() => { refreshCount(); }, [refreshCount]);

  // Cleanup polling saat unmount
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  const onPickPhoto = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) return showToast('File harus berupa gambar', 'err');
    if (file.size > MAX_PHOTO_MB * 1024 * 1024) return showToast(`Foto maksimal ${MAX_PHOTO_MB}MB`, 'err');
    const reader = new FileReader();
    reader.onload = () => setPhoto({ dataUrl: reader.result, name: file.name });
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  // Sisipkan tag format di sekitar teks terpilih pada textarea body.
  const wrapSelection = (tag) => {
    const ta = bodyRef.current;
    if (!ta) return;
    const start = ta.selectionStart, end = ta.selectionEnd;
    const sel = body.slice(start, end) || 'teks';
    const next = body.slice(0, start) + `<${tag}>${sel}</${tag}>` + body.slice(end);
    setBody(next);
    setTimeout(() => { ta.focus(); ta.selectionStart = start + tag.length + 2; ta.selectionEnd = start + tag.length + 2 + sel.length; }, 0);
  };

  const previewHeader = (header.trim() || DEFAULT_HEADER);
  const canSend = (body.trim() || photo) && count > 0 && (!job || job.status === 'done' || job.status === 'error');

  const doStart = async () => {
    setConfirm(false);
    try {
      const payload = { target, categoryId: target === 'category' ? categoryId : undefined, header, body, photo: photo?.dataUrl };
      const r = await startBroadcast(payload);
      setJob({ pct: 0, sent: 0, failed: 0, processed: 0, total: r.total, status: 'queued', label: r.label });
      // Poll status tiap 1 detik
      pollRef.current = setInterval(async () => {
        try {
          const st = await fetchBroadcastStatus(r.jobId);
          setJob(st);
          if (st.status === 'done' || st.status === 'error') {
            clearInterval(pollRef.current); pollRef.current = null;
            if (st.status === 'done') showToast(`Broadcast selesai: ${st.sent} terkirim, ${st.failed} gagal`);
          }
        } catch (e) {
          clearInterval(pollRef.current); pollRef.current = null;
          showToast('Gagal cek status broadcast: ' + e.message, 'err');
        }
      }, 1000);
    } catch (e) { showToast(e.message, 'err'); }
  };

  const running = job && (job.status === 'queued' || job.status === 'running');

  return (
    <div className="broadcast-page">
      <div className="page-head">
        <div>
          <h2 className="page-title">Broadcast</h2>
          <p className="page-sub">Kirim pesan massal ke user. Mendukung format HTML & foto.</p>
        </div>
      </div>

      <div className="bc-grid">
        {/* ---- Editor ---- */}
        <div className="panel bc-editor">
          {/* Target */}
          <label className="field-label">Target Penerima</label>
          <div className="chips" style={{ marginBottom: 12 }}>
            <button className={`chip ${target === 'all' ? 'active' : ''}`} onClick={() => setTarget('all')}>Semua User</button>
            <button className={`chip ${target === 'category' ? 'active' : ''}`} onClick={() => setTarget('category')}>Per Kategori</button>
          </div>

          {target === 'category' && (
            <select className="select-field" style={{ width: '100%', marginBottom: 12 }}
              value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">— Pilih kategori —</option>
              {targets?.categories.map((c) => (
                <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>
              ))}
            </select>
          )}

          <div className="bc-target-info hint-icon">
            <Icon name="users" size={14} />
            {count != null
              ? <> Akan dikirim ke <b>{count}</b> user {target === 'category' ? 'di kategori ini' : ''}</>
              : <> Pilih kategori untuk melihat jumlah target</>}
          </div>

          {/* Header opsional */}
          <label className="field-label" style={{ marginTop: 16 }}>Header (opsional)</label>
          <input type="text" className="qty-field" placeholder={DEFAULT_HEADER}
            value={header} onChange={(e) => setHeader(e.target.value)} />
          <div className="bc-hint">Kosongkan untuk pakai header default: <code>{DEFAULT_HEADER}</code></div>

          {/* Body + toolbar format */}
          <label className="field-label" style={{ marginTop: 16 }}>Isi Pesan (format HTML)</label>
          <div className="bc-toolbar">
            <button className="bc-fmt" title="Bold" onClick={() => wrapSelection('b')}><b>B</b></button>
            <button className="bc-fmt" title="Italic" onClick={() => wrapSelection('i')}><i>I</i></button>
            <button className="bc-fmt" title="Underline" onClick={() => wrapSelection('u')}><u>U</u></button>
            <button className="bc-fmt" title="Strikethrough" onClick={() => wrapSelection('s')}><s>S</s></button>
            <button className="bc-fmt" title="Monospace" onClick={() => wrapSelection('code')}>{'</>'}</button>
          </div>
          <textarea ref={bodyRef} rows={7} className="qty-field bc-body"
            placeholder={"Tulis pesan di sini…\nContoh: <b>Promo!</b> Diskon <i>50%</i> hari ini."}
            value={body} onChange={(e) => setBody(e.target.value)} />
          <div className="bc-hint">Tag didukung Telegram: <code>&lt;b&gt; &lt;i&gt; &lt;u&gt; &lt;s&gt; &lt;code&gt; &lt;a href&gt;</code></div>

          {/* Foto */}
          <label className="field-label" style={{ marginTop: 16 }}>Foto (opsional)</label>
          {photo ? (
            <div className="bc-photo-picked">
              <img src={photo.dataUrl} alt="preview" />
              <span className="bc-photo-name">{photo.name}</span>
              <button className="ic-btn ic-danger" onClick={() => setPhoto(null)}><Icon name="trash" size={15} /></button>
            </div>
          ) : (
            <label className="bc-upload">
              <Icon name="upload" size={16} /> Pilih Foto (maks {MAX_PHOTO_MB}MB)
              <input type="file" accept="image/*" hidden onChange={onPickPhoto} />
            </label>
          )}
        </div>

        {/* ---- Preview + Send ---- */}
        <div className="panel bc-preview-panel">
          <div className="panel-head"><h3>Preview</h3></div>
          <div className="bc-preview">
            {photo && <img className="bc-preview-img" src={photo.dataUrl} alt="broadcast" />}
            <div className="bc-bubble">
              <div className="bc-bubble-header">{previewHeader}</div>
              {(body.trim() || !photo) && (
                <div className="bc-bubble-body" dangerouslySetInnerHTML={{ __html: body || '<span style="opacity:.5">(pesan kosong)</span>' }} />
              )}
            </div>
          </div>

          {/* Progress / Send */}
          {job ? (
            <div className="bc-progress">
              <div className="bc-progress-bar-wrap">
                <div className={`bc-progress-bar ${job.status === 'error' ? 'err' : ''}`} style={{ width: `${job.pct || 0}%` }} />
              </div>
              <div className="bc-progress-stats">
                <span>{job.pct || 0}%</span>
                <span>{job.processed || 0}/{job.total}</span>
              </div>
              <div className="bc-report">
                <span className="bc-rep-ok"><Icon name="check" size={14} /> {job.sent || 0} terkirim</span>
                <span className="bc-rep-fail"><Icon name="x" size={14} /> {job.failed || 0} gagal</span>
                {job.status === 'done' && <span className="bc-rep-done">Selesai ✓</span>}
                {running && <span className="bc-rep-run">Mengirim…</span>}
              </div>
              {(job.status === 'done' || job.status === 'error') && (
                <button className="btn-ghost btn-icon" style={{ marginTop: 12, width: '100%', justifyContent: 'center' }}
                  onClick={() => setJob(null)}>Broadcast Lagi</button>
              )}
            </div>
          ) : (
            <button className="btn-primary btn-icon bc-send" disabled={!canSend}
              onClick={() => setConfirm(true)}>
              <Icon name="speakerphone" size={16} /> Kirim Broadcast
            </button>
          )}
        </div>
      </div>

      {/* Konfirmasi */}
      {confirm && (
        <div className="modal-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) setConfirm(false); }}>
          <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-icon"><Icon name="speakerphone" size={30} /></div>
            <h4>Kirim Broadcast?</h4>
            <p>Pesan akan dikirim ke <b>{count}</b> user{target === 'category' ? ' di kategori terpilih' : ''}. Aksi ini tidak bisa dibatalkan setelah dimulai.</p>
            <div className="modal-actions">
              <button className="btn-ghost" onClick={() => setConfirm(false)}>Batal</button>
              <button className="btn-primary" onClick={doStart}>Ya, Kirim Sekarang</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className={`toast ${toast.kind}`}>{toast.msg}</div>}
    </div>
  );
}
