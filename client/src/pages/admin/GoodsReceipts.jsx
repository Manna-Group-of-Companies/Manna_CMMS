import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ClipboardCheck, Loader2, Package, Plus, RefreshCw, Send } from "lucide-react";

import API from "../../services/api";
import { useAuth, MAINTENANCE_MANAGER, PRODUCTION_MANAGER } from "../../context/AuthContext";
import { useNotifications } from "../../context/NotificationContext";
import useAutoRefresh from "../../hooks/useAutoRefresh";
import { formatCurrency } from "../../utils/currency";
import GoodsReceiptModal from "./GoodsReceiptModal";

/**
 * Stock brought into the engineering store, and whether SAP has posted it.
 *
 * Two kinds (decided 9 Oct 2026): a goods receipt from a supplier's bill
 * against a SAP purchase order, entered here, and opening stock, stock with no
 * bill at nil value, entered as the opening quantity when an item is added on
 * Engineering Stock. Both are queued for the SAP server, which posts them
 * within about a minute; a failed one says why, and the Maintenance Manager
 * can send it again.
 */

const STATUS_STYLE = {
  Queued: "badge-amber",
  Posted: "badge-emerald",
  Failed: "badge-rose",
};

const KIND_STYLE = {
  "Goods Receipt": "badge-indigo",
  "Stock Addition": "badge-violet",
};

/** What each kind is called on screen. "Stock Addition" is the stored value
    the SAP sync reads, so it is renamed here rather than in the data. */
const KIND_LABEL = {
  "Goods Receipt": "Goods receipt",
  "Stock Addition": "Opening stock",
};

const when = (value) => {
  if (!value) return "—";
  const d = new Date(String(value).replace(" ", "T"));
  return Number.isNaN(d.getTime())
    ? String(value)
    : d.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
};

/** A bill date is a calendar date; no time, and no timezone shift. */
const day = (value) => {
  if (!value) return "";
  const d = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString("en-IN", { dateStyle: "medium" });
};

