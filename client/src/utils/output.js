/**
 * Production lost to a stoppage, in the machine's own unit.
 *
 * This is what replaced the rupee figure the breakdown screens used to print.
 * A money number per stoppage read as fact while resting on a loss-per-hour
 * rate nobody had agreed; what a plant actually loses when a machine stops is
 * product it did not make, and every shift already counts that.
 *
 * The unit belongs to the machine, not to the group: a mixing mill is counted
 * in Kg and a curing press in Nos. That is why nothing here adds two figures
 * together — see `outputTotals` for the only safe way to total them.
 */

/** One machine's figure, e.g. "1,240 Kg". Empty string when there is nothing. */
export const outputLabel = (quantity, uom) => {
  const n = Number(quantity || 0);
  if (!n) return "";
  // At most one decimal: the rate is an estimate reviewed yearly, so more
  // precision than that would be inventing it.
  const shown = Math.round(n * 10) / 10;
  return `${shown.toLocaleString("en-IN")}${uom ? ` ${uom}` : ""}`;
};

/** The same, but "—" rather than blank, for a figure cell that must show something. */
export const outputOrDash = (quantity, uom) => outputLabel(quantity, uom) || "—";

/**
 * Several machines' figures, already totalled per unit by the server.
 *
 * Takes `[{ uom, quantity }, ...]` and renders "1,240 Kg · 380 Nos". Kept as
 * separate terms on purpose: adding kilos to pieces would give one number that
 * means nothing and looks like it means something.
 */
export const outputTotals = (totals) => {
  if (!Array.isArray(totals) || totals.length === 0) return "";
  return totals
    .filter((t) => Number(t?.quantity) > 0)
    .map((t) => outputLabel(t.quantity, t.uom))
    .join(" · ");
};
