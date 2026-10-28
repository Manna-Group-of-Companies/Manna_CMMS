import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Ban,
  Eye,
  FileText,
  Loader2,
  Plus,
  RotateCcw,
  Send,
  ShoppingCart,
  Truck,
  X,
} from "lucide-react";

import API from "../../services/api";
import {
  useAuth,
  MAINTENANCE_MANAGER,
  MANAGER,
  PRODUCTION_MANAGER,
  PURCHASE_MANAGER,
} from "../../context/AuthContext";
import { useNotifications } from "../../context/NotificationContext";
import { useDialog } from "../../context/DialogContext";
import useAutoRefresh from "../../hooks/useAutoRefresh";
import { useSapSyncDone } from "../../hooks/useSapSync";
import { useErpRefresh } from "../../hooks/useErpRefresh";
import PurchaseRequestModal from "./PurchaseRequestModal";
import PurchaseQuotationModal from "./PurchaseQuotationModal";
import { formatCurrency } from "../../utils/currency";
import Pagination from "../../components/Pagination";
import CancelNote, { CancelButton } from "../../components/CancelNote";
import { askCancelReason } from "../../utils/cancel";
import { pageSlice } from "../../utils/pageSlice";

const PAGE_SIZE = 10;

/**
 * Purchase requests raised from the CMMS, and where each stands in SAP.
 *
 * The Maintenance Manager raises one (decided 9 Oct 2026); the SAP server
 * creates the SAP Purchase Request within about a minute, the purchase manager
 * turns it into a Purchase Order, and that PO is received with Goods receipt.
 * Queued -> In SAP -> Ordered -> Closed; a failed one says why, and the
 * Maintenance Manager can send it again. Since 23 Oct 2026 an Ordered one goes
 * Completed once its goods receipts cover every item - the server's check.
 *
 * Since 20 Oct 2026 the purchase manager can make that PO here instead of in
 * SAP; the sync posts it, and the request goes Ordered as for one made in SAP.
 *
 * Since 24 Oct 2026 the purchase manager enters the chosen vendor's quotation
 * against it instead, and makes the PO from the quotation on its own page.
 * Each line shows whether it is quoted, dropped (and why), or still open; the
 * details list its quotations and the PO made from each. A PO made on the
 * request before then, and refused by SAP, can still be sent again.
 */

/** A quotation, as it stands with the sync. */
const QUOTE_STYLE = {
  Queued: "badge-amber",
  Posted: "badge-emerald",
  Failed: "badge-rose",
  Cancelled: "badge-slate",
};

/** The PO made here, as it stands with the sync. */
const ORDER_STYLE = {
  Queued: "badge-amber",
  Posted: "badge-emerald",
  Failed: "badge-rose",
  Cancelled: "badge-slate",
};

const STATUS_STYLE = {
  Queued: "badge-amber",
  // No blue badge in index.css; the same recipe in blue.
  "In SAP": "border-blue-500/20 bg-blue-500/10 text-blue-600",
  // Lighter than Quotation Made: the same step, not finished.
  "Partially Quoted": "border-violet-500/20 bg-white text-violet-600",
  "Quotation Made": "border-violet-500/20 bg-violet-500/10 text-violet-600",
  Ordered: "badge-emerald",
  Completed: "badge-cyan",
  Closed: "badge-slate",
  Failed: "badge-rose",
};

const STATUSES = ["Queued", "In SAP", "Partially Quoted", "Quotation Made", "Ordered", "Completed", "Closed", "Failed"];

/**
 * Where a request stands, as shown and filtered (26 Oct 2026): the server's stage, which goes Partially Quoted,
 * Quotation Made, Ordered and Completed as soon as they are true. `status` is what SAP says, and what the actions
 * go by.
 */
const stageOf = (r) => r.stage || r.status;

/**
 * The purchase manager's work on a request (27 Oct 2026), from the server: Pending until a PO is made for every
 * line not dropped, whatever stage it is at, then Complete. A filter of its own beside the status.
 */
