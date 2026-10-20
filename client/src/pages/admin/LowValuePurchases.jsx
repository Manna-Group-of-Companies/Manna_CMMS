import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Clock,
  FileSpreadsheet,
  Filter,
  Flame,
  Truck,
  Image as ImageIcon,
  Loader2,
  Paperclip,
  Plus,
  Printer,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";

import API from "../../services/api";
import { useAuth } from "../../context/AuthContext";
import { useNotifications } from "../../context/NotificationContext";

/**
 * The Purchase Request Sheet (20 Oct 2026).
 *
 * The purchasing team ran local buying and repairs off a Google Sheet, and asked
 * for "this style in the website" - so this is laid out as that sheet: the
 * the same fourteen columns in the same order, dropdown cells
 * shown as coloured chips, a row going green once the thing has arrived. Cells
 * are edited where they sit, one column per save, as they were in the sheet.
 *
 * Which cells a person may change is the server's answer (`editable` on each
 * row), never worked out here from the role.
 */

/** The server refuses anything larger. */
const MAX_BYTES = 15 * 1024 * 1024;

const DONE_GREEN = "#B7E1CD";

/** The sheet's columns, in its order and with its headings. */
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

const SHEET_WIDTH = COLUMNS.reduce((sum, c) => sum + c.width, 0);

/** Chip colours, as the sheet's dropdowns had them. */
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

/** The tiles above the sheet, and what each narrows it to. */
const QUICK = {
  waiting: {
    label: "Awaiting approval",
    icon: Clock,
    tone: "bg-amber-100 text-amber-700",
    test: (r) => ["Pending", "Pending MD Approval", "On Hold"].includes(r.approvalStatus),
  },
  buying: {
    label: "Approved, not received",
    icon: Truck,
    tone: "bg-blue-100 text-blue-700",
    test: (r) => ["Approved", "Limited Quantity Approved"].includes(r.approvalStatus) && !r.done,
  },
  emergency: {
    label: "Emergency, open",
    icon: Flame,
    tone: "bg-rose-100 text-rose-700",
    test: (r) => r.priority === "Emergency" && OPEN(r),
  },
  done: {
    label: "Received / delivered",
    icon: CheckCircle2,
    tone: "bg-emerald-100 text-emerald-700",
    test: (r) => r.done,
  },
  rejected: {
    label: "Rejected",
    icon: X,
    tone: "bg-slate-200 text-slate-600",
    test: (r) => r.approvalStatus === "Rejected",
  },
};

const EMPTY_OPTIONS = {
  types: [],
  companies: [],
  priorities: [],
  approvalStatuses: [],
  purchaseStatuses: [],
  doneStatuses: ["Received", "Delivered"],
};

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

/** A single-row read comes back with its images; the sheet only keeps the count. */
const asRow = ({ images, ...row }) => (Array.isArray(images) ? { ...row, files: images.length } : row);

const Chip = ({ value, caret = false }) =>
  value ? (
    <span
      className={`inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium leading-4 ${
        CHIP[value] || "bg-slate-100 text-slate-700"
      }`}
    >
      <span className="truncate">{value}</span>
      {caret && <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />}
    </span>
  ) : null;

/** URLs in the links column open; the rest of the cell still edits. */
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