const GoodsReceipts = () => {
  const { user } = useAuth();
  const { showToast } = useNotifications();
  // Mirrors the server: only the Maintenance Manager receives stock or re-sends it.
  // Maintenance, and since 14 Oct 2026 the plant heads - mirrors the server's guard.
  const canReceive = user?.role === MAINTENANCE_MANAGER || user?.role === PRODUCTION_MANAGER;

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [kind, setKind] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState("");
  const [receiving, setReceiving] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const { data } = await API.get("/goods-receipts", { params: { limit: 100 } });
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

  // Only worth polling while the SAP server still has something to post.
  const anyQueued = rows.some((r) => r.status === "Queued");
  useAutoRefresh(() => load(true), { enabled: anyQueued });

  const retry = async (id) => {
    setBusy(id);
    try {
      await API.post(`/goods-receipts/${id}/retry`);
      showToast(`${id} sent to SAP again`, "success");
      load(true);
    } catch (err) {
      showToast(err.response?.data?.message || "That step was refused", "error");
    } finally {
      setBusy("");
    }
  };

  const shown = useMemo(
    () => rows.filter((r) => (!kind || r.kind === kind) && (!status || r.status === status)),
    [rows, kind, status]
  );

  return (
    <div className="space-y-5">
      <div className="panel">
        <div className="flex items-center gap-3">
          <span className="panel-icon">
            <ClipboardCheck className="h-5 w-5" />
          </span>
          <div>
            <h2 className="panel-title">Goods receipts and opening stock</h2>
            <p className="panel-sub">
              SAP posts each one within about a minute; the stock changes once it is posted.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            className="field field-sm w-auto cursor-pointer"
            aria-label="Filter by kind"
          >
            <option value="">All kinds</option>
            <option value="Goods Receipt">Goods receipts</option>
            <option value="Stock Addition">Opening stock (no bill)</option>
          </select>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="field field-sm w-auto cursor-pointer"
            aria-label="Filter by status"
          >
            <option value="">All statuses</option>
            <option value="Queued">Queued</option>
            <option value="Posted">Posted</option>
            <option value="Failed">Failed</option>
          </select>
          <button className="btn btn-sm btn-neutral" onClick={() => load()} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
          {canReceive && (
            <button className="btn btn-sm btn-primary" onClick={() => setReceiving(true)}>
              <Plus className="h-4 w-4" />
              New goods receipt
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
            <Package className="h-8 w-8 text-slate-300 mb-2" />
            <p className="empty-title">Nothing here</p>
            <p className="empty-sub">
              {rows.length
                ? "No receipts match these filters."
                : "No goods receipts or opening stock have been entered yet."}
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {shown.map((r) => (
            <ReceiptCard
              key={r.id}
              receipt={r}
              canRetry={canReceive}
              busy={busy === r.id}
              onRetry={() => retry(r.id)}
            />
          ))}
        </div>
      )}

      {receiving && (
        <div className="modal-backdrop">
          <GoodsReceiptModal onClose={() => setReceiving(false)} onSaved={() => load(true)} />
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

const ReceiptCard = ({ receipt: r, canRetry, busy, onRetry }) => {
  const isGr = r.kind === "Goods Receipt";
  const sapDoc = r.sapDocNumber
    ? `${isGr ? "GRPO" : "Goods Receipt"} ${r.sapDocNumber}${
        r.sapRevaluation ? ` · revaluation ${r.sapRevaluation}` : ""
      }`
    : "";
  const erpDoc = [r.erpStockEntry, r.erpReconciliation].filter(Boolean).join(" · ");

  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="mono text-xs text-slate-500">{r.id}</span>
            <span className={`badge badge-soft ${KIND_STYLE[r.kind] || "badge-slate"}`}>
              {KIND_LABEL[r.kind] || r.kind}
            </span>
            <span className={`badge ${STATUS_STYLE[r.status] || "badge-slate"}`}>
              {r.status === "Queued" ? "Queued for SAP" : r.status}
            </span>
            {r.fromNewItem && (
              <span className="badge badge-slate badge-soft">New item</span>
            )}
          </div>

          <div className="mt-2 grid sm:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-2">
            <KV label="Company" value={r.companyName || r.company} />
            {isGr && (
              <>
                <KV
                  label="Purchase order"
                  value={[r.poNumber && `PO ${r.poNumber}`, r.vendorName].filter(Boolean).join(" · ")}
                />
                <KV label="Bill" value={[r.billNo, day(r.billDate)].filter(Boolean).join(" · ")} />
              </>
            )}
            <KV label="SAP document" value={sapDoc} />
            {erpDoc && <KV label="ERPNext" value={erpDoc} />}
            <KV label="Raised by" value={`${r.raisedBy || "—"} · ${when(r.raisedAt)}`} />
            {r.postedAt && <KV label="Posted" value={when(r.postedAt)} />}
          </div>

          <ul className="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-100">
            {(r.lines || []).map((l, i) => (
              <li
                key={`${l.itemCode}-${l.poLine ?? i}`}
                className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-3 py-2 text-[13px]"
              >
                <span className="min-w-0 text-slate-800">
                  {l.name}{" "}
                  <span className="mono text-[11px] text-slate-500">{l.sapItemCode || l.itemCode}</span>
                </span>
                <span className="whitespace-nowrap text-slate-700">
                  × {l.qty} {l.unit} @ {Number(l.rate) > 0 ? formatCurrency(l.rate) : "nil"}
                  {(l.hsnCode || l.taxRate) && (
                    <span className="ml-2 mono text-[11px] text-slate-500">
                      {[l.hsnCode, l.taxRate].filter(Boolean).join(" · ")}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>

          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            {r.remarks ? (
              <p className="text-xs text-slate-600 italic">“{r.remarks}”</p>
            ) : (
              <span />
            )}
            <p className="text-[13px] font-semibold text-slate-900">
              Total {Number(r.total) > 0 ? formatCurrency(r.total) : "nil value"}
            </p>
          </div>

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
};

export default GoodsReceipts;
