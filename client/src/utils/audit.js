/**
 * Shared vocabulary for the monthly stock audit — the count screen and the
 * Admin's report have to describe the same month and colour the same score the
 * same way, so neither of them writes its own version of this.
 */

/** The month the API keys audits by, "YYYY-MM", read in Indian time. */
export const currentPeriod = () =>
  new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 7);

/** "2026-08" → "August 2026". */
export const periodLabel = (period) => {
  if (!period) return "—";
  const [year, month] = String(period).split("-");
  return new Date(Number(year), Number(month) - 1, 1).toLocaleDateString([], {
    month: "long",
    year: "numeric",
  });
};

/** "2026-08" → "Aug 26", for axes and chips where the full label will not fit. */
export const shortPeriodLabel = (period) => {
  if (!period) return "—";
  const [year, month] = String(period).split("-");
  return new Date(Number(year), Number(month) - 1, 1).toLocaleDateString([], {
    month: "short",
    year: "2-digit",
  });
};

/** The month n months before [period], as "YYYY-MM". */
export const periodBefore = (period, months) => {
  const [year, month] = String(period).split("-").map(Number);
  const shifted = new Date(year, month - 1 - months, 1);
  return `${shifted.getFullYear()}-${String(shifted.getMonth() + 1).padStart(2, "0")}`;
};

export const AUDIT_STATUS_BADGES = {
  "In Progress": "bg-amber-500/10 text-amber-600 border border-amber-500/20",
  Submitted: "bg-indigo-500/10 text-indigo-600 border border-indigo-500/20",
  Reviewed: "bg-emerald-500/10 text-emerald-600 border border-emerald-500/20",
};

/**
 * How a score is coloured: green from 95, amber from 80, red below.
 *
 * The thresholds are deliberately hard. A store room that cannot account for
 * one line in five is not "nearly right", and shading it amber would let the
 * report read as comfortable while the shelves disagree with the system.
 */
export const scoreTone = (score) =>
  score >= 95
    ? {
        text: "text-emerald-600",
        bar: "bg-emerald-500",
        ring: "border-emerald-500/20 bg-emerald-50/40",
      }
    : score >= 80
    ? {
        text: "text-amber-600",
        bar: "bg-amber-500",
        ring: "border-amber-500/20 bg-amber-50/40",
      }
    : {
        text: "text-rose-600",
        bar: "bg-rose-500",
        ring: "border-rose-500/20 bg-rose-50/40",
      };

/**
 * How often an item is counted. Kept in step with `AUDIT_FREQUENCIES` on the
 * server — the API rejects anything else, and the sheet shows what it was told
 * rather than deciding for itself.
 */
export const AUDIT_FREQUENCIES = ["Monthly", "Quarterly", "Half-Yearly"];

export const FREQUENCY_BADGES = {
  Monthly: "bg-slate-100 text-slate-600 border border-slate-200",
  Quarterly: "bg-sky-500/10 text-sky-600 border border-sky-500/20",
  "Half-Yearly": "bg-violet-500/10 text-violet-600 border border-violet-500/20",
};

/** Short forms for the count sheet, where the column is a few characters wide. */
export const FREQUENCY_SHORT = {
  Monthly: "1M",
  Quarterly: "3M",
  "Half-Yearly": "6M",
};

/**
 * The reasons a discrepancy can be recorded under, in the order the server
 * lists them. Every one of them has to be accounted for before a sheet closes,
 * so "Unexplained" is a real choice rather than an omission.
 */
export const VARIANCE_REASONS = [
  "Explained by movement",
  "Issued but not recorded",
  "Damaged or scrapped",
  "Found on another shelf",
  "Data entry error",
  "Unexplained",
];

/**
 * Unexplained variance is the finding worth chasing, so it is the one reason
 * that is coloured as a problem rather than as an answer.
 */
export const reasonTone = (reason) =>
  !reason
    ? "bg-rose-500/10 text-rose-600 border border-rose-500/20"
    : reason === "Unexplained"
    ? "bg-amber-500/10 text-amber-700 border border-amber-500/20"
    : "bg-slate-100 text-slate-600 border border-slate-200";
