import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, FileCheck, Loader2, RefreshCw, Send } from "lucide-react";

import API from "../../services/api";
import { useAuth, MANAGER, PURCHASE_MANAGER } from "../../context/AuthContext";
import { useNotifications } from "../../context/NotificationContext";
import useAutoRefresh from "../../hooks/useAutoRefresh";
import { useSapSyncDone } from "../../hooks/useSapSync";
import { formatCurrency } from "../../utils/currency";

/**
 * Purchase orders made from quotations (24 Oct 2026), and where each stands.
 *
 * Made on the quotation page, never here. The sync posts each one straight
 * away; until SAP has it, it cannot be received. It turns Purchased when every
 * line is received, and Closed when it is closed or cancelled in SAP - the CMMS
 * closes and cancels nothing. Quantities are in the vendor's unit.
 */

const STATUS_STYLE = {
  Open: "border-blue-500/20 bg-blue-500/10 text-blue-600",
  Purchased: "badge-emerald",
  Closed: "badge-slate",
};

const SYNC_STYLE = {
  Queued: "badge-amber",
  Posted: "badge-emerald",
  Failed: "badge-rose",
};

const STATUSES = ["Open", "Purchased", "Closed"];

const when = (value) => {
  if (!value) return "—";
  const d = new Date(String(value).replace(" ", "T"));
  return Number.isNaN(d.getTime())
    ? String(value)
    : d.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
};

/** A PO's dates are calendar dates; no time, and no timezone shift. */
const day = (value) => {
  if (!value) return "";
  const d = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString("en-IN", { dateStyle: "medium" });
};

const syncLabel = (o) =>
  o.syncStatus === "Queued"
    ? "Pending sync"
    : o.syncStatus === "Posted"
      ? `SAP PO ${o.sapDocNumber || "posted"}`
      : "Refused by SAP";

const PurchaseOrders = () => {
  const { user } = useAuth();
  const { showToast } = useNotifications();
  // Mirrors the server's guard on sending one again.
  const canBuy = user?.role === PURCHASE_MANAGER || user?.role === MANAGER;

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState("");

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const { data } = await API.get("/purchase-orders", { params: { limit: 150 } });
      setRows(Array.isArray(data) ? data : []);
      setError("");
    } catch (err) {
      if (!silent) setError(err.response?.data?.message || `Cannot reach the server at ${API.defaults.baseURL}.`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useAutoRefresh(() => load(true), { enabled: rows.some((r) => r.syncStatus === "Queued") });
  useSapSyncDone(() => load(true));

  const retry = async (o) => {
    setBusy(o.id);
    try {
      await API.post(`/purchase-orders/${o.id}/retry`);
      showToast(`${o.id} sent to SAP again`, "success");
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
            <FileCheck className="h-5 w-5" />
          </span>
          <div>
            <h2 className="panel-title">Purchase orders</h2>
            <p className="panel-sub">
              Made from quotations. Each is received once SAP has it; quantities are in the vendor's unit.
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
            <FileCheck className="h-8 w-8 text-slate-300 mb-2" />
            <p className="empty-title">Nothing here</p>
            <p className="empty-sub">
              {rows.length
                ? "No purchase orders match this filter."
                : "No purchase orders yet. They are made from quotations SAP has."}
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {shown.map((o) => (
            <div key={o.id} className="card p-5">
              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="mono text-xs text-slate-500">{o.id}</span>
                    <span className={`badge ${STATUS_STYLE[o.status] || "badge-slate"}`}>{o.status}</span>
                    <span className={`badge ${SYNC_STYLE[o.syncStatus] || "badge-slate"}`}>{syncLabel(o)}</span>
                    {o.quotationExpired && <span className="badge badge-amber">Made after the quotation expired</span>}
                    <span className="ml-auto text-[13px] font-semibold tabular-nums text-slate-900">
                      {formatCurrency(o.value)}
                    </span>
                  </div>

                  <div className="mt-2 grid sm:grid-cols-2 lg:grid-cols-5 gap-x-6 gap-y-2">
                    <KV label="Vendor" value={o.vendorName ? `${o.vendorName} · ${o.vendorCode}` : o.vendorCode} />
                    <KV label="Quotation · request" value={`${o.quotation} · ${o.request || "—"}`} />
                    <KV label="Company" value={o.companyName || o.company} />
                    <KV label="PO date · delivery" value={`${day(o.date) || "—"} · ${day(o.deliveryDate) || "—"}`} />
                    <KV label="Made by" value={`${o.raisedBy || "—"} · ${when(o.raisedAt)}`} />
                  </div>

                  <ul className="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-100">
                    {o.lines.map((l) => (
                      <li
                        key={l.lineId}
                        className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-3 py-2 text-[13px]"
                      >
                        <span className="min-w-0 text-slate-800">
                          {l.name}{" "}
                          <span className="mono text-[11px] text-slate-500">{l.sapItemCode || l.itemCode}</span>
                        </span>
                        <span className="whitespace-nowrap text-slate-700">
                          {l.qty} {l.vendorUnit} @ {formatCurrency(l.price)}
                          <span className="ml-2 text-[12px] text-slate-500">
                            · received {l.received}, pending {l.pending}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>

                  {o.remarks && <p className="mt-2 text-xs text-slate-600 italic">“{o.remarks}”</p>}
                  {o.syncStatus === "Failed" && o.error && (
                    <p className="mt-2 text-xs text-rose-700">SAP said: {o.error}</p>
                  )}
                  {/* Waiting for its quotation, closed or cancelled in SAP, or a SAP close still to retry. */}
                  {o.syncStatus !== "Failed" && o.error && <p className="mt-2 text-xs text-amber-700">{o.error}</p>}
                </div>

                {canBuy && o.syncStatus === "Failed" && (
                  <button className="btn btn-sm btn-primary shrink-0" disabled={busy === o.id} onClick={() => retry(o)}>
                    <Send className="h-4 w-4" />
                    {busy === o.id ? "…" : "Send again"}
                  </button>
                )}
              </div>
            </div>
          ))}
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

export default PurchaseOrders;
