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
