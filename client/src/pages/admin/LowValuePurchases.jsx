import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  Archive,
  CalendarDays,
  ChevronDown,
  CircleCheck,
  CircleDashed,
  CircleX,
  ClipboardList,
  Clock,
  Copy,
  EllipsisVertical,
  Eye,
  FileSpreadsheet,
  FileText,
  Flame,
  Hourglass,
  Image as ImageIcon,
  Loader2,
  Paperclip,
  Plus,
  Printer,
  RefreshCw,
  Search,
  ShoppingCart,
  Trash2,
  Upload,
  Wrench,
  X,
} from "lucide-react";

import API from "../../services/api";
import { useAuth } from "../../context/AuthContext";
import { useDialog } from "../../context/DialogContext";
import { useNotifications } from "../../context/NotificationContext";
import { useErpRefresh } from "../../hooks/useErpRefresh";
import Pagination from "../../components/Pagination";
import { pageSlice } from "../../utils/pageSlice";

/**
 * Miscellaneous Purchases - the purchasing team's request sheet.
 *
 * Redesign (23 Oct 2026): the sheet was laid out as the Google Sheet it
 * replaced, fourteen columns edited cell by cell. It is now a request list -
 * a filter bar, a card per request showing what people scan by, and a panel
 * per request (View) holding all fourteen fields,
 * still edited where they sit and saved one field at a time.
 *
 * Which fields a person may change is the server's answer (`editable` on each
 * row), never worked out here from the role.
 */

/** The server refuses anything larger. */
const MAX_BYTES = 15 * 1024 * 1024;

/** The printed sheet still greens a row once the thing has arrived. */
const DONE_GREEN = "#B7E1CD";

/** Every field of a request, in the sheet's order and with its headings. */
const COLUMNS = [
  { key: "date", header: "Date", kind: "date", width: 104 },
  { key: "type", header: "Type of Request", kind: "pick", from: "types", width: 140 },
  { key: "company", header: "Company", kind: "pick", from: "companies", width: 180 },
  { key: "raisedByName", header: "Raised By", kind: "text", width: 130 },
  { key: "description", header: "Description", kind: "text", width: 340 },
  { key: "purpose", header: "Purpose of Purchase/Repair", kind: "text", width: 250 },
  { key: "files", header: "Image samples (If any)", kind: "images", width: 100 },
  {
    key: "links",
    header: "Links/Brands of Product or contact details of vendor for faster process",
    kind: "text",
    width: 240,
  },
  { key: "priority", header: "Priority", kind: "pick", from: "priorities", width: 116 },
  { key: "approvalStatus", header: "Status of Approval", kind: "pick", from: "approvalStatuses", width: 190 },
  { key: "purchaseStatus", header: "Status of Purchase/Repair", kind: "pick", from: "purchaseStatuses", width: 180 },
  { key: "expectedOn", header: "Expected Date of Arrival", kind: "date", width: 116 },
  { key: "receivedOn", header: "Received date", kind: "date", width: 116 },
  { key: "remarks", header: "Remarks", kind: "text", width: 260 },
];

/** For the printed sheet, which keeps the original column proportions. */
const SHEET_WIDTH = COLUMNS.reduce((sum, c) => sum + c.width, 0);

const COL = Object.fromEntries(COLUMNS.map((c) => [c.key, c]));

/** Chip colours for the dropdown fields, as the sheet's dropdowns had them. */
const CHIP = {
  // Status of Approval
  Approved: "bg-emerald-100 text-emerald-800",
  Rejected: "bg-rose-100 text-rose-800",
  Pending: "bg-amber-100 text-amber-800",
  "Pending MD Approval": "bg-amber-100 text-amber-800",
  "On Hold": "bg-slate-200 text-slate-700",
  "Limited Quantity Approved": "bg-teal-100 text-teal-800",
  // Status of Purchase/Repair - grey while nothing has happened, blue once it
  // is on its way, green when it is here.
  "Not Ordered": "bg-slate-200 text-slate-700",
  "Finding Vendors": "bg-slate-100 text-slate-700",
  "Gathering Quotations": "bg-sky-50 text-sky-800",
  "Bidding Stage": "bg-sky-100 text-sky-800",
  "Order Placed": "bg-blue-100 text-blue-800",
  "Order Dispatched": "bg-blue-200 text-blue-900",
  "Sent for repair": "bg-violet-100 text-violet-800",
  Received: "bg-emerald-200 text-emerald-900",
  Delivered: "bg-emerald-200 text-emerald-900",
  // Priority
  Emergency: "bg-rose-200 text-rose-900",
  High: "bg-orange-100 text-orange-800",
  Medium: "bg-amber-100 text-amber-800",
  Low: "bg-slate-200 text-slate-700",
  // Type of Request
  "Purchase Request": "bg-indigo-50 text-indigo-800",
  "Repair Request": "bg-violet-50 text-violet-800",
};

const OPEN = (r) => !r.done && !["Rejected"].includes(r.approvalStatus);

const EMPTY_OPTIONS = {
  types: [],
  companies: [],
  priorities: [],
  approvalStatuses: [],
  purchaseStatuses: [],
  doneStatuses: ["Received", "Delivered"],
};

const NO_FILTERS = { company: "", type: "", approval: "", purchase: "" };

