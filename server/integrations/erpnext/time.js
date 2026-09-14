/**
 * Timestamps in the format and the timezone ERPNext expects.
 *
 * Frappe stores Datetime fields as naive strings interpreted in the system
 * timezone — `Asia/Kolkata` on this instance. It does not store an offset, so a
 * value written as UTC is read back as though it were local time.
 *
 * This existed as a one-line `new Date().toISOString()` in three places, and
 * every one of them was wrong by the offset. The effect was invisible until a
 * report tried to measure an interval: a breakdown reported at 06:00 local and
 * assessed a minute later was stamped 05:29, so the time-to-respond came out
 * negative and was discarded, and the whole "where does the time go" split
 * silently reported nothing.
 *
 * The rule is simple and worth stating once: a timestamp going to ERPNext must
 * be wall-clock time in the ERPNext timezone, never UTC.
 */

/** Local wall-clock time as `YYYY-MM-DD HH:MM:SS`. */
export const erpNow = (date = new Date()) => {
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 19).replace("T", " ");
};

/** Local wall-clock date as `YYYY-MM-DD`. */
export const erpToday = (date = new Date()) => erpNow(date).slice(0, 10);

/** ERPNext's separate date and time-of-day fields, from one moment. */
export const erpPostingParts = (at = new Date()) => {
  const stamp = erpNow(at instanceof Date ? at : new Date(at));
  return { posting_date: stamp.slice(0, 10), posting_time: stamp.slice(11, 19) };
};