const LowValuePurchases = () => {
  const { user } = useAuth();
  const { showToast } = useNotifications();

  const [rows, setRows] = useState([]);
  const [options, setOptions] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filters, setFilters] = useState({ company: "", type: "", approval: "", purchase: "" });
  const [openOnly, setOpenOnly] = useState(false);
  const [search, setSearch] = useState("");
  // A tile pressed above the sheet; narrows what is already loaded.
  const [quick, setQuick] = useState("");
  // The filters fold away on a phone, where they would take the whole screen.
  const [showFilters, setShowFilters] = useState(false);
  const [editing, setEditing] = useState(null); // { id, key }
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

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    const test = QUICK[quick]?.test;
    return rows.filter(
      (r) =>
        (!test || test(r)) &&
        (!q ||
          [r.description, r.purpose, r.remarks, r.raisedByName, r.company].some((v) =>
            String(v || "").toLowerCase().includes(q)
          ))
    );
  }, [rows, search, quick]);

  const tally = useMemo(
    () => Object.fromEntries(Object.entries(QUICK).map(([k, q]) => [k, rows.filter(q.test).length])),
    [rows]
  );
  const activeFilters = Object.values(filters).filter(Boolean).length + (openOnly ? 1 : 0);

  const doneStatuses = options?.doneStatuses || EMPTY_OPTIONS.doneStatuses;

  const patchRow = (id, fn) => setRows((rs) => rs.map((r) => (r.id === id ? fn(r) : r)));

  /**
   * One cell, saved on its own. Shown at once and put back if the server says
   * no; only that column is put back, so a second edit to the same row that is
   * still in flight is not undone with it.
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

  const setFilter = (name) => (e) => setFilters((f) => ({ ...f, [name]: e.target.value }));

  const opts = options || EMPTY_OPTIONS;

  return (
    <div className="space-y-4">
      {/* What needs attention, at a glance. Each tile also narrows the sheet. */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {Object.entries(QUICK).map(([key, q]) => (
          <button
            key={key}
            type="button"
            onClick={() => setQuick((k) => (k === key ? "" : key))}
            className={`card flex cursor-pointer items-center gap-3 p-3 text-left transition hover:-translate-y-px hover:shadow-md ${
              quick === key ? "ring-2 ring-brand-500" : ""
            }`}
            aria-pressed={quick === key}
          >
            <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${q.tone}`}>
              <q.icon className="h-[18px] w-[18px]" />
            </span>
            <span className="min-w-0">
              <span className="block text-xl font-bold leading-6 text-slate-900">{tally[key] ?? 0}</span>
              <span className="block truncate text-[12px] text-slate-500">{q.label}</span>
            </span>
          </button>
        ))}
      </div>

      <div className="card overflow-hidden">
        <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-2.5">
          <FileSpreadsheet className="h-5 w-5 shrink-0 text-brand-600" />
          <h2 className="text-base font-bold text-slate-900 sm:text-lg">Purchase Request Sheet</h2>
          <span className="ml-auto rounded-full bg-slate-100 px-2 py-0.5 text-[12px] font-semibold text-slate-700">
            {shown.length} {shown.length === 1 ? "row" : "rows"}
          </span>
        </div>

        <div className="space-y-2 border-b border-slate-200 bg-slate-50/60 p-3">
          <div className="flex items-center gap-2">
            <div className="relative min-w-0 flex-1 sm:max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search item, purpose, company, remarks…"
                className="field field-sm field-search"
                aria-label="Search the sheet"
              />
            </div>
            <button
              type="button"
              className={`btn btn-sm btn-neutral md:hidden ${showFilters ? "ring-2 ring-brand-500" : ""}`}
              onClick={() => setShowFilters((v) => !v)}
              aria-expanded={showFilters}
            >
              <Filter className="h-4 w-4" />
              {activeFilters ? <span className="font-bold">{activeFilters}</span> : null}
            </button>
            <div className="ml-auto flex shrink-0 gap-2">
              <button className="btn btn-sm btn-neutral" onClick={load} disabled={loading} aria-label="Refresh">
                <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              </button>
              <button
                className="btn btn-sm btn-neutral hidden sm:inline-flex"
                onClick={() => window.print()}
                disabled={!shown.length}
              >
                <Printer className="h-4 w-4" />
                Print
              </button>
              <button className="btn btn-sm btn-primary" onClick={() => setRaising(true)} disabled={!options}>
                <Plus className="h-4 w-4" />
                <span className="hidden sm:inline">New request</span>
                <span className="sm:hidden">New</span>
              </button>
            </div>
          </div>

          <div className={`${showFilters ? "grid" : "hidden"} grid-cols-2 gap-2 md:flex md:flex-wrap md:items-center`}>
            <FilterSelect label="All companies" value={filters.company} onChange={setFilter("company")} items={opts.companies} />
            <FilterSelect label="All types" value={filters.type} onChange={setFilter("type")} items={opts.types} />
            <FilterSelect label="Any approval" value={filters.approval} onChange={setFilter("approval")} items={opts.approvalStatuses} />
            <FilterSelect
              label="Any purchase status"
              value={filters.purchase}
              onChange={setFilter("purchase")}
              items={opts.purchaseStatuses}
            />
            <label className="flex cursor-pointer items-center gap-1.5 text-[13px] text-slate-700">
              <input
                type="checkbox"
                checked={openOnly}
                onChange={(e) => setOpenOnly(e.target.checked)}
                className="h-4 w-4 accent-brand-600"
              />
              Open only
            </label>
            {(activeFilters > 0 || quick) && (
              <button
                type="button"
                className="text-[13px] font-medium text-brand-700 hover:underline md:ml-1"
                onClick={() => {
                  setFilters({ company: "", type: "", approval: "", purchase: "" });
                  setOpenOnly(false);
                  setQuick("");
                }}
              >
                Clear filters
              </button>
            )}
          </div>
        </div>

        {error && (
          <div className="note note-rose m-3">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Phones: one card per row, edited in place like the sheet's cells. */}
        <div className="divide-y divide-slate-200 md:hidden">
          {shown.map((row) => (
            <RowCard
              key={row.id}
              row={row}
              options={opts}
              editing={editing?.id === row.id ? editing.key : null}
              onEdit={(key) => setEditing({ id: row.id, key })}
              onCancel={() => setEditing(null)}
              onSave={(key, value) => saveCell(row, key, value)}
              onImages={() => setImagesFor(row)}
            />
          ))}
        </div>

        {/* Wider screens: the sheet. It scrolls both ways inside itself, so the
            header row and the Date column stay put. */}
        <div className="hidden max-h-[calc(100vh-19rem)] min-h-[16rem] overflow-auto md:block">
          <table
            className="table-fixed border-separate border-spacing-0 text-[13px] text-slate-900"
            style={{ width: SHEET_WIDTH, fontFamily: "Arial, Helvetica, sans-serif" }}
          >
            <colgroup>
              {COLUMNS.map((c) => (
                <col key={c.key} style={{ width: c.width }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                {COLUMNS.map((c, i) => (
                  <th
                    key={c.key}
                    className={`sticky top-0 border-b-2 border-r border-b-slate-300 border-r-slate-200 bg-slate-100 px-2 py-2 text-left align-bottom text-[11px] font-bold uppercase leading-tight tracking-wide text-slate-600 ${
                      i === 0 ? "left-0 z-30 shadow-[1px_0_0_#cbd5e1]" : "z-20"
                    }`}
                  >
                    {c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((row, index) => (
                <SheetRow
                  key={row.id}
                  row={row}
                  striped={index % 2 === 1}
                  options={opts}
                  editing={editing?.id === row.id ? editing.key : null}
                  onEdit={(key) => setEditing({ id: row.id, key })}
                  onCancel={() => setEditing(null)}
                  onSave={(key, value) => saveCell(row, key, value)}
                  onImages={() => setImagesFor(row)}
                />
              ))}
            </tbody>
          </table>
        </div>

        {!loading && !shown.length && !error && (
          <div className="px-6 py-14 text-center">
            <FileSpreadsheet className="mx-auto mb-2 h-8 w-8 text-slate-300" />
            <p className="empty-title">Nothing on the sheet</p>
            <p className="empty-sub">
              {rows.length ? "No row matches the search or filters." : "No request matches these filters yet."}
            </p>
          </div>
        )}
        {loading && !rows.length && (
          <div className="flex justify-center py-12 text-slate-400">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        )}
      </div>

      <PrintSheet rows={shown} />

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
            showToast("Request added to the sheet", "success");
          }}
        />
      )}
    </div>
  );
};

const FilterSelect = ({ label, value, onChange, items }) => (
  <select
    value={value}
    onChange={onChange}
    className={`field field-sm w-full cursor-pointer md:w-auto md:max-w-[12rem] ${value ? "border-brand-400 bg-brand-50" : ""}`}
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

const SheetRow = ({ row, striped, options, editing, onEdit, onCancel, onSave, onImages }) => {
  const editable = row.editable || [];
  const urgent = row.priority === "Emergency" && OPEN(row);
  // The cells take the row's ground (bg-inherit), so the sticky Date cell is
  // solid and the hover tint covers the whole row.
  const ground = row.done ? "bg-[#B7E1CD]" : striped ? "bg-slate-50" : "bg-white";

  return (
    <tr className={`${ground} transition-colors hover:bg-blue-50 ${row.done ? "hover:bg-[#a6d8c0]" : ""}`}>
      {COLUMNS.map((col, i) => (
        <td
          key={col.key}
          className={`border-b border-r border-slate-200 bg-inherit p-0 align-top ${
            i === 0 ? `sticky left-0 z-10 shadow-[1px_0_0_#cbd5e1] ${urgent ? "border-l-4 border-l-rose-500" : ""}` : ""
          }`}
        >
          {col.kind === "images" ? (
            <button
              type="button"
              onClick={onImages}
              className="flex h-full min-h-[2rem] w-full cursor-pointer items-start gap-1 px-2 py-1.5 text-left text-slate-600 hover:bg-black/5"
              aria-label={`Images for ${row.description || row.id}`}
            >
              <Paperclip className="mt-px h-3.5 w-3.5 shrink-0" />
              <span className="text-[12px]">{row.files ? row.files : editable.length ? "Add" : "—"}</span>
            </button>
          ) : (
            <Cell
              row={row}
              col={col}
              items={col.from ? options[col.from] : null}
              canEdit={editable.includes(col.key)}
              isEditing={editing === col.key}
              onEdit={() => onEdit(col.key)}
              onCancel={onCancel}
              onSave={(value) => onSave(col.key, value)}
            />
          )}
        </td>
      ))}
    </tr>
  );
};

const COL = Object.fromEntries(COLUMNS.map((c) => [c.key, c]));

/**
 * One row on a phone. The same cells as the sheet - so a tap edits a cell the
 * same way - laid out top to bottom instead of across.
 */
const RowCard = ({ row, options, editing, onEdit, onCancel, onSave, onImages }) => {
  const [open, setOpen] = useState(false);
  const editable = row.editable || [];
  const urgent = row.priority === "Emergency" && OPEN(row);
  const cell = (key) => (
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
  );
  const labelled = (key, label = COL[key].header) => (
    <div className="min-w-0">
      <div className="px-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      {cell(key)}
    </div>
  );

  return (
    <div
      className={`px-2 py-3 ${urgent ? "border-l-4 border-l-rose-500" : ""}`}
      style={row.done ? { backgroundColor: DONE_GREEN } : undefined}
    >
      <div className="flex flex-wrap items-center gap-1.5 px-2 text-[12px] text-slate-600">
        <span className="font-semibold text-slate-800">{dmy(row.date)}</span>
        <span>·</span>
        <span className="truncate">{row.company}</span>
        <span className="ml-auto flex gap-1">
          <Chip value={row.type} />
          <Chip value={row.priority} />
        </span>
      </div>
      <div className="mt-1 text-[14px] font-semibold text-slate-900">{cell("description")}</div>
      <div className="px-2 text-[12px] text-slate-500">Raised by {row.raisedByName || "—"}</div>

      <div className="mt-2 grid grid-cols-2 gap-x-1 gap-y-1">
        {labelled("approvalStatus", "Approval")}
        {labelled("purchaseStatus", "Purchase / repair")}
        {labelled("expectedOn", "Expected")}
        {labelled("receivedOn", "Received")}
      </div>

      <div className="mt-1 flex items-center gap-2 px-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1 text-[12px] font-medium text-brand-700"
          aria-expanded={open}
        >
          <ChevronDown className={`h-3.5 w-3.5 transition ${open ? "rotate-180" : ""}`} />
          {open ? "Less" : "Purpose, links, remarks"}
        </button>
        <button type="button" onClick={onImages} className="ml-auto flex items-center gap-1 text-[12px] text-slate-600">
          <Paperclip className="h-3.5 w-3.5" />
          {row.files ? `${row.files} image${row.files === 1 ? "" : "s"}` : editable.length ? "Add image" : "No images"}
        </button>
      </div>
      {open && (
        <div className="mt-1 space-y-1">
          {labelled("purpose", "Purpose")}
          {labelled("links", "Links / brands / vendor")}
          {labelled("remarks")}
          {labelled("raisedByName", "Raised by")}
        </div>
      )}
    </div>
  );
};

const display = (row, col) => {
  const value = row[col.key];
  if (col.kind === "date") return dmy(value);
  if (col.kind === "pick") return <Chip value={value} />;
  if (col.key === "links") return <Linkified text={value || ""} />;
  return value;
};

const Cell = ({ row, col, items, canEdit, isEditing, onEdit, onCancel, onSave }) => {
  const wrap = "min-h-[2rem] px-2 py-1.5 whitespace-pre-wrap break-words leading-snug";

  if (!canEdit) return <div className={wrap}>{display(row, col)}</div>;

  if (!isEditing) {
    return (
      <button
        type="button"
        onClick={onEdit}
        className={`${wrap} block h-full w-full cursor-pointer text-left hover:bg-black/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500`}
      >
        {col.kind === "pick" ? <Chip value={row[col.key]} caret /> : display(row, col)}
      </button>
    );
  }

  return <CellEditor value={row[col.key]} col={col} items={items} onCancel={onCancel} onSave={onSave} />;
};

/** The cell while it is being changed: a dropdown, a date or a text box, outlined blue as Sheets does. */
const CellEditor = ({ value, col, items, onCancel, onSave }) => {
  const [draft, setDraft] = useState(value ?? "");
  // Escape cancels; without this the blur that follows would save anyway.
  const cancelled = useRef(false);
  const ring = "w-full rounded-none border-0 bg-white text-[13px] ring-2 ring-inset ring-blue-500 focus:outline-none";

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
        className={`${ring} h-8 cursor-pointer px-1.5`}
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
        className={`${ring} h-8 px-1.5`}
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
      className={`${ring} block resize-y px-2 py-1.5 leading-snug`}
      title="Enter saves, Shift+Enter for a new line, Esc cancels"
    />
  );
};

/** The images on one row: open them, and add or take away if the row is yours to change. */
const ImagesPanel = ({ row, onClose, onCount }) => {
  const { showToast } = useNotifications();
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
    if (!window.confirm(`Remove ${image.fileName}?`)) return;
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
            <p className="modal-sub">Adds a row to the Purchase Request Sheet.</p>
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
        Purchase Request Sheet
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
