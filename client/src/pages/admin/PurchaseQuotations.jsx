import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  Eye,
  FileCheck,
  FileText,
  Loader2,
  Pencil,
  Plus,
  Printer,
  RefreshCw,
  Send,
  Trash2,
  X,
} from "lucide-react";

import API from "../../services/api";
import { useAuth, MANAGER, PURCHASE_MANAGER } from "../../context/AuthContext";
import { useNotifications } from "../../context/NotificationContext";
import { useDialog } from "../../context/DialogContext";
import CancelNote, { CancelButton } from "../../components/CancelNote";
import { askCancelReason } from "../../utils/cancel";
import useAutoRefresh from "../../hooks/useAutoRefresh";
import { useSapSyncDone } from "../../hooks/useSapSync";
import PurchaseQuotationModal from "./PurchaseQuotationModal";
import PurchaseOrderModal from "./PurchaseOrderModal";
import { formatCurrency } from "../../utils/currency";
import Pagination from "../../components/Pagination";
import { pageSlice } from "../../utils/pageSlice";

const PAGE_SIZE = 10;

/**
 * The chosen vendor's quotation for each purchase request (24 Oct 2026).
 *
 * The purchase manager enters it, prints it, and management signs the
 * printout - that signature is the approval. The SAP sync posts it; once SAP
 * has it, the PO is made from it here, one PO per quotation. A quotation SAP
 * does not have yet can be changed or deleted; one it has is cancelled in SAP
 * and entered again.
 *
 * Listed at a glance, as purchase requests are (27 Oct 2026): status, vendor, items and value, with everything
 * else - the lines, dates, notes and actions - behind the eye.
 */

const STATUS_STYLE = {
  Queued: "badge-amber",
  Posted: "badge-emerald",
  Failed: "badge-rose",
  Cancelled: "badge-slate",
};

const STATUSES = ["Queued", "Posted", "Failed", "Cancelled"];

const when = (value) => {
  if (!value) return "—";
  const d = new Date(String(value).replace(" ", "T"));
  return Number.isNaN(d.getTime())
    ? String(value)
    : d.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
};

/** A quotation's dates are calendar dates; no time, and no timezone shift. */
const day = (value) => {
  if (!value) return "";
  const d = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString("en-IN", { dateStyle: "medium" });
};

const statusLabel = (q) =>
  q.status === "Queued"
    ? "Waiting for the SAP sync"
    : q.status === "Posted"
      ? `SAP quotation ${q.sapDocNumber || "posted"}`
      : q.status === "Cancelled"
        ? "Cancelled in SAP"
        : "Refused by SAP";