const WORK = ["Pending", "Complete"];
const WORK_STYLE = { Pending: "badge-amber", Complete: "badge-emerald" };

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
  const { prompt } = useDialog();
  // Mirrors the server: only the Maintenance Manager raises a request or re-sends it.
  // Maintenance, and since 14 Oct 2026 the plant heads - mirrors the server's guard.
  const canRaise = user?.role === MAINTENANCE_MANAGER || user?.role === PRODUCTION_MANAGER;
  // Quoting and dropping lines commit the company's money: the purchase manager,
  // and the Admin as the usual fallback - mirrors the server's guard.
  const canBuy = user?.role === PURCHASE_MANAGER || user?.role === MANAGER;

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [work, setWork] = useState("");
  const [company, setCompany] = useState("");
  const [raisedBy, setRaisedBy] = useState("");
  const [sapCompanies, setSapCompanies] = useState([]);
  const [busy, setBusy] = useState("");
  const [raising, setRaising] = useState(false);
  const [quoting, setQuoting] = useState(null);
  // The request whose full details are open, by id, so a background reload
  // shows the fresh copy rather than the one the eye was pressed on.
  const [viewing, setViewing] = useState("");
  const [page, setPage] = useState(1);

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

  // The top bar's Refresh, in place of a button of the page's own.
  useErpRefresh(() => load(true));

  // Every SAP company, so the filter offers one before it has a request. If
  // this fails, the filter still offers the companies on the list.
  useEffect(() => {
    API.get("/purchase-requests/companies")
      .then(({ data }) => setSapCompanies(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  // Only worth polling while the SAP server still has something to create.
  // Paused while the dialog is open, so the list does not shift under it.
  const anyQueued = rows.some(
    (r) =>
      r.status === "Queued" ||
      r.cancel?.status === "Queued" ||
      r.order?.status === "Queued" ||
      r.quotations?.some((q) => q.status === "Queued")
  );
  useAutoRefresh(() => load(true), { enabled: anyQueued && !raising && !quoting });

  // A finished run is what moves a request off Queued, so the row it moved is
  // the one on screen. Not while the dialog is open - the list would shift.
  useSapSyncDone(() => !raising && !quoting && load(true));

  // Cancelled in SAP by the sync once the server takes it (27 Oct 2026). Its quotations and POs go first.
  const cancelRequest = async (r) => {
    const reason = await askCancelReason(prompt, showToast, `purchase request ${r.id}`);
    if (reason === null) return;
    setBusy(r.id);
    try {
      const { data } = await API.post(`/purchase-requests/${r.id}/cancel`, { reason });
      showToast(data?.status === "Closed" ? `${r.id} cancelled` : `${r.id} is being cancelled in SAP`, "success");
      load(true);
    } catch (err) {
      showToast(err.response?.data?.message || "It could not be cancelled", "error");
    } finally {
      setBusy("");
    }
  };

  const retry = async (id) => {
    setBusy(id);
    try {
      await API.post(`/purchase-requests/${id}/retry`);
      showToast("Purchase request sent to SAP again", "success");
      load(true);
    } catch (err) {
      showToast(err.response?.data?.message || "That step was refused", "error");
    } finally {
      setBusy("");
    }
  };

  const retryOrder = async (id) => {
    setBusy(id);
    try {
      await API.post(`/purchase-requests/${id}/order/retry`);
      showToast("Purchase order sent to SAP again", "success");
      load(true);
    } catch (err) {
      showToast(err.response?.data?.message || "That step was refused", "error");
    } finally {
      setBusy("");
    }
  };

  // A line nobody will quote is dropped with a reason, or opened again.
  const lineStep = async (r, l, step) => {
    let body = {};
    if (step === "drop") {
      const reason = await prompt({
        title: `Drop ${l.name}?`,
        message: "Nobody will quote it, and the request can close without it. Say why.",
        placeholder: "Bought locally, no longer needed...",
        confirmLabel: "Drop line",
      });
      if (reason === null) return;
      if (!reason.trim()) {
        showToast("Say why the line is dropped", "error");
        return;
      }
      body = { reason: reason.trim() };
    }
    setBusy(r.id);
    try {
      await API.post(`/purchase-requests/${r.id}/lines/${encodeURIComponent(l.lineId)}/${step}`, body);
      showToast(step === "drop" ? `${l.name} dropped` : `${l.name} is open for a quotation again`, "success");
      load(true);
    } catch (err) {
      showToast(err.response?.data?.message || "That step was refused", "error");
    } finally {
      setBusy("");
    }
  };

  // Every SAP company, plus any company on the list that SAP no longer
  // publishes, by code, named as the card names them.
  const companies = useMemo(() => {
    const byCode = new Map(sapCompanies.map((c) => [c.abbr, c.company || c.abbr]));
    for (const r of rows) {
      if (r.company && !byCode.has(r.company)) byCode.set(r.company, r.companyName || r.company);
    }
    return [...byCode].sort((a, b) => a[1].localeCompare(b[1]));
  }, [sapCompanies, rows]);

  // Everybody who has raised a request on the list, for the Raised By filter.
  // Filtered by the account (email), shown by the person's name.
  const raisers = useMemo(() => {
    const byEmail = new Map();
    for (const r of rows) if (r.raisedBy) byEmail.set(r.raisedBy, r.raisedByName || r.raisedBy);
    return [...byEmail].sort((a, b) => a[1].localeCompare(b[1]));
  }, [rows]);

  const shown = useMemo(
    () =>
      rows.filter(
        (r) =>
          (!status || stageOf(r) === status) &&
          (!work || r.work === work) &&
          (!company || r.company === company) &&
          (!raisedBy || r.raisedBy === raisedBy)
      ),
    [rows, status, work, company, raisedBy]
  );

  // Ten to a page. A filter change starts again from the first (see `filterBy`),
  // and pageSlice keeps the page in range when a reload leaves fewer rows.
  const { page: current, rows: pageRows } = pageSlice(shown, page, PAGE_SIZE);
  const filterBy = (set) => (e) => {
    set(e.target.value);
    setPage(1);
  };

  const open = viewing ? rows.find((r) => r.id === viewing) : null;
  const actions = (r) => ({
    canRetry: canRaise,
    canBuy,
    busy: busy === r.id,
    onRetry: () => retry(r.id),
    onQuote: () => {
      setViewing("");
      setQuoting(r);
    },
    onRetryOrder: () => retryOrder(r.id),
    onLine: (l, step) => lineStep(r, l, step),
    // The buyers cancel any; whoever raised one cancels their own - mirrors the server's guard.
    canCancel: canBuy || (canRaise && r.raisedBy === user?.email),
    onCancel: () => cancelRequest(r),
  });

  return (
    <div className="space-y-5">
      <div className="panel">
        <div className="flex items-center gap-3">
          <span className="panel-icon">
            <ShoppingCart className="h-5 w-5" />
          </span>
          <div>
            <h2 className="panel-title">Purchase requests</h2>
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
            value={raisedBy}
            onChange={filterBy(setRaisedBy)}
            className="field field-sm w-auto cursor-pointer"
            aria-label="Filter by raised by"
          >
            <option value="">Raised by anyone</option>
            {raisers.map(([email, name]) => (
              <option key={email} value={email}>
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
          {canBuy && (
            <select
              value={work}
              onChange={filterBy(setWork)}
              className="field field-sm w-auto cursor-pointer"
              aria-label="Filter by purchase work"
              title="Pending until a PO is made for every line"
            >
              <option value="">All work</option>
              {WORK.map((w) => (
                <option key={w} value={w}>
                  Work {w.toLowerCase()}
                </option>
              ))}
            </select>
          )}
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
                ? "No purchase requests match these filters."
                : "No purchase requests have been raised yet."}
            </p>
          </div>
        </div>
      ) : (
        <>
          <RequestList rows={pageRows} actions={actions} showWork={canBuy} onView={(r) => setViewing(r.id)} />
          <Pagination
            page={current}
            total={shown.length}
            pageSize={PAGE_SIZE}
            onPage={setPage}
            noun="purchase request"
          />
        </>
      )}

      {open && (
        <div className="modal-backdrop" onClick={() => setViewing("")}>
          <RequestDetails request={open} onClose={() => setViewing("")} {...actions(open)} />
        </div>
      )}

      {raising && (
        <div className="modal-backdrop">
          <PurchaseRequestModal onClose={() => setRaising(false)} onSaved={() => load(true)} />
        </div>
      )}

      {quoting && (
        <div className="modal-backdrop">
          <PurchaseQuotationModal request={quoting} onClose={() => setQuoting(null)} onSaved={() => load(true)} />
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

const StatusBadge = ({ status }) => (
  <span className={`badge whitespace-nowrap ${STATUS_STYLE[status] || "badge-slate"}`}>
    {status === "Queued" ? "Queued for SAP" : status}
  </span>
);

/** The purchase manager's work on it: Pending until a PO is made for every line. */
const WorkBadge = ({ work }) =>
  work ? (
    <span className={`badge badge-soft whitespace-nowrap ${WORK_STYLE[work] || "badge-slate"}`} title="Purchase work: pending until a PO is made for every line">
      {work}
    </span>
  ) : null;

/** The first item, and how many more: all a row has room for. */
const itemsSummary = (lines = []) => {
  if (!lines.length) return "—";
  const first = `${lines[0].name} × ${lines[0].qty} ${lines[0].unit || ""}`.trim();
  return lines.length > 1 ? `${first}, +${lines.length - 1} more` : first;
};

/** Send again, or make the quotation - offered on the row and in the popup alike. */
const RowActions = ({ request: r, canRetry, canBuy, busy, onRetry, onQuote, onRetryOrder, canCancel, onCancel }) => {
  const o = r.order;
  return (
    <>
      <CancelButton cancel={r.cancel} allowed={canCancel} busy={busy} onCancel={onCancel} />
      {canRetry && r.status === "Failed" && (
        <button className="btn btn-sm btn-primary" disabled={busy} onClick={onRetry}>
          <Send className="h-4 w-4" />
          {busy ? "…" : "Send again"}
        </button>
      )}
      {/* A PO made on the request before 24 Oct 2026, refused by SAP. */}
      {canBuy && o?.status === "Failed" && (
        <button className="btn btn-sm btn-primary" disabled={busy} onClick={onRetryOrder}>
          <Send className="h-4 w-4" />
          {busy ? "…" : "Send PO again"}
        </button>
      )}
      {canBuy && r.mayQuote && (
        <button className="btn btn-sm btn-primary" disabled={busy} onClick={onQuote}>
          <FileText className="h-4 w-4" />
          Make quotation
        </button>
      )}
    </>
  );
};

/** The eye: the way into everything about a request. Outlined so it reads as a button. */
const ViewButton = ({ request: r, onView }) => (
  <button
    className="btn btn-sm btn-neutral btn-icon shrink-0 hover:border-brand-500 hover:text-brand-700"
    onClick={() => onView(r)}
    title="View full details"
    aria-label={`View purchase request for ${r.companyName || r.company}`}
  >
    <Eye className="h-4 w-4" aria-hidden="true" />
  </button>
);

/**
 * One short line per request: where it stands, for which company, and what.
 * Everything else - who raised it and when, the date needed, the SAP numbers,
 * every line, the PO and the actions (retry, create PO) - is behind the eye,
 * so the list reads down at a glance.
 */
const RequestList = ({ rows, onView, showWork = false }) => (
  <>
    {/* Phone: a short card per request. */}
    <div className="space-y-3 md:hidden">
      {rows.map((r) => (
        <div key={r.id} className="card flex items-center gap-4 p-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={stageOf(r)} />
              {showWork && <WorkBadge work={r.work} />}
              <span className="text-[13px] font-semibold text-slate-900">{r.companyName || r.company}</span>
            </div>
            <p className="mt-2 truncate text-[13px] text-slate-700">{itemsSummary(r.lines)}</p>
          </div>
          <ViewButton request={r} onView={onView} />
        </div>
      ))}
    </div>

    {/* Tablet and up: a table of three columns and the eye. */}
    <div className="table-card hidden md:block">
      <div className="table-scroll">
        <table className="tbl">
          <thead>
            <tr>
              <th className="w-[160px]">Status</th>
              {showWork && <th className="w-[110px]">Work</th>}
              <th className="w-[260px]">Company</th>
              <th>Items</th>
              <th className="w-[80px] text-right">View</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="cursor-pointer" onClick={() => onView(r)}>
                <td className="py-4">
                  <StatusBadge status={stageOf(r)} />
                </td>
                {showWork && (
                  <td className="py-4">
                    <WorkBadge work={r.work} />
                  </td>
                )}
                <td className="whitespace-nowrap py-4 font-medium text-slate-800">{r.companyName || r.company}</td>
                <td className="py-4">
                  <div className="max-w-[480px] truncate text-slate-700" title={itemsSummary(r.lines)}>
                    {itemsSummary(r.lines)}
                  </div>
                </td>
                {/* The row opens the details too; the eye is the visible way in. */}
                <td className="py-4" onClick={(e) => e.stopPropagation()}>
                  <div className="flex justify-end">
                    <ViewButton request={r} onView={onView} />
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

/** Everything about one request: the popup behind the eye. */
const RequestDetails = ({ request: r, onClose, ...actions }) => {
  const o = r.order;
  // Lines are quoted or dropped only on a request in SAP with no PO made on it the old way - and still once
  // it is Ordered through a quotation's PO, so a request quoted in parts is not stuck (the server's QUOTING).
  const linesOpen =
    actions.canBuy &&
    !o &&
    (r.status === "In SAP" || (r.status === "Ordered" && (r.lines || []).some((l) => l.coverage === "Quoted")));
  return (
    <div className="modal max-w-2xl" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
      <div className="modal-head">
        <div className="min-w-0">
          <h3 className="modal-title">
            <ShoppingCart className="h-[18px] w-[18px] text-brand-700 shrink-0" />
            Purchase request
            <StatusBadge status={stageOf(r)} />
          </h3>
          <p className="modal-sub">
            {r.companyName || r.company} · raised by {r.raisedByName || r.raisedBy || "—"} on {when(r.raisedAt)}
          </p>
        </div>
        <button onClick={onClose} className="modal-close" aria-label="Close">
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="modal-body space-y-6">
        <CancelNote cancel={r.cancel} error={r.error} />
        <div className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
          <KV label="Company" value={r.companyName || r.company} />
          <KV label="Required by" value={day(r.requiredBy)} />
          <KV label="SAP purchase request" value={r.sapDocNumber ? `PR ${r.sapDocNumber}` : ""} />
          <KV label="Purchase order" value={r.poNumbers ? `PO ${r.poNumbers}` : ""} />
          <KV label="Raised by" value={`${r.raisedByName || r.raisedBy || "—"} · ${when(r.raisedAt)}`} />
        </div>

        {r.reason && <p className="text-[13px] text-slate-600 italic">“{r.reason}”</p>}

        <div>
        <p className="mb-2 text-[12px] font-semibold text-slate-500">
          Items ({(r.lines || []).length})
        </p>
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
          {(r.lines || []).map((l, i) => (
            <li
              key={`${l.itemCode}-${i}`}
              className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1.5 px-4 py-3 text-[13px]"
            >
              <span className="min-w-0 text-slate-800">
                {l.name}
                {l.sapItemCode && <span className="mono ml-2 text-[11px] text-slate-500">{l.sapItemCode}</span>}
                {l.remarks && <span className="ml-2 text-[12px] text-slate-500">· {l.remarks}</span>}
              </span>
              <span className="whitespace-nowrap text-slate-700">
                × {l.qty} {l.unit}
                {/* What the PO made here takes of it, and at what price. */}
                {o &&
                  (l.orderQty > 0 ? (
                    <span className="ml-2 text-[12px] text-slate-500">
                      · PO {l.orderQty} @ {formatCurrency(l.price)}
                      {l.taxCode ? ` · ${l.taxCode}` : ""}
                    </span>
                  ) : (
                    <span className="ml-2 text-[12px] text-slate-400">· Not on the PO</span>
                  ))}
                {/* What the goods receipts have brought in so far. */}
                {l.received !== null && l.received !== undefined && (
                  <span className={`ml-2 text-[12px] ${l.received >= l.qty ? "text-emerald-700" : "text-slate-500"}`}>
                    · Received {l.received}
                  </span>
                )}
                {l.coverage === "Quoted" && <span className="ml-2 text-[12px] text-slate-500">· Quoted on {l.quotation}</span>}
                {l.coverage === "Dropped" && (
                  <span className="ml-2 text-[12px] text-slate-500">· Dropped{l.dropReason ? `: ${l.dropReason}` : ""}</span>
                )}
              </span>
              {linesOpen && !l.coverage && (
                <button
                  className="btn btn-sm btn-neutral"
                  disabled={actions.busy}
                  onClick={() => actions.onLine(l, "drop")}
                  title="Nobody will quote this line"
                >
                  <Ban className="h-3.5 w-3.5" />
                  Drop
                </button>
              )}
              {linesOpen && l.coverage === "Dropped" && (
                <button className="btn btn-sm btn-neutral" disabled={actions.busy} onClick={() => actions.onLine(l, "reopen")}>
                  <RotateCcw className="h-3.5 w-3.5" />
                  Reopen
                </button>
              )}
            </li>
          ))}
        </ul>
        </div>

        {o && <OrderState order={o} />}

        {r.quotations?.length > 0 && (
          <div>
            <p className="mb-1.5 text-[12px] font-medium text-slate-500">Quotations</p>
            <ul className="space-y-1.5">
              {r.quotations.map((q) => (
                <li key={q.id} className="flex flex-wrap items-center gap-2 text-[13px]">
                  <span className={`badge ${QUOTE_STYLE[q.status] || "badge-slate"}`}>
                    {q.status === "Posted" ? `SAP quotation ${q.sapDocNumber || "posted"}` : `Quotation ${q.status.toLowerCase()}`}
                  </span>
                  <span className="mono text-xs text-slate-500">{q.id}</span>
                  <span className="text-slate-800">{q.vendorName}</span>
                  {q.purchaseOrder && <span className="text-slate-600">→ {q.purchaseOrder}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}

        {stageOf(r) === "Ordered" && (
          <p className="flex items-center gap-1.5 text-xs text-emerald-700">
            <Truck className="h-3.5 w-3.5 shrink-0" />
            Receive it with Goods receipt when the goods arrive.
          </p>
        )}

        {r.receipts?.length > 0 && (
          <div>
            <p className="mb-1.5 text-[12px] font-medium text-slate-500">Goods receipts</p>
            <ul className="space-y-1 text-[13px] text-slate-700">
              {r.receipts.map((g) => (
                <li key={g.id} className="flex flex-wrap gap-x-2">
                  <span className="mono">{g.sapDocNumber ? `GRPO ${g.sapDocNumber}` : g.id}</span>
                  {g.poNumber && <span className="text-slate-500">· PO {g.poNumber}</span>}
                  {g.billNo && <span className="text-slate-500">· Bill {g.billNo}</span>}
                  <span className="text-slate-500">· {when(g.postedAt)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {stageOf(r) === "Completed" && (
          <p className="flex items-center gap-1.5 text-xs text-cyan-700">
            <Truck className="h-3.5 w-3.5 shrink-0" />
            Every item has been received. Nothing more can be done on this request.
          </p>
        )}

        {r.status === "Failed" && r.error && <p className="text-xs text-rose-700">SAP said: {r.error}</p>}

        {/* Ended by the sync: every PO raised from it was cancelled in SAP. */}
        {r.status === "Closed" && r.error && <p className="text-xs text-slate-600">{r.error}</p>}
      </div>

      <div className="modal-foot">
        <button type="button" onClick={onClose} className="btn btn-neutral">
          Close
        </button>
        <RowActions request={r} {...actions} />
      </div>
    </div>
  );
};

/** The PO made in the app: waiting for the sync, posted, or refused by SAP. */
const OrderState = ({ order: o }) => (
  <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
    <div className="flex flex-wrap items-center gap-2">
      <span className={`badge ${ORDER_STYLE[o.status] || "badge-slate"}`}>
        {o.status === "Queued"
          ? "PO waiting for the SAP sync"
          : o.status === "Posted"
            ? `SAP PO ${o.sapDocNumber || "posted"}`
            : o.status === "Cancelled"
              ? `SAP PO ${o.sapDocNumber} cancelled in SAP`
              : "PO refused by SAP"}
      </span>
      <span className="text-[13px] text-slate-800">
        {o.vendorName || o.vendorCode}
        {o.vendorCode && o.vendorName && (
          <span className="mono ml-1.5 text-[11px] text-slate-500">{o.vendorCode}</span>
        )}
      </span>
      <span className="ml-auto text-[13px] font-semibold tabular-nums text-slate-900">
        {formatCurrency(o.value)}
      </span>
    </div>
    <p className="mt-1 text-[12px] text-slate-500">
      PO date: {day(o.date) || "—"} · Delivery: {day(o.dueDate) || "—"} · Made by {o.raisedByName || o.raisedBy || "—"},{" "}
      {when(o.raisedAt)}
    </p>
    {o.remarks && <p className="mt-1 text-[12px] text-slate-600 italic">“{o.remarks}”</p>}
    {o.status === "Failed" && o.error && (
      <p className="mt-1 text-xs text-rose-700">SAP said: {o.error}</p>
    )}
  </div>
);

export default PurchaseRequests;
