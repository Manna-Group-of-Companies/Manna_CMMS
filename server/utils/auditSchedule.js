/**
 * How often each item has to be counted, and whether a given month is its turn.
 *
 * Counting every line of every room every month is what the store was asked to
 * stop doing: the fast-moving consumables need a monthly check, but the spare
 * couplings that move twice a year do not, and burying them in the sheet is
 * what makes a count take a week and get abandoned half done. The frequency
 * lives on the product (one item, one cadence) and the schedule is worked out
 * per room, because an item can sit in two rooms and each shelf has to be
 * walked separately.
 */

/** The cadences an item can be put on, and how many months each one spans. */
export const AUDIT_FREQUENCIES = {
  Monthly: 1,
  Quarterly: 3,
  "Half-Yearly": 6,
};

export const AUDIT_FREQUENCY_NAMES = Object.keys(AUDIT_FREQUENCIES);

/** Anything not on the list counts as monthly — the safe direction to fail. */
export const intervalOf = (frequency) => AUDIT_FREQUENCIES[frequency] || 1;

const partsOf = (period) => String(period || "").split("-").map(Number);

/** Whole months from [from] to [to], both "YYYY-MM". Negative if [to] is earlier. */
export const monthsBetween = (from, to) => {
  const [fromYear, fromMonth] = partsOf(from);
  const [toYear, toMonth] = partsOf(to);
  if (!fromYear || !toYear) return 0;
  return (toYear - fromYear) * 12 + (toMonth - fromMonth);
};

/** [period] shifted forward by [months], as "YYYY-MM". */
export const periodPlus = (period, months) => {
  const [year, month] = partsOf(period);
  if (!year) return period;
  const shifted = new Date(year, month - 1 + months, 1);
  return `${shifted.getFullYear()}-${String(shifted.getMonth() + 1).padStart(2, "0")}`;
};

/**
 * Whether an item is due to be counted in [period], and the one-line reason
 * that goes on the sheet beside it.
 *
 * Due is measured from when the item was last counted **in this room** rather
 * than from a fixed calendar quarter. A calendar schedule would drop every
 * quarterly and half-yearly item into the same month and hand the store a
 * thousand-line sheet in January and a fifty-line one in February; counting
 * from the last count spreads the same work evenly and, more importantly,
 * means an item is never more than its interval away from having been checked.
 *
 * An item nobody has ever counted is always due, whatever its cadence — it is
 * precisely the stock with no history that is worth walking to.
 */
export const dueState = ({ frequency, lastCountedPeriod, period }) => {
  const interval = intervalOf(frequency);

  if (interval === 1) {
    return { due: true, reason: "Counted every month", dueFrom: period };
  }
  if (!lastCountedPeriod) {
    return { due: true, reason: "Never counted", dueFrom: period };
  }

  const dueFrom = periodPlus(lastCountedPeriod, interval);
  const elapsed = monthsBetween(lastCountedPeriod, period);

  // A negative elapsed means the sheet being drawn up is for a month that
  // predates the last count — a back-dated audit. Nothing is due in the past.
  if (elapsed >= interval) {
    return {
      due: true,
      reason: `Last counted ${lastCountedPeriod}, ${elapsed} ${
        elapsed === 1 ? "month" : "months"
      } ago`,
      dueFrom,
    };
  }
  return {
    due: false,
    reason: `Counted ${lastCountedPeriod}; next due ${dueFrom}`,
    dueFrom,
  };
};

/**
 * The reasons a counter can give for a line that did not match.
 *
 * "Unexplained" is on the list on purpose. Every discrepancy has to carry a
 * reason before the sheet can be submitted, and without an honest way to say
 * "I do not know" the counter would pick whichever nearby label got them past
 * the button — which is worse than a variance the report can show as genuinely
 * unaccounted for.
 */
export const VARIANCE_REASONS = [
  "Explained by movement",
  "Issued but not recorded",
  "Damaged or scrapped",
  "Found on another shelf",
  "Data entry error",
  "Unexplained",
];
