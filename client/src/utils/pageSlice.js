/**
 * The rows for one page, and that page clamped to the pages there are - so a
 * filter or reload that leaves fewer rows never strands the list on page 4 of
 * 2. Pairs with components/Pagination.jsx.
 *
 *   const { page, rows } = pageSlice(all, wanted, 10);
 */
export const pageSlice = (all, wanted, pageSize) => {
  const count = Math.max(1, Math.ceil(all.length / pageSize));
  const page = Math.min(Math.max(1, wanted), count);
  return { page, rows: all.slice((page - 1) * pageSize, page * pageSize) };
};
