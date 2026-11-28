export function Pagination({
  offset,
  count,
  hasMore,
  onChange,
}: {
  offset: number;
  count: number;
  hasMore: boolean;
  onChange: (offset: number) => void;
}) {
  return (
    <footer className="pagination">
      <button
        type="button"
        className="secondary-button"
        disabled={offset === 0}
        onClick={() => onChange(Math.max(0, offset - 50))}
      >
        Previous
      </button>
      <span>
        {count ? `Showing ${offset + 1}–${offset + count}` : "No results"}
      </span>
      <button
        type="button"
        className="secondary-button"
        disabled={!hasMore}
        onClick={() => onChange(offset + 50)}
      >
        Next
      </button>
    </footer>
  );
}
