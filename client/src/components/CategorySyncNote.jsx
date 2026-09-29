import { useEffect, useState } from "react";
import API from "../services/api";
import { AlertTriangle, CheckCircle2, Clock, Loader2, RefreshCw, XCircle } from "lucide-react";

/**
 * Where the SAP copy of the categories stands.
 *
 * Category edits are saved in ERPNext at once and reach SAP through the flagged
 * sync on the SAP server, so "saved" and "in SAP" are two different moments.
 * This says which one we are at. Polls every 5 s while a run is queued or going.
 */
const fmt = (value) => (value ? String(value).slice(0, 16) : "");

const CategorySyncNote = ({ compact = false, refreshKey = 0 }) => {
  const [status, setStatus] = useState(null);

  useEffect(() => {
    let live = true;
    let timer = null;
    const load = () =>
      API.get("/products/category-sync")
        .then(({ data }) => {
          if (!live) return;
          setStatus(data);
          if (data.status === "Queued" || data.status === "Running") timer = setTimeout(load, 5000);
        })
        .catch(() => live && setStatus(null));
    load();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [refreshKey]);

  if (!status) return null;

  const rows = [];
  if (status.dryRun) {
    rows.push(
      <div key="dry" className="note note-amber text-[13px] items-start">
        <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
        <span>
          The SAP category sync is in <b>dry-run</b> mode: edits are saved here, and the sync only reports what it
          would change in SAP. Switch dry-run off on "SAP Item Category Sync Control" in ERPNext to let it write.
        </span>
      </div>
    );
  }

  const icon = {
    Queued: <Clock className="h-4 w-4 shrink-0" />,
    Running: <Loader2 className="h-4 w-4 shrink-0 animate-spin" />,
    Success: <CheckCircle2 className="h-4 w-4 shrink-0" />,
    Failed: <XCircle className="h-4 w-4 shrink-0" />,
  }[status.status] || <RefreshCw className="h-4 w-4 shrink-0" />;
  const tone = { Failed: "note-rose", Success: "note-emerald", Queued: "note-brand", Running: "note-brand" }[status.status] || "note-slate";

  const line =
    status.status === "Queued"
      ? `Waiting for the SAP server to pick up the change${status.requestedAt ? ` (asked ${fmt(status.requestedAt)})` : ""}.`
      : status.status === "Running"
        ? "The SAP server is updating SAP now."
        : status.lastResult
          ? `Last SAP sync ${fmt(status.lastSyncAt || status.lastRunStartedAt)}: ${status.lastResult}`
          : "No SAP category sync has run yet.";

  if (!compact || status.pendingCount || status.status !== "Idle") {
    rows.push(
      <div key="state" className={`note ${tone} text-[13px] items-start`}>
        {icon}
        <span>
          {line}
          {status.pendingCount > 0 && (
            <>
              {" "}
              <b>{status.pendingCount}</b> item{status.pendingCount === 1 ? "" : "s"} waiting to reach SAP.
            </>
          )}
          {status.failedCount > 0 && (
            <>
              {" "}
              <b>{status.failedCount}</b> failed last time
              {!compact && status.failed?.length ? `: ${status.failed.map((f) => `${f.code} (${f.error})`).join("; ")}` : ""}.
            </>
          )}
        </span>
      </div>
    );
  }

  return <div className="space-y-2">{rows}</div>;
};

export default CategorySyncNote;
