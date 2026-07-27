/**
 * BroadcastContext — menjaga state job broadcast tetap hidup meski user pindah menu.
 *
 * Kenapa di context (bukan di dalam page): komponen Broadcast unmount saat pindah
 * route, sehingga interval poll & state job ikut hilang. Dengan mengangkat state +
 * polling ke provider (di atas router), broadcast yang sedang berjalan tetap
 * ke-track, dan indikator global bisa muncul di layout.
 */
import { createContext, useContext, useState, useRef, useCallback, useEffect } from 'react';
import { startBroadcast as apiStart, fetchBroadcastStatus } from '../api.js';

const BroadcastContext = createContext(null);

export function BroadcastProvider({ children }) {
  const [job, setJob] = useState(null);   // { jobId, pct, sent, failed, processed, total, status, label }
  // Snapshot konten yang sedang di-broadcast, biar preview tetap tampil meski pindah menu.
  const [snapshot, setSnapshot] = useState(null); // { header, body, photoUrl }
  const pollRef = useRef(null);

  const stopPoll = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  const poll = useCallback((jobId) => {
    stopPoll();
    pollRef.current = setInterval(async () => {
      try {
        const st = await fetchBroadcastStatus(jobId);
        setJob({ jobId, ...st });
        if (st.status === 'done' || st.status === 'error') stopPoll();
      } catch (e) {
        // Job kedaluwarsa / hilang di server → hentikan poll, tandai error.
        setJob((prev) => prev ? { ...prev, status: 'error', error: e.message } : prev);
        stopPoll();
      }
    }, 1000);
  }, [stopPoll]);

  const start = useCallback(async (payload) => {
    const r = await apiStart(payload);
    setJob({ jobId: r.jobId, pct: 0, sent: 0, failed: 0, processed: 0, total: r.total, status: 'queued', label: r.label });
    // Simpan snapshot konten (header/body/foto) supaya preview tetap ada saat bolak-balik menu.
    setSnapshot({
      header: payload.header || '',
      body: payload.body || '',
      photoUrl: payload.photo || null,
      target: payload.target,
      label: r.label
    });
    poll(r.jobId);
    return r;
  }, [poll]);

  // Bersihkan job selesai (dipanggil saat user klik "Broadcast Lagi" / tutup indikator)
  const clear = useCallback(() => { stopPoll(); setJob(null); setSnapshot(null); }, [stopPoll]);

  useEffect(() => () => stopPoll(), [stopPoll]);

  const running = !!job && (job.status === 'queued' || job.status === 'running');

  return (
    <BroadcastContext.Provider value={{ job, running, snapshot, start, clear }}>
      {children}
    </BroadcastContext.Provider>
  );
}

export function useBroadcast() {
  const ctx = useContext(BroadcastContext);
  if (!ctx) throw new Error('useBroadcast harus di dalam BroadcastProvider');
  return ctx;
}