const PAGE_SIZE = 10;

/* ------------------------------------------------------------- Status model */

const APPROVED = ["Approved", "Limited Quantity Approved"];

/**
 * Where a request stands, from its two status fields: approval first, then
 * whether the buying or repair has started, then whether it is here.
 */
const stageOf = (r) => {
  if (r.approvalStatus === "Rejected") return "rejected";
  if (r.done) return "closed";
  if (APPROVED.includes(r.approvalStatus)) {
    return r.purchaseStatus && r.purchaseStatus !== "Not Ordered" ? "progress" : "approved";
  }
  return "pending";
};

const STAGE = {
  pending: { icon: Hourglass, cls: "border-amber-200 bg-amber-50 text-amber-800" },
  approved: { icon: CircleCheck, cls: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  progress: { icon: CircleDashed, cls: "border-sky-200 bg-sky-50 text-sky-700" },
  closed: { icon: Archive, cls: "border-slate-200 bg-slate-100 text-slate-700" },
  rejected: { icon: CircleX, cls: "border-rose-200 bg-rose-50 text-rose-700" },
};

const stageLabel = (r, stage) => {
  if (stage === "pending") return r.approvalStatus || "Pending";
  if (stage === "approved") return r.approvalStatus === "Approved" ? "Approved" : "Limited Qty Approved";
  if (stage === "progress") return "In Progress";
  if (stage === "closed") return "Closed";
  return "Rejected";
};

/** The line under the chip: what the buying is actually at. */
const stageDetail = (r, stage) => {
  if (stage === "progress") return r.purchaseStatus;
  if (stage === "closed") return r.receivedOn ? `${r.purchaseStatus} ${dmy(r.receivedOn)}` : r.purchaseStatus;
  return "";
};

const TYPE_STYLE = {
  "Purchase Request": { icon: ShoppingCart, cls: "border-blue-200/80 bg-blue-50 text-blue-700" },
  "Repair Request": { icon: Wrench, cls: "border-orange-200/80 bg-orange-50 text-orange-700" },
};

/* ------------------------------------------------------------------ Helpers */

const pad = (n) => String(n).padStart(2, "0");
/** Local date; toISOString would give yesterday for the first hours of an Indian day. */
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/** dd/mm/yyyy, as the sheet shows it. */
const dmy = (value) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ""));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
};

const errorOf = (err, fallback) => err?.response?.data?.message || fallback;

/** Reads a file as base64 so it can travel as JSON - the server has no multipart parser. */
const toBase64 = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(new Error("Could not read that file"));
    reader.readAsDataURL(file);
  });

const uploadImage = (id, file) => {
  if (file.size > MAX_BYTES) {
    return Promise.reject(new Error(`${file.name} is over 15 MB.`));
  }
  return toBase64(file).then((dataBase64) =>
    API.post(`/low-value-purchases/${id}/files`, {
      fileName: file.name,
      contentType: file.type,
      dataBase64,
    })
  );
};

/** A single-row read comes back with its images; the list only keeps the count. */
const asRow = ({ images, ...row }) => (Array.isArray(images) ? { ...row, files: images.length } : row);

/* ------------------------------------------------------------- Small pieces */

const Chip = ({ value, caret = false }) =>
  value ? (
    <span
      className={`inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium leading-4 ${
        CHIP[value] || "bg-slate-100 text-slate-700"
      }`}
    >
      <span className="truncate">{value}</span>
      {caret && <ChevronDown className="h-3 w-3 shrink-0 opacity-60" aria-hidden="true" />}
    </span>
  ) : null;

const TypeChip = ({ type }) => {
  const style = TYPE_STYLE[type] || { icon: FileText, cls: "border-slate-200 bg-slate-50 text-slate-700" };
  const Icon = style.icon;
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[12px] font-semibold ${style.cls}`}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {type || "Request"}
    </span>
  );
};

/** Icon and words both carry the state, so it never rests on colour alone. */
const StatusChip = ({ row, detail = true, end = false }) => {
  const stage = stageOf(row);
  const { icon: Icon, cls } = STAGE[stage];
  const sub = detail ? stageDetail(row, stage) : "";
  return (
    <span className={`inline-flex flex-col gap-1 ${end ? "items-start lg:items-end" : "items-start"}`}>
      <span
        className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[12px] font-semibold ${cls}`}
      >
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        {stageLabel(row, stage)}
      </span>
      {sub && <span className="pl-1 text-[11px] text-slate-500">{sub}</span>}
    </span>
  );
};

/** URLs in the links field open; the rest of the field still edits. */
const Linkified = ({ text }) =>
  String(text)
    .split(/(https?:\/\/\S+)/g)
    .map((part, i) =>
      /^https?:\/\//.test(part) ? (
        <a
          key={i}
          href={part}
          target="_blank"
          rel="noreferrer"
          className="text-blue-700 underline break-all"
          onClick={(e) => e.stopPropagation()}
        >
          {part}
        </a>
      ) : (
        part
      )
    );

