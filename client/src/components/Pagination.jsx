import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * The bar under a paged list: "Showing 11–20 of 46 requests" on the left and
 * the page numbers on the right (stacked and centred on a phone).
 *
 * The list does its own slicing - see utils/pageSlice.js - so this only draws. Pass
 * the page the list is actually on, already clamped, so a filter that leaves
 * fewer pages never shows page 4 of 2.
 *
 * Optional: pass `onPageSize` (and `pageSizes`, default 10/20/50/100) to add a
 * rows-per-page selector beside the page numbers. The list owns the size and
 * should go back to page 1 when it changes.
 */
const Pagination = ({
  page,
  total,
  pageSize,
  onPage,
  noun = "item",
  className = "",
  pageSizes = [10, 20, 50, 100],
  onPageSize,
}) => {
  if (!total) return null;
  const count = Math.max(1, Math.ceil(total / pageSize));
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <div
      className={`card flex flex-col items-center gap-3 px-4 py-3 sm:flex-row sm:justify-between sm:px-5 ${className}`}
    >
      <p className="text-[13px] text-slate-500" aria-live="polite">
        Showing {from}–{to} of {total} {noun}
        {total === 1 ? "" : "s"}
      </p>
      <div className="flex flex-col items-center gap-3 sm:flex-row sm:gap-4">
        {onPageSize && (
          <label className="flex items-center gap-2 text-[13px] text-slate-500">
            Rows per page
            <select
              value={pageSize}
              onChange={(e) => onPageSize(Number(e.target.value))}
              className="field field-sm w-auto cursor-pointer"
              aria-label="Rows per page"
            >
              {(pageSizes.includes(pageSize) ? pageSizes : [...pageSizes, pageSize].sort((a, b) => a - b)).map(
                (size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                )
              )}
            </select>
          </label>
        )}
        <PageNumbers page={page} count={count} onPage={onPage} />
      </div>
    </div>
  );
};

/** Page numbers, shortened with gaps once there are more than seven. */
const PageNumbers = ({ page, count, onPage }) => {
  if (count <= 1) return null;
  const nums =
    count <= 7
      ? Array.from({ length: count }, (_, i) => i + 1)
      : [...new Set([1, page - 1, page, page + 1, count].filter((n) => n >= 1 && n <= count))].sort((a, b) => a - b);
  const items = nums.flatMap((n, i) => (i > 0 && n - nums[i - 1] > 1 ? [`gap-${n}`, n] : [n]));
  const base =
    "grid h-9 min-w-9 cursor-pointer place-items-center rounded-lg px-2 text-[13px] font-semibold transition-colors disabled:cursor-default disabled:opacity-40";

  return (
    <nav aria-label="Pages" className="flex items-center gap-1">
      <button
        type="button"
        className={`${base} text-slate-600 hover:bg-slate-100`}
        onClick={() => onPage(page - 1)}
        disabled={page === 1}
        aria-label="Previous page"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
      </button>
      {items.map((n) =>
        typeof n === "string" ? (
          <span key={n} className="px-1 text-slate-400" aria-hidden="true">
            …
          </span>
        ) : (
          <button
            key={n}
            type="button"
            onClick={() => onPage(n)}
            aria-current={n === page ? "page" : undefined}
            aria-label={`Page ${n}`}
            className={`${base} ${n === page ? "bg-brand-600 text-white" : "text-slate-700 hover:bg-slate-100"}`}
          >
            {n}
          </button>
        )
      )}
      <button
        type="button"
        className={`${base} text-slate-600 hover:bg-slate-100`}
        onClick={() => onPage(page + 1)}
        disabled={page === count}
        aria-label="Next page"
      >
        <ChevronRight className="h-4 w-4" aria-hidden="true" />
      </button>
    </nav>
  );
};

export default Pagination;
