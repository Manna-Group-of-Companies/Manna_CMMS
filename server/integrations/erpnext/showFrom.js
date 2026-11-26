/**
 * Records raised before this moment are hidden (26 Nov 2026).
 *
 * The plant asked for a clean start: every breakdown and maintenance request
 * raised before the two stock-taking requests (MR-2026-00742 and -00743, created
 * 11:05:54) is left out of the lists, the detail and the breakdown report.
 * Anything raised from then on shows as usual, and the screens and buttons are
 * unchanged. Nothing is deleted or edited in ERPNext - set this to "" and every
 * old record is back.
 *
 * Compared with ERPNext's own `creation` stamp, which is in the site's local
 * time ("YYYY-MM-DD HH:MM:SS"), so a plain string comparison orders it.
 */
export const SHOW_FROM = "2026-11-26 11:05:00";

/** The filter that leaves the older records out of an ERPNext list. */
export const shownFilters = (doctype) => (SHOW_FROM ? [[doctype, "creation", ">=", SHOW_FROM]] : []);

/** True when a record with this `creation` stamp is shown. */
export const isShown = (creation) => !SHOW_FROM || String(creation || "") >= SHOW_FROM;
