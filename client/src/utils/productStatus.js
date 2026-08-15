/**
 * Condition recorded against a product during the stock take — "Good
 * Condition", "Working", "Brand New", "Complaint", "BreakDown on High loads".
 *
 * The field is free text on the server on purpose: the store writes what it
 * sees, and the phrasing keeps changing. So the tone is matched on words rather
 * than on an enum, and anything unrecognised stays neutral instead of being
 * coloured wrongly.
 */

/** The values the catalog uses today, offered as suggestions in the form. */
export const COMMON_STATUSES = [
  "Good Condition",
  "Working",
  "Brand New",
  "Partially Usable",
  "Almost Empty",
  "Not Verified",
  "Complaint",
];

/**
 * Badge tone for a status. Faults are tested before anything else, and
 * qualifiers ("not verified", "partially") before the plain positives, so
 * "Working and not verified" reads as a caution rather than as working.
 */
export const statusTone = (status) => {
  const value = String(status || "").toLowerCase();
  if (!value.trim()) return "badge-slate";
  if (/break|damag|complaint|faulty|not working|dead|scrap/.test(value)) return "badge-rose";
  if (/not verified|unverified|partial|almost empty|empty|repair|service/.test(value)) return "badge-amber";
  if (/good|working|brand new|new|full|usable|ok\b/.test(value)) return "badge-emerald";
  return "badge-slate";
};
