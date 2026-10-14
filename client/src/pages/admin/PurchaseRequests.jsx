import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2, Plus, RefreshCw, Send, ShoppingCart, Truck } from "lucide-react";

import API from "../../services/api";
import { useAuth, MAINTENANCE_MANAGER, PRODUCTION_MANAGER } from "../../context/AuthContext";
import { useNotifications } from "../../context/NotificationContext";
import useAutoRefresh from "../../hooks/useAutoRefresh";
import { useSapSyncDone } from "../../hooks/useSapSync";
import PurchaseRequestModal from "./PurchaseRequestModal";

/**
 * Purchase requests raised from the CMMS, and where each stands in SAP.
 *
 * The Maintenance Manager raises one (decided 9 Oct 2026); the SAP server
 * creates the SAP Purchase Request within about a minute, the purchase manager
 * turns it into a Purchase Order, and that PO is received with Goods receipt.
 * Queued -> In SAP -> Ordered -> Closed; a failed one says why, and the
 * Maintenance Manager can send it again.
 */

const STATUS_STYLE = {
  Queued: "badge-amber",
  // No blue badge in index.css; the same recipe in blue.
  "In SAP": "border-blue-500/20 bg-blue-500/10 text-blue-600",
  Ordered: "badge-emerald",
  Closed: "badge-slate",
  Failed: "badge-rose",
};

const STATUSES = ["Queued", "In SAP", "Ordered", "Closed", "Failed"];

const when = (value) => {
  if (!value) return "—";
  const d = new Date(String(value).replace(" ", "T"));
  return Number.isNaN(d.getTime())
    ? String(value)
    : d.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
};

/** A required-by date is a calendar date; no time, and no timezone shift. */
const day = (value) => {
  if (!value) return "";
  const d = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString("en-IN", { dateStyle: "medium" });
};