/** Today's date and the time, kept current while the page is open. */
const Now = () => {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const weekday = now.toLocaleDateString("en-GB", { weekday: "long" });
  const date = now.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const time = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  return (
    <div className="hidden items-center gap-6 pt-2 text-[14px] text-slate-600 md:flex">
      <span className="flex items-center gap-2">
        <CalendarDays className="h-[18px] w-[18px] text-slate-500" aria-hidden="true" />
        {weekday}, {date}
      </span>
      <span className="flex items-center gap-2">
        <Clock className="h-[18px] w-[18px] text-slate-500" aria-hidden="true" />
        <time dateTime={now.toISOString()}>{time}</time>
      </span>
    </div>
  );
};

/* -------------------------------------------------------------------- Page */

const LowValuePurchases = () => {
  const { user } = useAuth();
  const { showToast } = useNotifications();

  const [rows, setRows] = useState([]);
  const [options, setOptions] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filters, setFilters] = useState(NO_FILTERS);
  const [openOnly, setOpenOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState(null); // { id, key }
  const [viewing, setViewing] = useState(null); // a row id
  const [imagesFor, setImagesFor] = useState(null); // a row
  const [raising, setRaising] = useState(false);

  useEffect(() => {
    API.get("/low-value-purchases/options")
      .then(({ data }) => setOptions({ ...EMPTY_OPTIONS, ...data }))
      .catch(() => setOptions(EMPTY_OPTIONS));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await API.get("/low-value-purchases", {
        params: { ...filters, open: openOnly ? 1 : undefined },
      });
      setRows(Array.isArray(data) ? data : []);
      setError("");
    } catch (err) {
      setError(errorOf(err, `Cannot reach the server at ${API.defaults.baseURL}.`));
    } finally {
      setLoading(false);
    }
  }, [filters, openOnly]);

  useEffect(() => {
    load();
  }, [load]);

  // The top bar's Refresh: read ERPNext again without leaving the screen.
  useErpRefresh(() => load());

  // The filters are applied by the server; the search box narrows what came back.
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(
      (r) =>
        !q ||
        [r.id, r.description, r.purpose, r.remarks, r.raisedByName, r.company, r.type].some((v) =>
          String(v || "").toLowerCase().includes(q)
        )
    );
  }, [rows, search]);

  const { page: current, rows: pageRows } = pageSlice(shown, page, PAGE_SIZE);

  const activeFilters =
    Object.values(filters).filter(Boolean).length + (openOnly ? 1 : 0) + (search ? 1 : 0);

  const doneStatuses = options?.doneStatuses || EMPTY_OPTIONS.doneStatuses;

  const patchRow = (id, fn) => setRows((rs) => rs.map((r) => (r.id === id ? fn(r) : r)));

  /**
   * One field, saved on its own. Shown at once and put back if the server says
   * no; only that field is put back, so a second edit to the same request that
   * is still in flight is not undone with it.
   */
  const saveCell = async (row, key, value) => {
    setEditing(null);
    if ((row[key] ?? "") === (value ?? "")) return;
    const before = { [key]: row[key], done: row.done, receivedOn: row.receivedOn };
    patchRow(row.id, (r) => ({
      ...r,
      [key]: value,
      ...(key === "purchaseStatus" ? { done: doneStatuses.includes(value) } : {}),
    }));
    try {
      const { data } = await API.put(`/low-value-purchases/${row.id}`, { [key]: value });
      patchRow(row.id, (r) => ({ ...r, ...asRow(data) }));
    } catch (err) {
      patchRow(row.id, (r) => ({ ...r, ...before }));
      showToast(errorOf(err, "Could not save the change"), "error");
    }
  };

  // Every change to what is shown starts again from the first page.
  const setFilter = (name) => (e) => {
    setFilters((f) => ({ ...f, [name]: e.target.value }));
    setPage(1);
  };

  const clearAll = () => {
    setFilters(NO_FILTERS);
    setOpenOnly(false);
    setSearch("");
    setPage(1);
  };

  const copyId = (row) =>
    navigator.clipboard
      ?.writeText(row.id)
      .then(() => showToast("Request ID copied", "success"))
      .catch(() => showToast("Could not copy the request ID", "error"));

  const opts = options || EMPTY_OPTIONS;
  const viewingRow = viewing ? rows.find((r) => r.id === viewing) : null;

  return (
    <div className="space-y-5 sm:space-y-6">
      {/* ------------------------------------------------------------ Header */}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-brand-50 text-brand-600 ring-1 ring-brand-100 sm:h-14 sm:w-14">
            <ClipboardList className="h-6 w-6 sm:h-7 sm:w-7" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h1 className="text-[22px] font-bold tracking-tight text-slate-900 sm:text-[28px]">
              Miscellaneous Purchases
            </h1>
            <p className="mt-0.5 text-[13px] text-slate-500 sm:text-sm">
              Purchase and repair requests for every company
            </p>
          </div>
        </div>
        <Now />
      </header>

      {/* ------------------------------------------------------------ Filters */}
      <div className="card flex flex-col gap-3 p-3 sm:p-4 xl:flex-row xl:flex-wrap xl:items-center">
        <div className="relative min-w-0 xl:min-w-[18rem] xl:flex-1">
          <Search
            className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
            aria-hidden="true"
          />
          <input
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search by request ID, company, item, description…"
            className="field field-search"
            aria-label="Search requests"
          />
        </div>

        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
          <FilterSelect label="All Companies" value={filters.company} onChange={setFilter("company")} items={opts.companies} />
          <FilterSelect label="All Types" value={filters.type} onChange={setFilter("type")} items={opts.types} />
          <FilterSelect label="Any Approval" value={filters.approval} onChange={setFilter("approval")} items={opts.approvalStatuses} />
          <FilterSelect label="Any Status" value={filters.purchase} onChange={setFilter("purchase")} items={opts.purchaseStatuses} />
          <label className="flex h-10 cursor-pointer select-none items-center gap-2 rounded-[10px] border border-slate-300/80 bg-white px-3 text-sm font-medium text-slate-700 transition-colors hover:border-slate-400 max-sm:h-11">
            <input
              type="checkbox"
              checked={openOnly}
              onChange={(e) => {
                setOpenOnly(e.target.checked);
                setPage(1);
              }}
              className="h-4 w-4 cursor-pointer accent-brand-600"
            />
            Open only
          </label>
        </div>

        <div className="flex items-center gap-2 xl:ml-auto">
          {activeFilters > 0 && (
            <button type="button" className="btn btn-subtle" onClick={clearAll}>
              <X className="h-4 w-4" aria-hidden="true" />
              Clear
            </button>
          )}
          <button type="button" className="btn btn-neutral" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden="true" />
            Refresh
          </button>
          <button
            type="button"
            className="btn btn-neutral btn-icon"
            onClick={() => window.print()}
            disabled={!shown.length}
            aria-label="Print the requests shown"
            title="Print"
          >
            <Printer className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="btn btn-primary ml-auto xl:ml-0"
            onClick={() => setRaising(true)}
            disabled={!options}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            New Request
          </button>
        </div>
      </div>

      {/* -------------------------------------------------------------- List */}
      {/* One card per request, on every screen size: the item as the title,
          who and where under it, the state and the actions on the right. */}
      <div className="space-y-3">
        {error && (
          <div className="note note-rose">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        {pageRows.length > 0 && (
          <ul className="space-y-3">
            {pageRows.map((row) => (
              <RequestCard
                key={row.id}
                row={row}
                onView={() => setViewing(row.id)}
                onImages={() => setImagesFor(row)}
                onCopy={() => copyId(row)}
              />
            ))}
          </ul>
        )}

        {!loading && !shown.length && !error && (
          <div className="empty">
            <FileSpreadsheet className="mx-auto mb-2 h-8 w-8 text-slate-300" aria-hidden="true" />
            <p className="empty-title">No requests to show</p>
            <p className="empty-sub">
              {rows.length ? "Nothing matches the search or filters." : "No request matches these filters yet."}
            </p>
            {activeFilters > 0 && (
              <button type="button" className="btn btn-sm btn-neutral mt-4" onClick={clearAll}>
                Clear filters
              </button>
            )}
          </div>
        )}
        {loading && !rows.length && (
          <div className="card flex justify-center py-12 text-slate-400" role="status" aria-label="Loading requests">
            <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" />
          </div>
        )}

        <Pagination page={current} total={shown.length} pageSize={PAGE_SIZE} onPage={setPage} noun="request" />
      </div>

      <PrintSheet rows={shown} />

      {viewingRow && (
        <RequestPanel
          row={viewingRow}
          options={opts}
          editing={editing?.id === viewingRow.id ? editing.key : null}
          covered={Boolean(imagesFor)}
          onEdit={(key) => setEditing({ id: viewingRow.id, key })}
          onCancel={() => setEditing(null)}
          onSave={(key, value) => saveCell(viewingRow, key, value)}
          onImages={() => setImagesFor(viewingRow)}
          onCopy={() => copyId(viewingRow)}
          onClose={() => {
            setEditing(null);
            setViewing(null);
          }}
        />
      )}

      {imagesFor && (
        <ImagesPanel
          row={rows.find((r) => r.id === imagesFor.id) || imagesFor}
          onClose={() => setImagesFor(null)}
          onCount={(files) => patchRow(imagesFor.id, (r) => ({ ...r, files }))}
        />
      )}

      {raising && options && (
        <NewRequest
          options={opts}
          defaultName={user?.name || ""}
          onClose={() => setRaising(false)}
          onDone={(row) => {
            setRaising(false);
            setRows((rs) => [row, ...rs]);
            setPage(1);
            showToast("Request added", "success");
          }}
        />
      )}
    </div>
  );
};

const Dot = () => (
  <span className="text-slate-300" aria-hidden="true">
    ·
  </span>
);

/**
 * One request in the list. The item is the title - it is what people look for
 * - with the reference, date, company and who raised it under it, the purpose
 * on its own line, and the state and actions to the right (below, on a phone).
 */
const RequestCard = ({ row, onView, onImages, onCopy }) => {
  const style = TYPE_STYLE[row.type] || { icon: FileText, cls: "border-slate-200 bg-slate-50 text-slate-700" };
  const Icon = style.icon;
  const urgent = row.priority === "Emergency" && OPEN(row);

  return (
    <li
      className={`card flex gap-4 p-4 transition-shadow hover:shadow-md sm:p-5 ${
        urgent ? "border-l-4 border-l-rose-500" : ""
      }`}
    >
      <span className={`hidden h-11 w-11 shrink-0 place-items-center rounded-xl border sm:grid ${style.cls}`}>
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-4 lg:flex-row lg:items-start lg:justify-between lg:gap-8">
        <div className="min-w-0 flex-1">
          <button type="button" onClick={onView} className="group block w-full cursor-pointer text-left">
            <h3 className="line-clamp-2 whitespace-pre-line break-words text-[15px] font-semibold leading-snug text-slate-900 group-hover:text-brand-700">
              {row.description || "Untitled request"}
            </h3>
          </button>

          <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-slate-500">
            <span className="mono text-slate-600">{row.id}</span>
            <Dot />
            <span>{dmy(row.date)}</span>
            <Dot />
            <span className="font-medium text-slate-700">{row.company}</span>
            {row.raisedByName && (
              <>
                <Dot />
                <span>Raised by {row.raisedByName}</span>
              </>
            )}
            {row.files > 0 && (
              <>
                <Dot />
                <span className="inline-flex items-center gap-1">
                  <Paperclip className="h-3.5 w-3.5" aria-hidden="true" />
                  {row.files} image{row.files === 1 ? "" : "s"}
                </span>
              </>
            )}
          </p>

          {row.purpose && (
            <p className="mt-2 line-clamp-2 text-[13px] text-slate-600">
              <span className="font-semibold text-slate-700">Purpose:</span> {row.purpose}
            </p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <TypeChip type={row.type} />
            <PriorityFlag row={row} inline />
          </div>
        </div>

        <div className="flex shrink-0 items-start justify-between gap-3 border-t border-slate-100 pt-3 lg:flex-col lg:items-end lg:border-0 lg:pt-0">
          <StatusChip row={row} end />
          <div className="flex items-center gap-1.5">
            <button type="button" className="btn btn-sm btn-neutral" onClick={onView}>
              <Eye className="h-4 w-4" aria-hidden="true" />
              View
            </button>
            <RowMenu row={row} onView={onView} onImages={onImages} onCopy={onCopy} />
          </div>
        </div>
      </div>
    </li>
  );
};

const FilterSelect = ({ label, value, onChange, items }) => (
  <select
    value={value}
    onChange={onChange}
    className={`field w-full cursor-pointer sm:w-44 ${value ? "border-brand-400 bg-brand-50" : ""}`}
    aria-label={label}
  >
    <option value="">{label}</option>
    {items.map((v) => (
      <option key={v} value={v}>
        {v}
      </option>
    ))}
  </select>
);

/** Emergency and High are worth a flag while the request is still open. */
const PriorityFlag = ({ row, inline = false }) => {
  if (!OPEN(row) || !["Emergency", "High"].includes(row.priority)) return null;
  const emergency = row.priority === "Emergency";
  return (
    <span
      className={`${inline ? "inline-flex" : "mt-1 flex"} items-center gap-1 text-[11px] font-semibold ${
        emergency ? "text-rose-700" : "text-orange-700"
      }`}
    >
      <Flame className="h-3 w-3" aria-hidden="true" />
      {row.priority}
    </span>
  );
};

/**
 * The ⋮ on a row. The menu is placed on the page rather than inside the table,
 * whose horizontal scroll would otherwise clip it on the last rows.
 */
const RowMenu = ({ row, onView, onImages, onCopy }) => {
  const [at, setAt] = useState(null); // { top, right } while open
  const buttonRef = useRef(null);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!at) return undefined;
    menuRef.current?.querySelector("button")?.focus();
    const close = () => setAt(null);
    const onDown = (e) => {
      if (!menuRef.current?.contains(e.target) && !buttonRef.current?.contains(e.target)) close();
    };
    const onKey = (e) => {
      if (e.key === "Escape") {
        close();
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [at]);

  const toggle = () => {
    if (at) return setAt(null);
    const r = buttonRef.current.getBoundingClientRect();
    setAt({ top: r.bottom + 4, right: window.innerWidth - r.right });
  };

  const item = (Icon, label, run) => (
    <button
      type="button"
      role="menuitem"
      onClick={() => {
        setAt(null);
        run();
      }}
      className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] font-medium text-slate-700 hover:bg-slate-100 hover:text-slate-900 focus:bg-slate-100 focus:outline-none"
    >
      <Icon className="h-4 w-4 text-slate-500" aria-hidden="true" />
      {label}
    </button>
  );

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        className="icon-btn border border-slate-200 hover:border-slate-300"
        aria-label={`More actions for ${row.id}`}
        aria-haspopup="menu"
        aria-expanded={Boolean(at)}
      >
        <EllipsisVertical className="h-4 w-4" aria-hidden="true" />
      </button>
      {at &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            className="card fixed z-40 w-52 p-1.5 shadow-xl animate-fade-in"
            style={{ top: at.top, right: at.right }}
          >
            {item(Eye, (row.editable || []).length ? "View & edit" : "View details", onView)}
            {item(Paperclip, row.files ? `Images (${row.files})` : "Images", onImages)}
            {item(Copy, "Copy request ID", onCopy)}
          </div>,
          document.body
        )}
    </>
  );
};

