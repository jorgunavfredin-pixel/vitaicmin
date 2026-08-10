import { useState } from 'react';
import Icon from '../../components/Icons.jsx';

export function CopyBtn({ text }) {
  const [done, setDone] = useState(false);
  const copy = (e) => {
    e.stopPropagation();
    navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1200); }).catch(() => {});
  };
  return (
    <button className="dd-copy" onClick={copy} aria-label="Salin" title="Salin">
      <Icon name={done ? 'check' : 'clipboard'} size={13} />
    </button>
  );
}

export function CopyAllBtn({ items }) {
  const [done, setDone] = useState(false);
  const copyAll = () => {
    navigator.clipboard?.writeText(items.join('\n')).then(() => { setDone(true); setTimeout(() => setDone(false), 1400); }).catch(() => {});
  };
  return (
    <button className="dd-copyall" onClick={copyAll}>
      <Icon name={done ? 'check' : 'clipboard'} size={12} /> {done ? 'Tersalin' : 'Copy All'}
    </button>
  );
}

// Data terkirim tampil sesuai database (raw per-baris) dalam shellbox.
export default function DeliveredData({ items }) {
  return (
    <div className={`dd-shell ${items.length > 8 ? 'dd-many' : ''}`}>
      {items.map((raw, i) => (
        <div key={i} className="dd-line">
          <span className="dd-line-num">{i + 1}</span>
          <code className="dd-line-text">{raw}</code>
          <CopyBtn text={raw} />
        </div>
      ))}
    </div>
  );
}
