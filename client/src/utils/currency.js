/**
 * Rupees, grouped the Indian way — "₹1,20,450.50", and "₹2,400" when the
 * amount is whole. Costs are held in INR throughout; there is no second
 * currency to switch on.
 *
 * Trailing ".00" is dropped because most stock is costed in whole rupees and a
 * column of "₹2,400.00" reads worse than "₹2,400" for no added precision.
 */
export const formatCurrency = (amount) => {
  const value = Number(amount);
  if (amount === null || amount === undefined || Number.isNaN(value)) return "—";

  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 0,
    maximumFractionDigits: Number.isInteger(value) ? 0 : 2,
  }).format(value);
};

/**
 * How much of an issue is still out with the recipient.
 *
 * An issued batch settles three ways — returned, consumed or scrapped — and
 * every one of them closes quantity out against the issue. Counting only
 * returns would leave a fully consumed issue looking permanently outstanding.
 * Fields are coalesced because rows written before consumption and scrap
 * existed carry neither counter.
 */
export const outstandingOf = (issue) =>
  Math.max(
    0,
    (issue?.quantity || 0) -
      ((issue?.returnedQuantity || 0) +
        (issue?.consumedQuantity || 0) +
        (issue?.scrappedQuantity || 0))
  );

/**
 * How the issue ended, in one word — the label the status column shows.
 *
 * The server's `returnStatus` only tracks the returning half of the story, so
 * an issue that was entirely used up still reads "Not Returned" there.
 */
export const settlementOf = (issue) => {
  const quantity = issue?.quantity || 0;
  const outstanding = outstandingOf(issue);

  if (outstanding > 0) {
    return outstanding < quantity
      ? { label: "Part Settled", tone: "amber" }
      : { label: "Outstanding", tone: "rose" };
  }
  if ((issue?.returnedQuantity || 0) === quantity)
    return { label: "Returned", tone: "emerald" };
  if ((issue?.consumedQuantity || 0) === quantity)
    return { label: "Consumed", tone: "slate" };
  if ((issue?.scrappedQuantity || 0) === quantity)
    return { label: "Scrapped", tone: "rose" };
  // Mixed settlement. Scrap is the one outcome that cost the company money, so
  // it is what the badge flags when more than one route was used.
  return (issue?.scrappedQuantity || 0) > 0
    ? { label: "Settled", tone: "rose" }
    : { label: "Settled", tone: "emerald" };
};

/** Tailwind classes for a settlement tone, matching the badges used elsewhere. */
export const TONE_CLASSES = {
  emerald: "bg-emerald-500/10 text-emerald-600 border border-emerald-500/20",
  amber: "bg-amber-500/10 text-amber-600 border border-amber-500/20",
  rose: "bg-rose-500/10 text-rose-600 border border-rose-500/20",
  slate: "bg-slate-500/10 text-slate-600 border border-slate-500/20",
};
