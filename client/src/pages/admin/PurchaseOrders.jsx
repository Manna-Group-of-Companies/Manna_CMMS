import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Eye, FileCheck, Loader2, RefreshCw, Send, X } from "lucide-react";

import API from "../../services/api";
import { useAuth, MANAGER, PURCHASE_MANAGER } from "../../context/AuthContext";
import { useNotifications } from "../../context/NotificationContext";
import { useDialog } from "../../context/DialogContext";
import CancelNote, { CancelButton } from "../../components/CancelNote";
import { askCancelReason } from "../../utils/cancel";
import useAutoRefresh from "../../hooks/useAutoRefresh";
import { useSapSyncDone } from "../../hooks/useSapSync";
import { formatCurrency } from "../../utils/currency";
import Pagination from "../../components/Pagination";
import { pageSlice } from "../../utils/pageSlice";

const PAGE_SIZE = 10;

/**
 * Purchase orders made from quotations (24 Oct 2026), and where each stands.
 *
 * Made on the quotation page, never here. The sync posts each one straight
 * away; until SAP has it, it cannot be received. It turns Purchased when every
 * line is received, and Closed when it is closed or cancelled in SAP - the CMMS
 * closes and cancels nothing. Quantities are in the vendor's unit.
 *
 * Listed at a glance, as purchase requests are (27 Oct 2026): status, vendor,
 * items and value, with the lines, dates, notes and sending again behind the eye.
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
  const { prompt } = useDialog();
  // Mirrors the server's guard on sending one again.
  const canBuy = user?.role === PURCHASE_MANAGER || user?.role === MANAGER;

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [company, setCompany] = useState("");
  const [vendorCode, setVendorCode] = useState("");
  const [busy, setBusy] = useState("");
  // The PO whose details are open, by id, so a background reload shows the fresh copy.
  const [viewing, setViewing] = useState("");
  const [page, setPage] = useState(1);

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

  useAutoRefresh(() => load(true), { enabled: rows.some((r) => r.syncStatus === "Queued" || r.cancel?.status === "Queued") });
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

  // Cancelled in SAP by the sync; its request lines open for a new quotation (27 Oct 2026).
  const cancel = async (o) => {
    const reason = await askCancelReason(prompt, showToast, `purchase order ${o.id}`);
    if (reason === null) return;
    setBusy(o.id);
    try {
      const { data } = await API.post(`/purchase-orders/${o.id}/cancel`, { reason });
      showToast(data?.status === "Closed" ? `${o.id} cancelled` : `${o.id} is being cancelled in SAP`, "success");
      load(true);
    } catch (err) {
      showToast(err.response?.data?.message || "It could not be cancelled", "error");
    } finally {
      setBusy("");
    }
  };

  // The companies and the vendors on the list, for the filters: by code, shown by name. Not who made
  // them - that is always the purchase manager.
  const companies = useMemo(() => {
    const byCode = new Map();
    for (const r of rows) if (r.company) byCode.set(r.company, r.companyName || r.company);
    return [...byCode].sort((a, b) => a[1].localeCompare(b[1]));
  }, [rows]);
  const vendors = useMemo(() => {
    const byCode = new Map();
    for (const r of rows) if (r.vendorCode) byCode.set(r.vendorCode, r.vendorName || r.vendorCode);
    return [...byCode].sort((a, b) => a[1].localeCompare(b[1]));
  }, [rows]);

  const shown = useMemo(
    () =>
      rows.filter(
        (r) =>
          (!status || r.status === status) &&
          (!company || r.company === company) &&
          (!vendorCode || r.vendorCode === vendorCode)
      ),
    [rows, status, company, vendorCode]
  );

  // Ten to a page, as purchase requests; a filter change starts again from the first.
  const { page: current, rows: pageRows } = pageSlice(shown, page, PAGE_SIZE);
  const filterBy = (set) => (e) => {
    set(e.target.value);
    setPage(1);
  };
  const open = viewing ? rows.find((r) => r.id === viewing) : null;

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
            value={company}
            onChange={filterBy(setCompany)}
            className="field field-sm w-auto cursor-pointer"
            aria-label="Filter by company"
          >
            <option value="">All companies</option>
            {companies.map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </select>
          <select
            value={vendorCode}
            onChange={filterBy(setVendorCode)}
            className="field field-sm w-auto max-w-[16rem] cursor-pointer"
            aria-label="Filter by vendor"
          >
            <option value="">All vendors</option>
            {vendors.map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </select>
          <select
            value={status}
            onChange={filterBy(setStatus)}
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
                ? "No purchase orders match these filters."
                : "No purchase orders yet. They are made from quotations SAP has."}
            </p>
          </div>
        </div>
      ) : (
        <>
          <OrderList rows={pageRows} onView={(o) => setViewing(o.id)} />
          <Pagination page={current} total={shown.length} pageSize={PAGE_SIZE} onPage={setPage} noun="purchase order" />
        </>
      )}

      {open && (
        <div className="modal-backdrop" onClick={() => setViewing("")}>
          <OrderDetails
            order={open}
            onClose={() => setViewing("")}
            canBuy={canBuy}
            busy={busy === open.id}
            onRetry={() => retry(open)}
            onCancel={() => cancel(open)}
          />
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

/** Where the PO stands: Open / Purchased / Closed, and with SAP. Both, since an Open PO may not be in SAP yet. */
const Badges = ({ order: o }) => (
  <>
    <span className={`badge whitespace-nowrap ${STATUS_STYLE[o.status] || "badge-slate"}`}>{o.status}</span>
    <span className={`badge whitespace-nowrap ${SYNC_STYLE[o.syncStatus] || "badge-slate"}`}>{syncLabel(o)}</span>
  </>
);

