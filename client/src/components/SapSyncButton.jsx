import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import API from "../services/api";
import { useNotifications } from "../context/NotificationContext";

/**
 * "Sync with SAP" (9 Oct 2026). One press raises the flag on the SAP item master
 * sync; the flag watcher on the SAP server starts a run within seconds, which
 * pushes everything waiting (new items, edits, receipts, purchase requests) and
 * fetches the engineering items and their stock from SAP. Nothing syncs on a
 * timer - this, or saving something that goes to SAP, is what starts a run.
 *
 * Polls the status every 3 s while a run is Queued or Running, then says how it
 * went and calls `onDone` so the list can reload.
 */
const BUSY = ["Queued", "Running"];

const SapSyncButton = ({ onDone }) => {
  const { showToast } = useNotifications();
  const [status, setStatus] = useState(null);
  const [asking, setAsking] = useState(false);
  const wasBusy = useRef(false);
  // The parent passes a new function each render; a ref keeps the poll timer from restarting on it.
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

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
        showToast(status?.lastResult || (failed ? "The SAP sync failed." : "SAP sync finished."), failed ? "error" : "success");
        doneRef.current?.();
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

  return (
    <button onClick={ask} disabled={asking || busy} className="btn btn-neutral w-full sm:w-auto" title={title}>
      {asking || busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
      {busy ? (status.status === "Queued" ? "Waiting for SAP…" : "Syncing with SAP…") : "Sync with SAP"}
    </button>
  );
};

export default SapSyncButton;
