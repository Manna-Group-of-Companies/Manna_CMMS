import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import API from "../services/api";
import { useAuth, MAINTENANCE_MANAGER, MANAGER, PRODUCTION_MANAGER } from "../context/AuthContext";
import { useNotifications } from "../context/NotificationContext";
import { announceSapSyncDone } from "../hooks/useSapSync";
import { LastSyncLine } from "./SapLastSync";

const BUSY = ["Queued", "Running"];

/** Seconds left until `cooldownUntil` (an IST datetime string from ERPNext). */
const secondsLeft = (cooldownUntil) => {
  if (!cooldownUntil) return 0;
  const end = new Date(String(cooldownUntil).replace(" ", "T"));
  if (Number.isNaN(end.getTime())) return 0;
  return Math.max(0, Math.ceil((end - Date.now()) / 1000));
};

const formatCountdown = (secs) => {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
};

const SapSyncButton = () => {
  const { user } = useAuth();
  const { showToast } = useNotifications();
  const [status, setStatus] = useState(null);
  const [asking, setAsking] = useState(false);
  const wasBusy = useRef(false);
  const [cooldown, setCooldown] = useState(0);

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

  // Cooldown countdown — ticks every second while time remains.
  useEffect(() => {
    const remaining = secondsLeft(status?.cooldownUntil);
    setCooldown(remaining);
    if (remaining <= 0) return undefined;
    const timer = setInterval(() => {
      setCooldown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [status?.cooldownUntil]);

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

  if (!status) return null;

  const onCooldown = cooldown > 0;
  const disabled = asking || busy || onCooldown;

  return (
    <div className="flex items-center gap-2.5 min-w-0">
      <LastSyncLine status={status} className="hidden md:block text-right leading-tight" />
      {[MAINTENANCE_MANAGER, PRODUCTION_MANAGER, MANAGER].includes(user?.role) && (
        <button
          onClick={ask}
          disabled={disabled}
          className="btn btn-sm btn-neutral shrink-0"
          title={title}
        >
          {asking || busy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          <span className="hidden sm:inline">
            {busy
              ? status.status === "Queued" ? "Waiting for SAP…" : "Syncing…"
              : onCooldown
                ? formatCountdown(cooldown)
                : "Sync with SAP"}
          </span>
          {/* On narrow screens the icon alone carries the button, so show the
              countdown as a small overlay beside it. */}
          {onCooldown && (
            <span className="sm:hidden text-[10px] font-bold tabular-nums">
              {formatCountdown(cooldown)}
            </span>
          )}
        </button>
      )}
    </div>
  );
};

export default SapSyncButton;