const PurchaseQuotations = () => {
  const { user } = useAuth();
  const { showToast } = useNotifications();
  const { prompt } = useDialog();
  // Mirrors the server's guard: the purchase manager, and the Admin as the usual fallback.
  const canBuy = user?.role === PURCHASE_MANAGER || user?.role === MANAGER;

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [company, setCompany] = useState("");
  const [vendorCode, setVendorCode] = useState("");
  const [busy, setBusy] = useState("");
  const [entering, setEntering] = useState(false);
  const [changing, setChanging] = useState(null);
  const [ordering, setOrdering] = useState(null);
  const [printing, setPrinting] = useState(null);
  // The quotation whose details are open, by id, so a background reload shows the fresh copy.
  const [viewing, setViewing] = useState("");
  const [page, setPage] = useState(1);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const { data } = await API.get("/purchase-quotations", { params: { limit: 150 } });
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

  const dialogOpen = entering || changing || ordering;
  const anyQueued = rows.some((r) => r.status === "Queued" || r.cancel?.status === "Queued");
  useAutoRefresh(() => load(true), { enabled: anyQueued && !dialogOpen });
  useSapSyncDone(() => !dialogOpen && load(true));

  // The sheet is in the page before the print dialog opens, and gone after.
  useEffect(() => {
    if (!printing) return undefined;
    const done = () => setPrinting(null);
    window.addEventListener("afterprint", done);
    const t = setTimeout(() => window.print(), 50);
    return () => {
      clearTimeout(t);
      window.removeEventListener("afterprint", done);
    };
  }, [printing]);

  const act = async (id, run, success) => {
    setBusy(id);
    try {
      await run();
      showToast(success, "success");
      load(true);
    } catch (err) {
      showToast(err.response?.data?.message || "That step was refused", "error");
    } finally {
      setBusy("");
    }
  };

  const retry = (q) => act(q.id, () => API.post(`/purchase-quotations/${q.id}/retry`), `${q.id} sent to SAP again`);

  // One SAP has, with no PO made from it: cancelled in SAP by the sync, and its request lines open again (27 Oct 2026).
  const cancel = async (q) => {
    const reason = await askCancelReason(prompt, showToast, `quotation ${q.id}`);
    if (reason === null) return;
    act(q.id, () => API.post(`/purchase-quotations/${q.id}/cancel`, { reason }), `${q.id} is being cancelled in SAP`);
  };

  const remove = (q) => {
    if (!window.confirm(`Delete quotation ${q.id}? Its request lines become open for a quotation again.`)) return;
    act(q.id, () => API.delete(`/purchase-quotations/${q.id}`), `${q.id} deleted`);
  };

  // The request's reason heads the items, and the tax codes' rates give each
  // line its GST; the quotation itself carries neither. Either missing still prints.
  const print = async (q) => {
    setBusy(q.id);
    const [request, options] = await Promise.all([
      API.get(`/purchase-requests/${q.request}`).then(({ data }) => data).catch(() => null),
      API.get("/purchase-quotations/options", { params: { company: q.company } }).then(({ data }) => data).catch(() => null),
    ]);
    setPrinting({ quotation: q, request, taxCodes: options?.taxCodes || [], companyInfo: options?.companyInfo || null });
    setBusy("");
  };

  // The companies and the vendors on the list, for the filters: by code, shown by name. Not who entered
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
            <FileText className="h-5 w-5" />
          </span>
          <div>
            <h2 className="panel-title">Purchase quotations</h2>
            <p className="panel-sub">
              The chosen vendor's quotation for a purchase request. Print it for signature; once SAP has it,
              make the PO from it.
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
          {canBuy && (
            <button className="btn btn-sm btn-primary" onClick={() => setEntering(true)}>
              <Plus className="h-4 w-4" />
              New quotation
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
            <FileText className="h-8 w-8 text-slate-300 mb-2" />
            <p className="empty-title">Nothing here</p>
            <p className="empty-sub">
              {rows.length ? "No quotations match these filters." : "No quotations have been entered yet."}
            </p>
          </div>
        </div>
      ) : (
        <>
          <QuotationList rows={pageRows} onView={(q) => setViewing(q.id)} />
          <Pagination page={current} total={shown.length} pageSize={PAGE_SIZE} onPage={setPage} noun="quotation" />
        </>
      )}

      {open && (
        <div className="modal-backdrop" onClick={() => setViewing("")}>
          <QuotationDetails
            quotation={open}
            onClose={() => setViewing("")}
            canBuy={canBuy}
            busy={busy === open.id}
            onPrint={() => print(open)}
            // The form opens in place of the details, not over them.
            onChange={() => {
              setViewing("");
              setChanging(open);
            }}
            onDelete={() => remove(open)}
            onCancel={() => cancel(open)}
            onRetry={() => retry(open)}
            onOrder={() => {
              setViewing("");
              setOrdering(open);
            }}
          />
        </div>
      )}

      {(entering || changing) && (
        <div className="modal-backdrop">
          <PurchaseQuotationModal
            quotation={changing}
            onClose={() => {
              setEntering(false);
              setChanging(null);
            }}
            onSaved={() => load(true)}
          />
        </div>
      )}

      {ordering && (
        <div className="modal-backdrop">
          <PurchaseOrderModal quotation={ordering} onClose={() => setOrdering(null)} onSaved={() => load(true)} />
        </div>
      )}

      {printing && (
        <QuotationSheet
          quotation={printing.quotation}
          request={printing.request}
          taxCodes={printing.taxCodes}
          companyInfo={printing.companyInfo}
        />
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

const StatusBadge = ({ quotation: q }) => (
  <span className={`badge whitespace-nowrap ${STATUS_STYLE[q.status] || "badge-slate"}`}>{statusLabel(q)}</span>
);

/** The first item, and how many more: all a row has room for. */
const itemsSummary = (lines = []) => {
  if (!lines.length) return "—";
  const first = `${lines[0].name} × ${lines[0].qty} ${lines[0].vendorUnit || ""}`.trim();
  return lines.length > 1 ? `${first}, +${lines.length - 1} more` : first;
};

/** The eye: the way into everything about a quotation, as on purchase requests. */
const ViewButton = ({ quotation: q, onView }) => (
  <button
    className="btn btn-sm btn-neutral btn-icon shrink-0 hover:border-brand-500 hover:text-brand-700"
    onClick={() => onView(q)}
    title="View full details"
    aria-label={`View quotation ${q.id}`}
  >
    <Eye className="h-4 w-4" aria-hidden="true" />
  </button>
);

/**
 * One short line per quotation (27 Oct 2026, as purchase requests have it): where it stands, the vendor, what
 * and how much. The lines, dates, notes and every action are behind the eye, so the list reads at a glance.
 */
const QuotationList = ({ rows, onView }) => (
  <>
    {/* Phone: a short card per quotation. */}
    <div className="space-y-3 md:hidden">
      {rows.map((q) => (
        <div key={q.id} className="card flex items-center gap-4 p-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge quotation={q} />
              <span className="text-[13px] font-semibold text-slate-900">{q.vendorName || q.vendorCode}</span>
            </div>
            <p className="mt-2 truncate text-[13px] text-slate-700">{itemsSummary(q.lines)}</p>
            <p className="mt-0.5 text-[12px] text-slate-500">
              {q.id} · {formatCurrency(q.total)}
            </p>
          </div>
          <ViewButton quotation={q} onView={onView} />
        </div>
      ))}
    </div>

    {/* Tablet and up: a table and the eye. */}
    <div className="table-card hidden md:block">
      <div className="table-scroll">
        <table className="tbl">
          <thead>
            <tr>
              <th className="w-[200px]">Status</th>
              <th className="w-[240px]">Vendor</th>
              <th>Items</th>
              <th className="w-[130px] text-right">Value</th>
              <th className="w-[80px] text-right">View</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((q) => (
              <tr key={q.id} className="cursor-pointer" onClick={() => onView(q)}>
                <td className="py-4">
                  <StatusBadge quotation={q} />
                </td>
                <td className="py-4">
                  <div className="max-w-[240px] truncate font-medium text-slate-800">{q.vendorName || q.vendorCode}</div>
                  <div className="text-[12px] text-slate-500">{q.companyName || q.company}</div>
                </td>
                <td className="py-4">
                  <div className="max-w-[420px] truncate text-slate-700" title={itemsSummary(q.lines)}>
                    {itemsSummary(q.lines)}
                  </div>
                </td>
                <td className="whitespace-nowrap py-4 text-right tabular-nums text-slate-800">{formatCurrency(q.total)}</td>
                {/* The row opens the details too; the eye is the visible way in. */}
                <td className="py-4" onClick={(e) => e.stopPropagation()}>
                  <div className="flex justify-end">
                    <ViewButton quotation={q} onView={onView} />
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

/** Everything about one quotation: the popup behind the eye. */
const QuotationDetails = ({ quotation: q, onClose, canBuy, busy, onPrint, onChange, onDelete, onCancel, onRetry, onOrder }) => (
  <div className="modal max-w-2xl" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
    <div className="modal-head">
      <div className="min-w-0">
        <h3 className="modal-title">
          <FileText className="h-[18px] w-[18px] text-brand-700 shrink-0" />
          Quotation {q.id}
          <StatusBadge quotation={q} />
        </h3>
        <p className="modal-sub">
          {q.vendorName || q.vendorCode} · {q.companyName || q.company}
        </p>
      </div>
      <button onClick={onClose} className="modal-close" aria-label="Close">
        <X className="h-5 w-5" />
      </button>
    </div>

    <div className="modal-body space-y-6">
      <CancelNote cancel={q.cancel} error={q.error} />
      <div className="flex flex-wrap items-center gap-2">
        {q.purchaseOrder && <span className="badge badge-emerald">{q.purchaseOrder} made</span>}
        {q.expired && !q.purchaseOrder && q.status !== "Cancelled" && (
          <span className="badge badge-amber">Expired {day(q.validUntil)}</span>
        )}
        <span className="ml-auto text-[15px] font-bold tabular-nums text-slate-900">{formatCurrency(q.total)}</span>
      </div>

      <div className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
        <KV label="Vendor" value={q.vendorName ? `${q.vendorName} · ${q.vendorCode}` : q.vendorCode} />
        <KV label="Purchase request" value={q.request} />
        <KV label="Company" value={q.companyName || q.company} />
        <KV label="Dated · valid until" value={`${day(q.date) || "—"} · ${day(q.validUntil) || "—"}`} />
        <KV label="Entered by" value={`${q.raisedByName || q.raisedBy || "—"} · ${when(q.raisedAt)}`} />
        <KV label="SAP quotation" value={q.sapDocNumber} />
      </div>

      <div>
        <p className="mb-2 text-[12px] font-semibold text-slate-500">Items ({q.lines.length})</p>
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
          {q.lines.map((l) => (
            <li
              key={l.lineId}
              className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-4 py-3 text-[13px]"
            >
              <span className="min-w-0 text-slate-800">
                {l.name} <span className="mono text-[11px] text-slate-500">{l.sapItemCode || l.itemCode}</span>
                <span className="ml-2 text-[12px] text-slate-500">
                  · requested {l.requestQty} {l.inventoryUnit}
                </span>
              </span>
              <span className="whitespace-nowrap text-slate-700">
                {l.qty} {l.vendorUnit} @ {formatCurrency(l.price)} / {l.vendorUnit}
                {/* Only a quotation entered before 27 Oct 2026 has one: the tax code comes off the bill now. */}
                {l.taxCode && <span className="ml-2 text-[12px] text-slate-500">· {l.taxCode}</span>}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {q.remarks && <p className="text-[13px] text-slate-600 italic">“{q.remarks}”</p>}
      {q.status === "Failed" && q.error && <p className="text-[13px] text-rose-700">SAP said: {q.error}</p>}
      {/* The sync holds a quotation it will not send yet (an item on a UoM group) and says why here; it stays
          Queued and goes on the run after the reason is put right. */}
      {q.status === "Queued" && q.error && <p className="text-[13px] text-amber-700">Held, not sent to SAP: {q.error}</p>}
      {q.status === "Cancelled" && q.error && <p className="text-[13px] text-slate-600">{q.error}</p>}
    </div>

    <div className="modal-foot">
      <div className="flex flex-wrap justify-end gap-2">
        <button className="btn btn-sm btn-neutral" disabled={busy} onClick={onPrint}>
          <Printer className="h-4 w-4" />
          Print
        </button>
        {canBuy && q.mayMakeOrder && (
          <button className="btn btn-sm btn-primary" disabled={busy} onClick={onOrder}>
            <FileCheck className="h-4 w-4" />
            Make PO
          </button>
        )}
        {canBuy && q.status === "Failed" && (
          <button className="btn btn-sm btn-primary" disabled={busy} onClick={onRetry}>
            <Send className="h-4 w-4" />
            {busy ? "…" : "Send again"}
          </button>
        )}
        {canBuy && q.mayEdit && (
          <>
            <button className="btn btn-sm btn-neutral" disabled={busy} onClick={onChange}>
              <Pencil className="h-4 w-4" />
              Change
            </button>
            <button className="btn btn-sm btn-neutral" disabled={busy} onClick={onDelete}>
              <Trash2 className="h-4 w-4" />
              Delete
            </button>
          </>
        )}
        {/* One SAP has: cancelled there instead of deleted. */}
        <CancelButton cancel={q.cancel} allowed={canBuy} busy={busy} onCancel={onCancel} />
      </div>
    </div>
  </div>
);

/**
 * The printout management signs: the group's Purchase Approval Form, laid out
 * as its Excel original (PURCHASE APPROVAL FORMAT.xlsx, 24 Oct 2026) - columns
 * B to J at Excel's widths, each row at the sheet's height in points, and the
 * sheet's medium and thin rules. Rendered beside #root, as every print sheet
 * here is, because index.css hides the application when printing.
 *
 * What the form has no place for is added in its own empty rows, not over it:
 * the quotation's CMMS number (and SAP's, once posted), which is what ties the
 * signed paper to the record (decided 24 Oct 2026); and the purchase request's
 * remarks, so management can see why each item is wanted before signing (24 Oct
 * 2026) - each line's under its item, and the request's reason in full in a
 * row of its own under the totals, rather than as the uppercase heading of row
 * 20, which clipped a long one. The quantity carries the
 * vendor's unit, as the rate is per that unit; the form's header still says
 * "Rate/pc". Prices are before tax, so GST is worked out per line from its tax
 * code rather than printed "INCLUSIVE".
 */

// Excel's default column (8.43 characters, 64 px) for B to I, and J at 15.14 (111 px).
const COLS = [48, 48, 48, 48, 48, 48, 48, 48, 83.25]; // pt
const MEDIUM = "1.5pt solid #000";
const THIN = "0.75pt solid #000";
const CALIBRI = "Calibri, Carlito, 'Segoe UI', Arial, sans-serif";

/** "LRTB", each M (medium), t (thin) or . (none), as the sheet draws that cell. */
const rule = (code = "....") => {
  const side = (c) => (c === "M" ? MEDIUM : c === "t" ? THIN : "none");
  return { borderLeft: side(code[0]), borderRight: side(code[1]), borderTop: side(code[2]), borderBottom: side(code[3]) };
};

/** One cell. Text spills into the empty cells to its right, as Excel's does. */
const Cell = ({ code, children = null, span = 1, style = {} }) => (
  <td
    colSpan={span}
    style={{ ...rule(code), padding: "0 2pt", whiteSpace: "pre", overflow: "visible", verticalAlign: "bottom", ...style }}
  >
    {children}
  </td>
);

/** A row of the frame with nothing in it: the left and right medium rules only. */
const Blank = ({ h = 15, last = false }) => (
  <tr style={{ height: `${h}pt` }}>
    <Cell code={last ? "M..M" : "M..."} />
    {[...Array(7)].map((_, i) => (
      <Cell key={i} code={last ? "...M" : "...."} />
    ))}
    <Cell code={last ? ".M.M" : ".M.."} />
  </tr>
);

/** A label in B and its value from D, as Date, Company and Supplier are laid out. */
const Field = ({ h, label, value, valueStyle = {} }) => (
  <tr style={{ height: `${h}pt` }}>
    <Cell code="M..." span={2} style={{ fontSize: "12pt" }}>
      {label}
    </Cell>
    <Cell code=".M.." span={7} style={{ fontSize: "14pt", ...valueStyle }}>
      {value}
    </Cell>
  </tr>
);

const n2 = (v) => (Number.isFinite(v) ? v.toFixed(2) : "");
const dmy = (value) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ""));
  return m ? `${m[3]}.${m[2]}.${m[1]}` : "";
};
/** The GST rate of a SAP tax code - from the published list, else the number in its name (IGST@18). */
const rateOf = (code, taxCodes) => {
  const hit = (taxCodes || []).find((t) => t.code === code);
  if (hit && hit.rate !== undefined && hit.rate !== null) return Number(hit.rate);
  const m = /@\s*(\d+(?:\.\d+)?)/.exec(String(code || ""));
  return m ? Number(m[1]) : null;
};

/**
 * The letterhead, B4:J7: the company as SAP holds it (Administration > Company
 * Details, published by the sync) - its name, each address line, and the phones
 * and email when SAP has them. A line SAP has no value for is left out rather
 * than filled with another company's, and the frame closes under the last one.
 */
const letterhead = (info, fallbackName) => {
  const contact = [
    info?.phone?.length ? `Ph. ${info.phone.join(" / ")}` : "",
    info?.email ? `Email: ${info.email}` : "",
  ].filter(Boolean);
  return {
    name: info?.name || fallbackName,
    lines: [
      ...(info?.address || []).map((text) => ({ text, size: "12pt" })),
      ...(contact.length ? [{ text: contact.join(" |"), size: "11pt" }] : []),
    ],
  };
};

const QuotationSheet = ({ quotation: q, request, taxCodes, companyInfo }) => {
  const head = letterhead(companyInfo, q.companyName || q.company);
  const lines = q.lines.map((l) => {
    const total = l.qty * l.price;
    const rate = rateOf(l.taxCode, taxCodes);
    const gst = rate === null ? null : (total * rate) / 100;
    return { ...l, total, rate, gst, net: total + (gst || 0) };
  });
  const rates = [...new Set(lines.map((l) => l.rate))];
  const oneRate = rates.length === 1 && rates[0] !== null ? rates[0] : null;
  // The sheet has four item rows; a longer quotation gets more, never fewer.
  const filler = Math.max(0, 4 - lines.length);
  const totalH = lines.reduce((s, l) => s + l.total, 0);
  const totalJ = lines.reduce((s, l) => s + l.net, 0);
  const reason = (request?.reason || "").trim();
  const lineRemarks = new Map((request?.lines || []).map((l) => [l.lineId, (l.remarks || "").trim()]));

  return createPortal(
    <div className="print-sheet hidden print:block" style={{ color: "#000", fontFamily: CALIBRI, fontSize: "11pt" }}>
      <style>{"@page { size: A4 portrait; margin: 0.75in 0.7in; }"}</style>
      <table style={{ borderCollapse: "collapse", tableLayout: "fixed", width: `${COLS.reduce((a, b) => a + b, 0)}pt` }}>
        <colgroup>
          {COLS.map((w, i) => (
            <col key={i} style={{ width: `${w}pt` }} />
          ))}
        </colgroup>
        <tbody>
          <tr style={{ height: "15.75pt" }}>
            <td colSpan={9} />
          </tr>

          {/* The letterhead, B4:J7, from SAP's company details. */}
          <tr style={{ height: "24pt" }}>
            <Cell
              code={head.lines.length ? "MMM." : "MMMM"}
              span={9}
              style={{ textAlign: "center", fontFamily: "'Franklin Gothic Demi', 'Franklin Gothic Medium', 'Arial Narrow', Arial, sans-serif", fontSize: "18pt", fontWeight: 700, color: "#31849B" }}
            >
              {head.name}
            </Cell>
          </tr>
          {head.lines.map((l, i) => (
            <tr key={i} style={{ height: "15.75pt" }}>
              <Cell code={i === head.lines.length - 1 ? "MM.M" : "MM.."} span={9} style={{ fontSize: l.size, fontWeight: 700 }}>
                {`  ${l.text}`}
              </Cell>
            </tr>
          ))}
          <Blank h={15.75} />

          {/* The title, B9:J9, and the ruled strip under it. */}
          <tr style={{ height: "24pt" }}>
            <Cell code="MMMM" span={9} style={{ textAlign: "center", fontSize: "18pt", fontWeight: 700 }}>
              PURCHASE APPROVAL FORM
            </Cell>
          </tr>
          <tr style={{ height: "15.75pt" }}>
            <Cell code="MMMM" span={9} />
          </tr>
          <Blank />

          <Field h={15.75} label="Date" value={`: ${dmy(q.date)}`} valueStyle={{ fontSize: "12pt" }} />
          {/* Row 13 is empty on the sheet: the quotation's numbers, so the signed paper finds its record. */}
          <Field
            h={15.75}
            label="Quotation No."
            value={`: ${q.id}${q.sapDocNumber ? `  (SAP ${q.sapDocNumber})` : ""}`}
            valueStyle={{ fontSize: "12pt" }}
          />
          <Field h={18.75} label="Company" value={`: ${companyInfo?.name || q.companyName || q.company}`} />
          <tr style={{ height: "18.75pt" }}>
            <Cell code="M..." span={2} style={{ fontSize: "12pt" }}>
              Supplier
            </Cell>
            <Cell code=".M.." span={7} style={{ fontSize: "14pt", fontWeight: 700, whiteSpace: "pre-wrap", verticalAlign: "top" }}>
              {`: ${q.vendorName || q.vendorCode}`}
            </Cell>
          </tr>
          <Blank h={18.75} />
          <tr style={{ height: "19.5pt" }}>
            <Cell code="MM.." span={9} style={{ fontSize: "14pt" }}>
              Please approve the following items for purchase; Prior Approval.
            </Cell>
          </tr>

          {/* The header, rows 18 and 19. */}
          <tr style={{ height: "16.5pt", fontSize: "12pt", textAlign: "center" }}>
            <Cell code="MtM.">Sl#</Cell>
            <Cell code="t.M." span={3}>
              Item Description
            </Cell>
            <Cell code="MMM.">Rate/</Cell>
            <Cell code="MtM.">Qty</Cell>
            <Cell code="t.M.">Total</Cell>
            <Cell code="ttM." style={{ fontSize: "11pt", textDecoration: "underline" }}>
              GST@
            </Cell>
            <Cell code="tMM.">Net</Cell>
          </tr>
          <tr style={{ height: "16.5pt", fontSize: "12pt", textAlign: "center" }}>
            <Cell code="Mt.M" />
            <Cell code="t..M" span={3} />
            <Cell code="MM.M">pc</Cell>
            <Cell code="Mt.M" style={{ textAlign: "left" }}>
              ordered
            </Cell>
            <Cell code="t..M" />
            <Cell code="tt.M">{oneRate === null ? "" : `${oneRate}%`}</Cell>
            <Cell code="tM.M">Total</Cell>
          </tr>

          {/* Row 20: the heading over the description, left empty - the reason is printed in full under the totals. */}
          <tr style={{ height: "15.75pt", fontSize: "12pt" }}>
            <Cell code="Mt.t" />
            <Cell code="tMMt" span={3} />
            <Cell code="MMMt" />
            <Cell code="MMMt" />
            <Cell code="MtMt" />
            <Cell code="tttt" />
            <Cell code="tMtt" />
          </tr>

          {lines.map((l, i) => (
            <tr key={l.lineId} style={{ height: "15.75pt", fontSize: "12pt" }}>
              <Cell code="Mttt" style={{ textAlign: "center" }}>
                {i + 1}
              </Cell>
              <Cell code="tttt" span={3} style={{ fontSize: "11pt", fontWeight: 700, whiteSpace: "pre-wrap" }}>
                {l.name}
                {lineRemarks.get(l.prLine) && (
                  <div style={{ fontSize: "9.5pt", fontWeight: 400, fontStyle: "italic" }}>{lineRemarks.get(l.prLine)}</div>
                )}
              </Cell>
              <Cell code="tttt" style={{ textAlign: "right" }}>
                {n2(l.price)}
              </Cell>
              <Cell code="tttt" style={{ textAlign: "center" }}>
                {`${l.qty} ${l.vendorUnit}`}
              </Cell>
              <Cell code="tttt" style={{ textAlign: "right" }}>
                {n2(l.total)}
              </Cell>
              <Cell code="tttt" style={{ textAlign: "right" }}>
                {l.gst === null ? l.taxCode : n2(l.gst)}
              </Cell>
              <Cell code="tMtt" style={{ textAlign: "right" }}>
                {n2(l.net)}
              </Cell>
            </tr>
          ))}
          {[...Array(filler)].map((_, i) => (
            <tr key={`f${i}`} style={{ height: "15.75pt" }}>
              <Cell code="Mttt" />
              <Cell code="tttt" span={3} />
              <Cell code="tttt" />
              <Cell code="tttt" />
              <Cell code="tttt" />
              <Cell code="tttt" />
              <Cell code="tMtt" />
            </tr>
          ))}

          {/* Row 25: the totals. */}
          <tr style={{ height: "19.5pt", fontSize: "12pt" }}>
            <Cell code="M..M" />
            <Cell code="Mt.M" span={3}>
              Total
            </Cell>
            <Cell code="MM.M" />
            <Cell code="Mt.M" />
            <Cell code="t..M" style={{ textAlign: "right" }}>
              {n2(totalH)}
            </Cell>
            <Cell code="tt.M" />
            <Cell code="tM.M" style={{ fontSize: "14pt", fontWeight: 700, textAlign: "right" }}>
              {n2(totalJ)}
            </Cell>
          </tr>
          <Blank h={15.75} />
          {/* The request's reason, in full and wrapped, with the request it came from. */}
          <tr style={{ height: "15.75pt", fontSize: "12pt" }}>
            <Cell code="M..." span={2} style={{ verticalAlign: "top" }}>
              Reason
            </Cell>
            <Cell code=".M.." span={7} style={{ whiteSpace: "pre-wrap", verticalAlign: "top" }}>
              {`: ${reason || "—"}`}
              <div style={{ fontSize: "9.5pt", fontStyle: "italic" }}>
                {`  ${q.request}${request?.raisedByName || request?.raisedBy ? `, raised by ${request.raisedByName || request.raisedBy}` : ""}`}
              </div>
            </Cell>
          </tr>
          <Blank />
          <Blank />

          {/* Rows 29 and 30: the three signatures, each under a thin rule two columns wide. */}
          <tr style={{ height: "15pt" }}>
            <Cell code="M.t.">Prepared By:</Cell>
            <Cell code="..t." />
            <Cell code="...." />
            <Cell code="..t.">Recommended By:</Cell>
            <Cell code="..t." />
            <Cell code="...." />
            <Cell code="..t.">Approved  By:</Cell>
            <Cell code="..t." />
            <Cell code=".M.." />
          </tr>
          <tr style={{ height: "15pt" }}>
            <Cell code="M...">PURCHASE DEPT.</Cell>
            <Cell code="...." />
            <Cell code="...." />
            <Cell code="....">GENERAL MANAGER</Cell>
            <Cell code="...." />
            <Cell code="...." />
            <Cell code="....">MANAGING DIRECTOR.</Cell>
            <Cell code="...." />
            <Cell code=".M.." />
          </tr>
          <Blank />
          <Blank />
          <Blank />

          {/* Row 34: the accounts manager's check. */}
          <tr style={{ height: "15.75pt" }}>
            <Cell code="M..." />
            <Cell code="...." />
            <Cell code="...." style={{ fontSize: "12pt" }}>
              Verified By:
            </Cell>
            <Cell code="...." />
            <Cell code="..t.">ACCOUNTS MANAGER.</Cell>
            <Cell code="..t." />
            <Cell code="..t." />
            <Cell code="...." />
            <Cell code=".M.." />
          </tr>
          <Blank h={15.75} last />
        </tbody>
      </table>
    </div>,
    document.body
  );
};

export default PurchaseQuotations;
