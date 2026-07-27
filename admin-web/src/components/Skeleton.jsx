// Reusable loading skeletons — konsisten di semua halaman.

// Skeleton untuk tabel (Orders, Users, dll). Menampilkan N baris shimmer.
export function SkeletonTable({ rows = 6, cols = 5 }) {
  return (
    <div className="skeleton-table">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="skeleton-row">
          {Array.from({ length: cols }).map((_, c) => (
            <span key={c} className="skeleton-line" />
          ))}
        </div>
      ))}
    </div>
  );
}

// Skeleton grid kartu (Dashboard stat cards, dll).
export function SkeletonCards({ count = 4, height }) {
  return (
    <div className="skeleton-grid">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="skeleton-card" style={height ? { height } : undefined} />
      ))}
    </div>
  );
}

export default SkeletonTable;
