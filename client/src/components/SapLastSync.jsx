/**
 * When the SAP server last finished a run.
 *
 * One sync carries everything waiting in both directions - new items, item
 * edits, goods receipts, purchase requests, spares issues - so every screen
 * that hands work to SAP is waiting on the same run, and there is one time to
 * report rather than one per screen. Nothing runs on a timer: the application
 * plants a flag, and the watcher on the SAP server picks it up within seconds.
 *
 * Kept apart from the button because the wording is the point, and it is read
 * by people who cannot press it. A time with no mention of dry run would say a
 * screen is current at exactly the moment it is not.
 */

/**
 * ERPNext sends "2026-10-13 11:35:28", which Safari and Firefox refuse to parse
 * as a date at all - hence the "T". No zone suffix is deliberate: the site and
 * the plants are both on IST, so this reads as local time, matching every other
 * ERPNext stamp in the app.
 */
const when = (value) => {
  const d = new Date(String(value).replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
};

const BUSY = ["Queued", "Running"];

/**
 * `lastSyncAt` is the last run that *finished*, so a failed or running one
 * leaves the last time real figures came over - which is what "last synced"
 * has to mean if it is to be worth reading.
 */
export const LastSyncLine = ({ status, className = "" }) => {
  if (!status) return null;
  return (
    <p className={`text-[11px] text-slate-500 ${className}`}>
      {status.lastSyncAt ? `Last synced from SAP ${when(status.lastSyncAt)}` : "Not synced from SAP yet"}
      {/*
        A dry run finishes and stamps the time like any other, having exchanged
        nothing. Saying so is the difference between a time that means these
        figures are current and one that does not.
      */}
      {status.dryRun && <span className="text-amber-700"> (dry run)</span>}
      {BUSY.includes(status.status) && <span className="text-brand-700"> · syncing now</span>}
    </p>
  );
};
