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
 *
 * And it is the ERPNext timezone, named here - not this process's own. The
 * first fix shifted by `getTimezoneOffset()`, which is right only on a machine
 * whose clock is set to India; on Render it is 0, so every record the deployed
 * server stamped from 14 Oct 2026 was UTC again, 5:30 early (PR-2026-00323's
 * PO, saved 17:49, read 12:19), while a copy run on an office PC was right.
 */
const ERP_TIME_ZONE = process.env.ERPNEXT_TIME_ZONE || "Asia/Kolkata";

const wallClock = new Intl.DateTimeFormat("en-CA", {
  timeZone: ERP_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** ERPNext wall-clock time as `YYYY-MM-DD HH:MM:SS`, whatever this machine's timezone. */
export const erpNow = (date = new Date()) => {
  const p = Object.fromEntries(wallClock.formatToParts(date).map(({ type, value }) => [type, value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
};

/** ERPNext wall-clock date as `YYYY-MM-DD`. */
export const erpToday = (date = new Date()) => erpNow(date).slice(0, 10);

/** ERPNext's separate date and time-of-day fields, from one moment. */
export const erpPostingParts = (at = new Date()) => {
  const stamp = erpNow(at instanceof Date ? at : new Date(at));
  return { posting_date: stamp.slice(0, 10), posting_time: stamp.slice(11, 19) };
};
