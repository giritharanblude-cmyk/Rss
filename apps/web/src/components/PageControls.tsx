export function PageControls({
  page,
  pageSize,
  total,
  label,
  onPageChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  label: string;
  onPageChange: (page: number) => void;
}) {
  if (!Number.isFinite(total) || total <= pageSize) return null;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <nav className="pagination" aria-label={`${label} pages`}>
      <button
        type="button"
        className="button-secondary"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
      >
        Previous
      </button>
      <span>
        Page {page} of {totalPages} · {total} {label}
      </span>
      <button
        type="button"
        className="button-secondary"
        disabled={page >= totalPages}
        onClick={() => onPageChange(page + 1)}
      >
        Next
      </button>
    </nav>
  );
}
