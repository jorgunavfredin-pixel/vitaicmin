import Icon from '../../components/Icons.jsx';

export default function OrderStat({ icon, label, value, tone, active, onClick, className = '' }) {
  const fmt = (n) => new Intl.NumberFormat('id-ID').format(n || 0);
  return (
    <button className={`ostat ${active ? 'active' : ''} ${className}`} onClick={onClick} type="button">
      <div className={`ostat-icon tone-${tone}`}><Icon name={icon} size={16} /></div>
      <div className="ostat-body">
        <div className="ostat-label">{label}</div>
        <div className="ostat-value">{fmt(value)}</div>
      </div>
    </button>
  );
}