/**
 * One request, every field, in a panel from the right. Fields the person may
 * change are edited where they sit - a click turns the field into its editor,
 * and leaving it saves - exactly as the sheet's cells were.
 */
const RequestPanel = ({ row, options, editing, covered, onEdit, onCancel, onSave, onImages, onCopy, onClose }) => {
  const closeRef = useRef(null);
  const editable = row.editable || [];
  // Escape inside a field cancels that edit, and with the images window over
  // the panel it belongs to that window; only a bare Escape closes the panel.
  // Held in a ref so the listener is set up once.
  const latest = useRef({ editing, covered, onClose });
  latest.current = { editing, covered, onClose };

  useEffect(() => {
    const opener = document.activeElement;
    closeRef.current?.focus();
    const onKey = (e) => {
      if (e.key === "Escape" && !latest.current.editing && !latest.current.covered) latest.current.onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
  }, []);

  const field = (key, label = COL[key].header, wide = false) => (
    <div className={wide ? "sm:col-span-2" : ""}>
      <div className="mb-1 text-[12px] font-semibold text-slate-500">{label}</div>
      <div
        className={`overflow-hidden rounded-lg border text-[14px] text-slate-900 ${
          editable.includes(key) ? "border-slate-300/80 bg-white" : "border-slate-200 bg-slate-50"
        }`}
      >
        <Cell
          row={row}
          col={COL[key]}
          items={COL[key].from ? options[COL[key].from] : null}
          canEdit={editable.includes(key)}
          isEditing={editing === key}
          onEdit={() => onEdit(key)}
          onCancel={onCancel}
          onSave={(value) => onSave(key, value)}
        />
      </div>
    </div>
  );

  const section = (title, children) => (
    <section>
      <h3 className="eyebrow mb-3">{title}</h3>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-slate-950/45 backdrop-blur-[2px] animate-fade-in"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="request-panel-title"
        className="flex h-dvh w-full max-w-xl flex-col bg-white shadow-2xl animate-rise-in"
      >
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <button
              type="button"
              onClick={onCopy}
              className="mono inline-flex cursor-pointer items-center gap-1.5 text-slate-500 hover:text-slate-900"
              title="Copy request ID"
            >
              {row.id}
              <Copy className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            <h2 id="request-panel-title" className="mt-1 line-clamp-2 text-[17px] font-bold tracking-tight text-slate-900">
              {(row.description || "Request").split("\n")[0]}
            </h2>
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <TypeChip type={row.type} />
              <StatusChip row={row} detail={false} />
              <PriorityFlag row={row} inline />
            </div>
          </div>
          <button ref={closeRef} type="button" className="modal-close" onClick={onClose} aria-label="Close">
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5 sm:px-6">
          {editable.length > 0 && (
            <p className="note note-brand">Select a field to change it. Each change saves on its own.</p>
          )}

          {section(
            "Request",
            <>
              {field("date")}
              {field("type")}
              {field("company")}
              {field("raisedByName")}
              {field("priority")}
            </>
          )}

          {section(
            "What and why",
            <>
              {field("description", "Description", true)}
              {field("purpose", "Purpose of purchase / repair", true)}
              {field("links", "Links / brands, or vendor contact", true)}
            </>
          )}

          <section>
            <h3 className="eyebrow mb-3">Image samples</h3>
            <button type="button" className="btn btn-sm btn-neutral" onClick={onImages}>
              <Paperclip className="h-4 w-4" aria-hidden="true" />
              {row.files
                ? `${row.files} image${row.files === 1 ? "" : "s"}`
                : editable.length
                  ? "Add an image"
                  : "No images"}
            </button>
          </section>

          {section(
            "Progress",
            <>
              {field("approvalStatus", "Approval")}
              {field("purchaseStatus", "Purchase / repair")}
              {field("expectedOn", "Expected arrival")}
              {field("receivedOn", "Received")}
            </>
          )}

          {section("Remarks", field("remarks", "Remarks", true))}
        </div>
      </aside>
    </div>
  );
};

const display = (row, col) => {
  const value = row[col.key];
  if (col.kind === "date") return dmy(value);
  if (col.kind === "pick") return <Chip value={value} />;
  if (col.key === "links") return value ? <Linkified text={value} /> : "";
  return value;
};

const EMPTY = <span className="text-slate-400">—</span>;

const Cell = ({ row, col, items, canEdit, isEditing, onEdit, onCancel, onSave }) => {
  const wrap = "min-h-[2.5rem] px-3 py-2 whitespace-pre-wrap break-words leading-snug";
  const blank = row[col.key] == null || row[col.key] === "";

  if (!canEdit) return <div className={wrap}>{blank ? EMPTY : display(row, col)}</div>;

  if (!isEditing) {
    return (
      <button
        type="button"
        onClick={onEdit}
        className={`${wrap} block h-full w-full cursor-pointer text-left hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500`}
      >
        {blank ? EMPTY : col.kind === "pick" ? <Chip value={row[col.key]} caret /> : display(row, col)}
      </button>
    );
  }

  return <CellEditor value={row[col.key]} col={col} items={items} onCancel={onCancel} onSave={onSave} />;
};

/** The field while it is being changed: a dropdown, a date or a text box. */
const CellEditor = ({ value, col, items, onCancel, onSave }) => {
  const [draft, setDraft] = useState(value ?? "");
  // Escape cancels; without this the blur that follows would save anyway.
  const cancelled = useRef(false);
  const ring = "w-full rounded-none border-0 bg-white text-[14px] ring-2 ring-inset ring-brand-500 focus:outline-none";

  const commit = () => {
    if (!cancelled.current) onSave(col.kind === "text" ? draft.trim() : draft);
  };
  const onKeyDown = (e) => {
    if (e.key === "Escape") {
      cancelled.current = true;
      onCancel();
    } else if (e.key === "Enter" && !e.shiftKey && col.kind !== "pick") {
      e.preventDefault();
      e.currentTarget.blur();
    }
  };

  if (col.kind === "pick") {
    return (
      <select
        autoFocus
        value={draft}
        onChange={(e) => {
          cancelled.current = true; // saved here; the blur that follows must not save again
          onSave(e.target.value);
        }}
        onBlur={() => !cancelled.current && onCancel()}
        onKeyDown={onKeyDown}
        className={`${ring} h-10 cursor-pointer px-2.5`}
      >
        {!items?.includes(draft) && <option value={draft}>{draft || "—"}</option>}
        {(items || []).map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
      </select>
    );
  }

  if (col.kind === "date") {
    return (
      <input
        type="date"
        autoFocus
        value={draft ? String(draft).slice(0, 10) : ""}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={onKeyDown}
        className={`${ring} h-10 px-2.5`}
      />
    );
  }

  return (
    <textarea
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={(e) => e.target.setSelectionRange(e.target.value.length, e.target.value.length)}
      onBlur={commit}
      onKeyDown={onKeyDown}
      rows={Math.min(8, Math.max(3, String(draft).split("\n").length + 1))}
      className={`${ring} block resize-y px-3 py-2 leading-snug`}
      title="Enter saves, Shift+Enter for a new line, Esc cancels"
    />
  );
};

/** The images on one row: open them, and add or take away if the row is yours to change. */
const ImagesPanel = ({ row, onClose, onCount }) => {
  const { showToast } = useNotifications();
  const { confirm } = useDialog();
  const [images, setImages] = useState(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef(null);
  const canEdit = (row.editable || []).length > 0;
  // Both are new functions on every render; held so they do not re-run the load.
  const latest = useRef({ onCount, showToast });
  latest.current = { onCount, showToast };

  const load = useCallback(async () => {
    try {
      const { data } = await API.get(`/low-value-purchases/${row.id}`);
      const list = data.images || [];
      setImages(list);
      latest.current.onCount(list.length);
    } catch (err) {
      setImages([]);
      latest.current.showToast(errorOf(err, "Could not load the images"), "error");
    }
  }, [row.id]);

  useEffect(() => {
    load();
  }, [load]);

  const add = async (files) => {
    const list = [...files];
    if (!list.length) return;
    setBusy(true);
    for (const file of list) {
      try {
        await uploadImage(row.id, file);
      } catch (err) {
        showToast(errorOf(err, err.message || `Could not attach ${file.name}`), "error");
      }
    }
    if (fileInput.current) fileInput.current.value = "";
    await load();
    setBusy(false);
  };

  const remove = async (image) => {
    const ok = await confirm({
      title: "Remove this image?",
      message: image.fileName,
      confirmLabel: "Remove",
      tone: "danger",
    });
    if (!ok) return;
    setBusy(true);
    try {
      await API.delete(`/low-value-purchases/${row.id}/files/${image.id}`);
      await load();
    } catch (err) {
      showToast(errorOf(err, "Could not remove it"), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="min-w-0">
            <h3 className="modal-title">
              <ImageIcon className="h-[18px] w-[18px] shrink-0 text-brand-700" />
              Image samples
            </h3>
            <p className="modal-sub truncate">{row.description || row.id}</p>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="modal-body">
          {images === null ? (
            <div className="flex justify-center py-8 text-slate-400">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : images.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">No images on this row.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {images.map((img) => (
                <li key={img.id} className="flex items-center gap-3 py-2">
                  {img.isPrivate ? (
                    <ImageIcon className="h-4 w-4 shrink-0 text-slate-400" />
                  ) : (
                    <img src={img.url} alt="" className="h-12 w-12 shrink-0 rounded border border-slate-200 object-cover" />
                  )}
                  <a
                    href={img.url}
                    target="_blank"
                    rel="noreferrer"
                    className="min-w-0 flex-1 truncate text-sm font-medium text-blue-700 hover:underline"
                  >
                    {img.fileName}
                  </a>
                  {canEdit && (
                    <button
                      className="icon-btn icon-btn-danger"
                      onClick={() => remove(img)}
                      disabled={busy}
                      aria-label={`Remove ${img.fileName}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
        {canEdit && (
          <div className="modal-foot">
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => add(e.target.files)}
            />
            <button className="btn btn-sm btn-primary" onClick={() => fileInput.current?.click()} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              Add image
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

/** A new row: the columns the person raising it fills in. Approval and purchase start where the server puts them. */
const NewRequest = ({ options, defaultName, onClose, onDone }) => {
  const { showToast } = useNotifications();
  const [form, setForm] = useState({
    date: today(),
    type: options.types[0] || "Purchase Request",
    company: "",
    raisedByName: defaultName,
    description: "",
    purpose: "",
    links: "",
    priority: options.priorities.includes("High") ? "High" : options.priorities[0] || "",
  });
  const [image, setImage] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    if (!form.company) return setError("Choose the company.");
    if (!form.description.trim()) return setError("Describe what is needed.");
    if (image && image.size > MAX_BYTES) return setError(`${image.name} is over 15 MB.`);
    setError("");
    setSaving(true);
    let row;
    try {
      const { data } = await API.post("/low-value-purchases", {
        ...form,
        raisedByName: form.raisedByName.trim() || undefined,
        description: form.description.trim(),
        purpose: form.purpose.trim(),
        links: form.links.trim(),
      });
      row = asRow(data);
    } catch (err) {
      setSaving(false);
      return setError(errorOf(err, "Could not add the request."));
    }
    // The row is on the sheet by now; a failed image is reported, not a failed request.
    if (image) {
      try {
        await uploadImage(row.id, image);
        row = { ...row, files: (row.files || 0) + 1 };
      } catch (err) {
        showToast(errorOf(err, err.message || "The request was added, but the image could not be attached"), "error");
      }
    }
    onDone(row);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal max-w-2xl" onClick={(e) => e.stopPropagation()} onSubmit={submit} noValidate>
        <div className="modal-head">
          <div className="min-w-0">
            <h3 className="modal-title">
              <Plus className="h-[18px] w-[18px] shrink-0 text-brand-700" />
              New purchase / repair request
            </h3>
            <p className="modal-sub">Adds a line to Miscellaneous Purchases.</p>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="modal-body grid gap-4 sm:grid-cols-2">
          <Field label="Date">
            <input type="date" value={form.date} onChange={set("date")} className="field field-sm" />
          </Field>
          <Field label="Type of request">
            <PickField value={form.type} onChange={set("type")} items={options.types} />
          </Field>
          <Field label="Company">
            <PickField value={form.company} onChange={set("company")} items={options.companies} placeholder="Choose…" />
          </Field>
          <Field label="Raised by">
            <input value={form.raisedByName} onChange={set("raisedByName")} className="field field-sm" maxLength={60} />
          </Field>
          <Field label="Description" wide>
            <textarea value={form.description} onChange={set("description")} rows={3} className="field field-area" />
          </Field>
          <Field label="Purpose of purchase / repair" wide>
            <textarea value={form.purpose} onChange={set("purpose")} rows={2} className="field field-area" />
          </Field>
          <Field label="Links / brands, or vendor contact" wide>
            <textarea value={form.links} onChange={set("links")} rows={2} className="field field-area" />
          </Field>
          <Field label="Priority">
            <PickField value={form.priority} onChange={set("priority")} items={options.priorities} />
          </Field>
          <Field label="Image sample (optional)">
            <input
              type="file"
              accept="image/*"
              onChange={(e) => setImage(e.target.files?.[0] || null)}
              className="block w-full text-[13px] text-slate-600 file:mr-2 file:cursor-pointer file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-[13px] file:font-semibold"
            />
          </Field>
          {error && (
            <div className="note note-rose sm:col-span-2">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <div className="modal-foot">
          <button type="button" className="btn btn-sm btn-neutral" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" className="btn btn-sm btn-primary" disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Add to sheet
          </button>
        </div>
      </form>
    </div>
  );
};

const Field = ({ label, wide = false, children }) => (
  <label className={`block ${wide ? "sm:col-span-2" : ""}`}>
    <span className="field-label">{label}</span>
    {children}
  </label>
);

const PickField = ({ value, onChange, items, placeholder }) => (
  <select value={value} onChange={onChange} className="field field-sm cursor-pointer">
    {placeholder && <option value="">{placeholder}</option>}
    {items.map((v) => (
      <option key={v} value={v}>
        {v}
      </option>
    ))}
  </select>
);

/**
 * What prints: the rows on screen, as the sheet, landscape.
 *
 * Kept in a portal beside #root because index.css hides the whole application
 * when printing (see ChecklistSheet.jsx); it is invisible on screen, so the
 * browser's own Ctrl+P prints it too, not only the button.
 */
const PrintSheet = ({ rows }) =>
  createPortal(
    <div className="print-sheet hidden print:block">
      <style>{"@page { size: A4 landscape; margin: 8mm; }"}</style>
      <div
        className="border border-slate-400 py-1 text-center text-sm font-bold"
        style={{ fontFamily: "Arial, Helvetica, sans-serif" }}
      >
        Miscellaneous Purchases
      </div>
      <table
        className="w-full table-fixed border-collapse text-[7.5px] leading-tight text-black"
        style={{ fontFamily: "Arial, Helvetica, sans-serif" }}
      >
        <colgroup>
          {COLUMNS.map((c) => (
            <col key={c.key} style={{ width: `${(c.width / SHEET_WIDTH) * 100}%` }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {COLUMNS.map((c) => (
              <th key={c.key} className="border border-slate-400 bg-slate-100 p-1 text-left align-bottom font-bold">
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} style={r.done ? { backgroundColor: DONE_GREEN } : undefined}>
              {COLUMNS.map((c) => (
                <td key={c.key} className="whitespace-pre-wrap break-words border border-slate-400 p-1 align-top">
                  {c.kind === "date" ? dmy(r[c.key]) : c.kind === "images" ? r.files || "" : r[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>,
    document.body
  );

export default LowValuePurchases;