/** The first item, and how many more: all a row has room for. */
const itemsSummary = (lines = []) => {
  if (!lines.length) return "—";
  const first = `${lines[0].name} × ${lines[0].qty} ${lines[0].vendorUnit || ""}`.trim();
  return lines.length > 1 ? `${first}, +${lines.length - 1} more` : first;
};

/** The eye: the way into everything about a PO, as on purchase requests. */
const ViewButton = ({ order: o, onView }) => (
  <button
    className="btn btn-sm btn-neutral btn-icon shrink-0 hover:border-brand-500 hover:text-brand-700"
    onClick={() => onView(o)}
    title="View full details"
    aria-label={`View purchase order ${o.id}`}
  >
    <Eye className="h-4 w-4" aria-hidden="true" />
  </button>
);

/** One short line per PO: where it stands, the vendor, what and how much. The rest is behind the eye. */
const OrderList = ({ rows, onView }) => (
  <>
    {/* Phone: a short card per PO. */}
    <div className="space-y-3 md:hidden">
      {rows.map((o) => (
        <div key={o.id} className="card flex items-center gap-4 p-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badges order={o} />
            </div>
            <p className="mt-2 truncate text-[13px] font-semibold text-slate-900">{o.vendorName || o.vendorCode}</p>
            <p className="mt-0.5 truncate text-[13px] text-slate-700">{itemsSummary(o.lines)}</p>
            <p className="mt-0.5 text-[12px] text-slate-500">
              {o.id} · {formatCurrency(o.value)}
            </p>
          </div>
          <ViewButton order={o} onView={onView} />
        </div>
      ))}
    </div>

    {/* Tablet and up: a table and the eye. */}
    <div className="table-card hidden md:block">
      <div className="table-scroll">
        <table className="tbl">
          <thead>
            <tr>
              <th className="w-[230px]">Status</th>
              <th className="w-[240px]">Vendor</th>
              <th>Items</th>
              <th className="w-[130px] text-right">Value</th>
              <th className="w-[80px] text-right">View</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => (
              <tr key={o.id} className="cursor-pointer" onClick={() => onView(o)}>
                <td className="py-4">
                  <div className="flex flex-wrap gap-1.5">
                    <Badges order={o} />
                  </div>
                </td>
                <td className="py-4">
                  <div className="max-w-[240px] truncate font-medium text-slate-800">{o.vendorName || o.vendorCode}</div>
                  <div className="text-[12px] text-slate-500">{o.companyName || o.company}</div>
                </td>
                <td className="py-4">
                  <div className="max-w-[420px] truncate text-slate-700" title={itemsSummary(o.lines)}>
                    {itemsSummary(o.lines)}
                  </div>
                </td>
                <td className="whitespace-nowrap py-4 text-right tabular-nums text-slate-800">{formatCurrency(o.value)}</td>
                {/* The row opens the details too; the eye is the visible way in. */}
                <td className="py-4" onClick={(e) => e.stopPropagation()}>
                  <div className="flex justify-end">
                    <ViewButton order={o} onView={onView} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  </>
);

/** Everything about one PO: the popup behind the eye. */
const OrderDetails = ({ order: o, onClose, canBuy, busy, onRetry, onCancel }) => (
  <div className="modal max-w-2xl" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
    <div className="modal-head">
      <div className="min-w-0">
        <h3 className="modal-title">
          <FileCheck className="h-[18px] w-[18px] text-brand-700 shrink-0" />
          Purchase order {o.id}
        </h3>
        <p className="modal-sub">
          {o.vendorName || o.vendorCode} · {o.companyName || o.company}
        </p>
      </div>
      <button onClick={onClose} className="modal-close" aria-label="Close">
        <X className="h-5 w-5" />
      </button>
    </div>

    <div className="modal-body space-y-6">
      <CancelNote cancel={o.cancel} error={o.error} />
      <div className="flex flex-wrap items-center gap-2">
        <Badges order={o} />
        {o.quotationExpired && <span className="badge badge-amber">Made after the quotation expired</span>}
        <span className="ml-auto text-[15px] font-bold tabular-nums text-slate-900">{formatCurrency(o.value)}</span>
      </div>

      <div className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
        <KV label="Vendor" value={o.vendorName ? `${o.vendorName} · ${o.vendorCode}` : o.vendorCode} />
        <KV label="Quotation · request" value={`${o.quotation} · ${o.request || "—"}`} />
        <KV label="Company" value={o.companyName || o.company} />
        <KV label="PO date · delivery" value={`${day(o.date) || "—"} · ${day(o.deliveryDate) || "—"}`} />
        <KV label="Made by" value={`${o.raisedByName || o.raisedBy || "—"} · ${when(o.raisedAt)}`} />
        <KV label="SAP purchase order" value={o.sapDocNumber} />
      </div>

      <div>
        <p className="mb-2 text-[12px] font-semibold text-slate-500">Items ({o.lines.length})</p>
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
          {o.lines.map((l) => (
            <li
              key={l.lineId}
              className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-4 py-3 text-[13px]"
            >
              <span className="min-w-0 text-slate-800">
                {l.name} <span className="mono text-[11px] text-slate-500">{l.sapItemCode || l.itemCode}</span>
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
      </div>

      {o.remarks && <p className="text-[13px] text-slate-600 italic">“{o.remarks}”</p>}
      {o.syncStatus === "Failed" && o.error && <p className="text-[13px] text-rose-700">SAP said: {o.error}</p>}
      {/* Waiting for its quotation, closed or cancelled, or a SAP close still to retry. A refused cancel says so above. */}
      {o.syncStatus !== "Failed" && o.error && o.cancel?.status !== "Failed" && (
        <p className="text-[13px] text-amber-700">{o.error}</p>
      )}
    </div>

    {canBuy && (o.syncStatus === "Failed" || !o.cancel?.refusal) && (
      <div className="modal-foot">
        <div className="flex flex-wrap justify-end gap-2">
          <CancelButton cancel={o.cancel} allowed={canBuy} busy={busy} onCancel={onCancel} />
          {o.syncStatus === "Failed" && (
            <button className="btn btn-sm btn-primary" disabled={busy} onClick={onRetry}>
              <Send className="h-4 w-4" />
              {busy ? "…" : "Send again"}
            </button>
          )}
        </div>
      </div>
    )}
  </div>
);

export default PurchaseOrders;
