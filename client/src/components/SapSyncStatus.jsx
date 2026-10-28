import { useCallback, useEffect, useRef, useState } from "react";
import API from "../services/api";
import { useNotifications } from "../context/NotificationContext";
import { announceSapSyncDone } from "../hooks/useSapSync";
import { LastSyncLine } from "./SapLastSync";

const BUSY = ["Queued", "Running"];

/**
 * When the SAP server last ran, in the top bar.
 *
 * The "Sync with SAP" button that sat here was taken out on 28 Oct 2026 (the user's call): every save raises the
 * flag itself and the watcher on the SAP server runs within seconds, so a button that asked for the same run only
 * invited people to press it while waiting. What stays is the line saying when SAP last ran, and - when a run is
 * already under way as the screen opens - the toast and the page reload when it finishes.
 */
const SapSyncStatus = () => {
  const { showToast } = useNotifications();
  const [status, setStatus] = useState(null);
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

  if (!status) return null;

  return <LastSyncLine status={status} className="hidden md:block text-right leading-tight" />;
};

export default SapSyncStatus;