const PurchaseRequests = () => {
  const { user } = useAuth();
  const { showToast } = useNotifications();
  // Mirrors the server: only the Maintenance Manager raises a request or re-sends it.
  // Maintenance, and since 14 Oct 2026 the plant heads - mirrors the server's guard.
  const canRaise = user?.role === MAINTENANCE_MANAGER || user?.role === PRODUCTION_MANAGER;

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState("");
  const [raising, setRaising] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const { data } = await API.get("/purchase-requests", { params: { limit: 100 } });
      const list = Array.isArray(data) ? data : [];
      // Newest first, whatever order the server sends.
      list.sort((a, b) => String(b.raisedAt || "").localeCompare(String(a.raisedAt || "")));
      setRows(list);
      setError("");
    } catch (err) {
      if (!silent) {
        setError(err.response?.data?.message || `Cannot reach the server at ${API.defaults.baseURL}.`);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Only worth polling while the SAP server still has something to create.
  // Paused while the dialog is open, so the list does not shift under it.
  const anyQueued = rows.some((r) => r.status === "Queued");
  useAutoRefresh(() => load(true), { enabled: anyQueued && !raising });

  // A finished run is what moves a request off Queued, so the row it moved is
  // the one on screen. Not while the dialog is open - the list would shift.
  useSapSyncDone(() => !raising && load(true));

  const retry = async (id) => {
    setBusy(id);
    try {
      await API.post(`/purchase-requests/${id}/retry`);
      showToast(`${id} sent to SAP again`, "success");
      load(true);
    } catch (err) {
      showToast(err.response?.data?.message || "That step was refused", "error");
    } finally {
      setBusy("");
    }
  };

  const shown = useMemo(() => rows.filter((r) => !status || r.status === status), [rows, status]);

  return (
    <div className="space-y-5">
      <div className="panel">
        <div className="flex items-center gap-3">
          <span className="panel-icon">
            <ShoppingCart className="h-5 w-5" />
          </span>
          <div>
            <h2 className="panel-title">Purchase requests</h2>
            <p className="panel-sub">
              SAP gets each one within about a minute; the purchase manager turns it into a
              purchase order.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="field field-sm w-auto cursor-pointer"
            aria-label="Filter by status"
          >
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <button className="btn btn-sm btn-neutral" onClick={() => load()} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
          {canRaise && (
            <button className="btn btn-sm btn-primary" onClick={() => setRaising(true)}>
              <Plus className="h-4 w-4" />
              New purchase request
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="note note-rose">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="h-40 grid place-items-center">
          <Loader2 className="h-6 w-6 animate-spin text-brand-500" />
        </div>
      ) : shown.length === 0 ? (
        <div className="table-card">
          <div className="empty">
            <ShoppingCart className="h-8 w-8 text-slate-300 mb-2" />
            <p className="empty-title">Nothing here</p>
            <p className="empty-sub">
              {rows.length
                ? "No purchase requests match this filter."
                : "No purchase requests have been raised yet."}
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {shown.map((r) => (
            <RequestCard
              key={r.id}
              request={r}
              canRetry={canRaise}
              busy={busy === r.id}
              onRetry={() => retry(r.id)}
            />
          ))}
        </div>
      )}

      {raising && (
        <div className="modal-backdrop">
          <PurchaseRequestModal onClose={() => setRaising(false)} onSaved={() => load(true)} />
        </div>
      )}
    </div>
  );
};

const KV = ({ label, value }) => (
  <div className="min-w-0">
    <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
    <p className="text-[13px] text-slate-800 break-words">{value || "—"}</p>
  </div>
);

const RequestCard = ({ request: r, canRetry, busy, onRetry }) => (
  <div className="card p-5">
    <div className="flex flex-wrap items-start gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="mono text-xs text-slate-500">{r.id}</span>
          <span className={`badge ${STATUS_STYLE[r.status] || "badge-slate"}`}>
            {r.status === "Queued" ? "Queued for SAP" : r.status}
          </span>
        </div>

        <div className="mt-2 grid sm:grid-cols-2 lg:grid-cols-5 gap-x-6 gap-y-2">
          <KV label="Company" value={r.companyName || r.company} />
          <KV label="SAP purchase request" value={r.sapDocNumber ? `PR ${r.sapDocNumber}` : ""} />
          <KV label="Purchase order" value={r.poNumbers ? `PO ${r.poNumbers}` : ""} />
          <KV label="Required by" value={day(r.requiredBy)} />
          <KV label="Raised by" value={`${r.raisedBy || "—"} · ${when(r.raisedAt)}`} />
        </div>

        {r.reason && <p className="mt-2 text-xs text-slate-600 italic">“{r.reason}”</p>}

        <ul className="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-100">
          {(r.lines || []).map((l, i) => (
            <li
              key={`${l.itemCode}-${i}`}
              className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-3 py-2 text-[13px]"
            >
              <span className="min-w-0 text-slate-800">
                {l.name}{" "}
                <span className="mono text-[11px] text-slate-500">{l.sapItemCode || l.itemCode}</span>
                {l.remarks && <span className="ml-2 text-[12px] text-slate-500">· {l.remarks}</span>}
              </span>
              <span className="whitespace-nowrap text-slate-700">
                × {l.qty} {l.unit}
              </span>
            </li>
          ))}
        </ul>

        {r.status === "Ordered" && (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-emerald-700">
            <Truck className="h-3.5 w-3.5 shrink-0" />
            Receive it with Goods receipt when the goods arrive.
          </p>
        )}

        {r.status === "Failed" && r.error && (
          <p className="mt-2 text-xs text-rose-700">SAP said: {r.error}</p>
        )}
      </div>

      {canRetry && r.status === "Failed" && (
        <div className="flex shrink-0 gap-2">
          <button className="btn btn-sm btn-primary" disabled={busy} onClick={onRetry}>
            <Send className="h-4 w-4" />
            {busy ? "…" : "Send again"}
          </button>
        </div>
      )}
    </div>
  </div>
);

export default PurchaseRequests;
