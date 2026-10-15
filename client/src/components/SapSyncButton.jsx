import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import API from "../services/api";
import { useAuth, MAINTENANCE_MANAGER, MANAGER, PRODUCTION_MANAGER } from "../context/AuthContext";
import { useNotifications } from "../context/NotificationContext";
import { announceSapSyncDone } from "../hooks/useSapSync";
import { LastSyncLine } from "./SapLastSync";

/**
 * "Sync with SAP" (9 Oct 2026). One press raises the flag on the SAP item master
 * sync; the flag watcher on the SAP server starts a run within seconds, which
 * pushes everything waiting (new items, edits, receipts, purchase requests) and
 * fetches the engineering items and their stock from SAP. Nothing syncs on a
 * timer - this, or saving something that goes to SAP, is what starts a run.
 *
 * In the top bar since 13 Oct 2026, beside the time of the last finished run,
 * and only on the screens SAP is behind - see `SAP_SYNC_PATHS` in AdminLayout.
 * There is one sync for the whole system, so a button per SAP screen was four
 * buttons for one job; and on a screen SAP is not behind, a run that touches
 * nothing on it reads as a sync that did not work.
 *
 * Polls the status every 3 s while a run is Queued or Running, then says how it
 * went and announces it, so whichever list is underneath can reload itself.
 *
 * The button is the Maintenance Manager's, matching the server's guard on
 * POST /products/category-sync. Everyone else keeps the time: knowing how old
 * the figures are is not the same as being able to refresh them.
 */
const BUSY = ["Queued", "Running"];

const SapSyncButton = () => {
  const { user } = useAuth();
  const { showToast } = useNotifications();
  const [status, setStatus] = useState(null);
  const [asking, setAsking] = useState(false);
  const wasBusy = useRef(false);

  const load = useCallback(async () => {
    try {
      const { data } = await API.get("/products/category-sync");
      setStatus(data);
      return data;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const busy = BUSY.includes(status?.status);

  useEffect(() => {
    if (!busy) {
      if (wasBusy.current) {
        wasBusy.current = false;
        const failed = status?.status === "Failed";
        showToast(failed ? "SAP sync failed" : "SAP synced", failed ? "error" : "success");
        announceSapSyncDone();
      }
      return undefined;
    }
    wasBusy.current = true;
    const timer = setInterval(load, 3000);
    return () => clearInterval(timer);
  }, [busy, load, showToast, status?.status, status?.lastResult]);

  const ask = async () => {
    setAsking(true);
    try {
      const { data } = await API.post("/products/category-sync");
      setStatus(data);
    } catch (error) {
      showToast(error.response?.data?.message || "Could not ask the SAP server for a sync", "error");
    } finally {
      setAsking(false);
    }
  };

  const title = status
    ? [
        `SAP sync: ${status.status}${status.dryRun ? " (dry run - SAP is not written)" : ""}`,
        status.lastSyncAt ? `Last run ${status.lastSyncAt}` : "",
        status.lastResult || "",
      ]
        .filter(Boolean)
        .join("\n")
    : "Sync with SAP";

  // Nothing to show at all until the first status lands - an empty bar beats a
  // button that might turn out to be the wrong one for this person.
  if (!status) return null;

  return (
    <div className="flex items-center gap-2.5 min-w-0">
      {/* The bar is 64px and the title already owns the left of it, so the time
          waits for a screen wide enough to carry both. */}
      <LastSyncLine status={status} className="hidden md:block text-right leading-tight" />
      {[MAINTENANCE_MANAGER, PRODUCTION_MANAGER, MANAGER].includes(user?.role) && (
        <button
          onClick={ask}
          disabled={asking || busy}
          className="btn btn-sm btn-neutral shrink-0"
          title={title}
        >
          {asking || busy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          {/* Below sm the icon carries it; the label would push the bell off. */}
          <span className="hidden sm:inline">
            {busy ? (status.status === "Queued" ? "Waiting for SAP…" : "Syncing…") : "Sync with SAP"}
          </span>
        </button>
      )}
    </div>
  );
};

export default SapSyncButton;
