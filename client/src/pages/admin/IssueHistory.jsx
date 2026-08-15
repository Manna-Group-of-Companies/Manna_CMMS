import { Fragment, useEffect, useMemo, useState } from "react";
import API from "../../services/api";
import { useNotifications } from "../../context/NotificationContext";
import useAutoRefresh from "../../hooks/useAutoRefresh";
import {
  Loader2,
  Send,
  Calendar,
  User,
  HelpCircle,
  Boxes,
  X,
  ChevronDown,
  ChevronUp,
  Undo2,
  Warehouse,
  Download,
} from "lucide-react";

const AdminIssueHistory = () => {
  const { showToast } = useNotifications();
  const [issues, setIssues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedProduct, setSelectedProduct] = useState(null);
  // The issue whose return trail is open, if any.
  const [expanded, setExpanded] = useState(null);

  // Filters. Applied here rather than on the API: the page already holds every
  // issue for the auto-refresh, so narrowing is instant and needs no round trip.
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [supervisorId, setSupervisorId] = useState("");

  /** [silent] is used by the background poll: no spinner, no error toast. */
  const fetchIssues = async ({ silent = false } = {}) => {
    try {
      if (!silent) setLoading(true);
      const { data } = await API.get("/issues");
      setIssues(data);
    } catch (error) {
      console.error("Error loading issue history:", error);
      if (!silent) showToast("Failed to load issue history", "error");
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    fetchIssues();
  }, []);

  // Supervisors issue and return stock from the app.
  useAutoRefresh(() => fetchIssues({ silent: true }));

  const formatDate = (dateString) => {
    const d = new Date(dateString);
    return (
      d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" }) +
      " " +
      d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    );
  };

  /** How much of an issue is still out with the recipient. */
  const outstandingOf = (issue) => issue.quantity - (issue.returnedQuantity || 0);

  /**
   * Only the supervisors who actually appear in the history, so the dropdown
   * can never offer a name that would return nothing.
   */
  const supervisors = useMemo(() => {
    const seen = new Map();
    for (const issue of issues) {
      const person = issue.supervisor;
      if (person?._id && !seen.has(person._id)) seen.set(person._id, person.name || "Unnamed");
    }
    return [...seen.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [issues]);

  const filteredIssues = useMemo(() => {
    // The date inputs give a calendar day; an issue at 17:40 has to fall inside
    // its own "to" day, so the end of the range is the last millisecond of it.
    const from = fromDate ? new Date(`${fromDate}T00:00:00`) : null;
    const to = toDate ? new Date(`${toDate}T23:59:59.999`) : null;

    return issues.filter((issue) => {
      const issuedOn = new Date(issue.createdAt);
      if (from && issuedOn < from) return false;
      if (to && issuedOn > to) return false;
      if (supervisorId && issue.supervisor?._id !== supervisorId) return false;
      return true;
    });
  }, [issues, fromDate, toDate, supervisorId]);

  const filtersApplied = Boolean(fromDate || toDate || supervisorId);

  const clearFilters = () => {
    setFromDate("");
    setToDate("");
    setSupervisorId("");
  };

  /** A cell Excel will read back as one value, whatever it contains. */
  const csvCell = (value) => {
    const text = value === null || value === undefined ? "" : String(value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  /** `2026-08-15 14:32` — sorts correctly and Excel reads it as a date-time. */
  const sheetDate = (value) => {
    if (!value) return "";
    const d = new Date(value);
    const pad = (n) => String(n).padStart(2, "0");
    return (
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
      `${pad(d.getHours())}:${pad(d.getMinutes())}`
    );
  };

  /**
   * Downloads exactly what the filters have left on screen.
   *
   * Written as CSV rather than a real .xlsx so the page carries no spreadsheet
   * library; Excel opens it directly. The leading BOM is what makes Excel read
   * it as UTF-8 — without it, a product name with a degree sign or a rupee
   * symbol arrives mangled.
   */
  const exportToExcel = () => {
    if (filteredIssues.length === 0) {
      showToast("Nothing to export — no issues match these filters", "error");
      return;
    }

    const columns = [
      ["Issue #", (i) => i.issueNumber],
      ["Product Code", (i) => i.product?.code || ""],
      ["Product", (i) => i.product?.name || "Deleted Product"],
      ["From Room", (i) => roomsOf(i).join(", ")],
      ["Issued Qty", (i) => i.quantity],
      ["Unit", (i) => i.product?.unit || ""],
      ["Returned Qty", (i) => i.returnedQuantity || 0],
      ["Still Out", (i) => outstandingOf(i)],
      ["Recipient", (i) => i.recipient],
      ["Purpose", (i) => i.purpose || ""],
      ["Issued By", (i) => i.supervisor?.name || "System"],
      ["Issued On", (i) => sheetDate(i.createdAt)],
      ["Return Status", (i) => (RETURN_STATUS[i.returnStatus] || { label: "Not returned" }).label],
      ["Last Returned By", (i) => i.returns?.[i.returns.length - 1]?.returnedBy?.name || ""],
      ["Last Returned On", (i) => sheetDate(i.returns?.[i.returns.length - 1]?.returnDate)],
    ];

    const rows = [
      columns.map(([heading]) => heading),
      ...filteredIssues.map((issue) => columns.map(([, read]) => read(issue))),
    ];

    // The BOM is written as an escape rather than a literal byte order mark,
    // which is invisible in an editor and easily lost to a reformat. CRLF
    // because Excel on Windows treats a lone LF inside a quoted field as the
    // end of the record.
    const csv = "\uFEFF" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n");

    // Named for the range it covers, so two exports never overwrite each other
    // in the downloads folder.
    const span = [fromDate || "start", toDate || sheetDate(Date.now()).slice(0, 10)].join("_to_");
    const who = supervisorId
      ? `_${(supervisors.find((s) => s.id === supervisorId)?.name || "").replace(/\s+/g, "-")}`
      : "";

    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    link.download = `issue-history_${span}${who}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);

    showToast(`Exported ${filteredIssues.length} issue(s)`, "success");
  };

  const RETURN_STATUS = {
    Returned: { tone: "badge-emerald", label: "Returned" },
    "Partially Returned": { tone: "badge-amber", label: "Part returned" },
  };

  // Rooms are admin-configurable, so only the two an install ships with get
  // their own colour; anything added later falls back to slate.
  const ROOM_TONE = {
    "Engineer Room": "badge-indigo",
    "Consumables Room": "badge-cyan",
  };

  /**
   * Which room(s) the stock actually left. A single issue can be drawn across
   * rooms when the home room runs short, in which case `sourceRoom` holds them
   * comma-separated. Older rows pre-date the field, so the product's home room
   * stands in — it is where the stock would have come from.
   */
  const roomsOf = (issue) => {
    const rooms = (issue.sourceRoom || issue.product?.storeRoom || "")
      .split(",")
      .map((room) => room.trim())
      .filter(Boolean);
    return [...new Set(rooms)];
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="panel">
        <div className="flex items-center gap-3 min-w-0">
          <span className="panel-icon bg-amber-50 border-amber-500/15 text-amber-600">
            <Send className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h3 className="panel-title">Issue History — All Supervisors</h3>
            <p className="panel-sub">
              Every product issued out of a store room, and what has come back
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
          <span className="badge badge-pill badge-amber badge-soft">
            {filteredIssues.length}
            {filtersApplied ? ` of ${issues.length}` : ""} issues
          </span>
          <span className="badge badge-pill badge-rose badge-soft">
            {filteredIssues.reduce((sum, issue) => sum + outstandingOf(issue), 0)} pcs still out
          </span>
        </div>
      </div>

      {/* Filters and export */}
      <div className="panel">
        <div className="flex-1 w-full flex flex-col sm:flex-row sm:items-end gap-2.5 min-w-0">
          <div>
            <label className="field-label" htmlFor="issued-from">
              Issued from
            </label>
            <input
              id="issued-from"
              type="date"
              value={fromDate}
              // Keeps the range the right way round rather than silently
              // returning nothing.
              max={toDate || undefined}
              onChange={(e) => setFromDate(e.target.value)}
              className="field field-sm w-full sm:w-auto cursor-pointer"
            />
          </div>
          <div>
            <label className="field-label" htmlFor="issued-to">
              Issued to
            </label>
            <input
              id="issued-to"
              type="date"
              value={toDate}
              min={fromDate || undefined}
              onChange={(e) => setToDate(e.target.value)}
              className="field field-sm w-full sm:w-auto cursor-pointer"
            />
          </div>
          <div className="min-w-0">
            <label className="field-label" htmlFor="issued-by">
              Supervisor
            </label>
            <select
              id="issued-by"
              value={supervisorId}
              onChange={(e) => setSupervisorId(e.target.value)}
              className="field field-sm w-full sm:w-auto cursor-pointer"
            >
              <option value="">All supervisors</option>
              {supervisors.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </select>
          </div>
          {filtersApplied && (
            <button type="button" onClick={clearFilters} className="btn btn-neutral">
              <X className="h-4 w-4" />
              Clear
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={exportToExcel}
          disabled={filteredIssues.length === 0}
          className="btn btn-primary w-full sm:w-auto self-end disabled:opacity-50 disabled:cursor-not-allowed"
          title="Download these issues as a spreadsheet"
        >
          <Download className="h-4 w-4" />
          Export to Excel
        </button>
      </div>

      {/* Table */}
      {loading ? (
        <div className="h-[40vh] flex items-center justify-center">
          <Loader2 className="h-7 w-7 text-brand-500 animate-spin" />
        </div>
      ) : filteredIssues.length === 0 ? (
        <div className="empty">
          <HelpCircle className="h-10 w-10 text-slate-300 mb-3" />
          <h3 className="empty-title">
            {filtersApplied ? "No issues match these filters" : "No products have been issued yet"}
          </h3>
          <p className="empty-sub">
            {filtersApplied
              ? "Try a wider date range, or a different supervisor."
              : "When a supervisor issues a product, it will appear here."}
          </p>
        </div>
      ) : (
        <div className="table-card">
          <div className="table-scroll">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Issue #</th>
                  <th>Product</th>
                  <th>From Room</th>
                  <th className="text-center">Issued</th>
                  <th className="text-center">Returned</th>
                  <th>Recipient</th>
                  <th>Issued By</th>
                  <th>Issued On</th>
                  <th className="text-center">Status</th>
                  <th className="text-right">Returns</th>
                </tr>
              </thead>
              <tbody>
                {filteredIssues.map((issue) => {
                  const returns = issue.returns || [];
                  const returnedQty = issue.returnedQuantity || 0;
                  const outstanding = outstandingOf(issue);
                  const isOpen = expanded === issue._id;
                  const rooms = roomsOf(issue);
                  const status = RETURN_STATUS[issue.returnStatus] || {
                    tone: "badge-rose",
                    label: "Not returned",
                  };
                  // The most recent hand-back, for the at-a-glance "who and when".
                  const latest = returns[returns.length - 1];

                  return (
                    <Fragment key={issue._id}>
                      <tr className={isOpen ? "bg-slate-50" : undefined}>
                        <td className="mono font-semibold text-amber-600">
                          {issue.issueNumber}
                        </td>
                        <td>
                          <button
                            type="button"
                            className="flex items-center gap-3 min-w-[190px] text-left rounded-lg -mx-1.5 px-1.5 py-1 transition-colors hover:bg-slate-100 cursor-pointer disabled:cursor-default disabled:hover:bg-transparent"
                            onClick={() => issue.product && setSelectedProduct(issue.product)}
                            disabled={!issue.product}
                            title={issue.product ? "View product specifications" : undefined}
                          >
                            <img
                              src={
                                issue.product?.image ||
                                "https://images.unsplash.com/photo-1595246140707-1e5b22b271d4?w=50&auto=format"
                              }
                              alt=""
                              className="w-9 h-9 shrink-0 rounded-lg object-cover border border-slate-200"
                            />
                            <span className="min-w-0">
                              <span className="cell-title block truncate">
                                {issue.product?.name || "Deleted Product"}
                              </span>
                              <span className="mono block text-brand-700">
                                {issue.product?.code || "—"}
                              </span>
                            </span>
                          </button>
                        </td>
                        {/* Where the stock was drawn from — usually one room,
                            but a short home room spills into the next. */}
                        <td>
                          <div className="flex flex-wrap items-center gap-1 min-w-[120px]">
                            {rooms.length === 0 ? (
                              <span className="text-slate-400">—</span>
                            ) : (
                              rooms.map((room) => (
                                <span
                                  key={room}
                                  className={`badge badge-soft ${ROOM_TONE[room] || "badge-slate"}`}
                                >
                                  {room}
                                </span>
                              ))
                            )}
                          </div>
                        </td>
                        <td className="text-center">
                          <span className="badge badge-amber">
                            −{issue.quantity} {issue.product?.unit || ""}
                          </span>
                        </td>
                        {/* How much has come back, and how much is still out. */}
                        <td className="text-center whitespace-nowrap">
                          {returnedQty > 0 ? (
                            <>
                              <span className="badge badge-emerald">
                                +{returnedQty} {issue.product?.unit || ""}
                              </span>
                              {outstanding > 0 && (
                                <span className="mt-1 block text-[11px] text-amber-600">
                                  {outstanding} still out
                                </span>
                              )}
                            </>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="cell-title">{issue.recipient}</td>
                        <td>
                          <div className="flex items-center gap-2.5 min-w-[150px]">
                            <div className="h-8 w-8 shrink-0 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 border border-slate-200">
                              <User className="h-4 w-4" />
                            </div>
                            <div className="min-w-0">
                              <div className="font-semibold text-slate-800 truncate">
                                {issue.supervisor?.name || "System"}
                              </div>
                              <div className="text-[11px] text-slate-500 truncate">
                                {issue.supervisor?.email || issue.supervisor?.role || ""}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="text-slate-500 whitespace-nowrap">
                          <span className="inline-flex items-center gap-1.5">
                            <Calendar className="h-3.5 w-3.5 opacity-60" />
                            {formatDate(issue.createdAt)}
                          </span>
                        </td>
                        <td className="text-center">
                          <span className={`badge ${status.tone}`}>{status.label}</span>
                        </td>
                        {/* Who handed the last batch back and when; the full
                            trail is one click away. */}
                        <td>
                          <div className="flex items-center justify-end gap-2 min-w-[170px]">
                            {latest ? (
                              <div className="text-right min-w-0">
                                <div className="font-semibold text-slate-800 truncate">
                                  {latest.returnedBy?.name || "Unknown"}
                                </div>
                                <div className="text-[11px] text-slate-500 whitespace-nowrap">
                                  {formatDate(latest.returnDate)}
                                </div>
                              </div>
                            ) : (
                              <span className="text-[11px] text-slate-400">
                                Nothing returned
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={() => setExpanded(isOpen ? null : issue._id)}
                              className="icon-btn"
                              title={isOpen ? "Hide details" : "Show returns and purpose"}
                              aria-expanded={isOpen}
                            >
                              {isOpen ? (
                                <ChevronUp className="h-4 w-4" />
                              ) : (
                                <ChevronDown className="h-4 w-4" />
                              )}
                            </button>
                          </div>
                        </td>
                      </tr>

                      {/* Return trail — one line per hand-back, oldest first. */}
                      {isOpen && (
                        <tr className="bg-slate-50">
                          {/* `!` beats the `.tbl td` padding, which is more
                              specific than a bare utility. */}
                          <td colSpan={10} className="py-4!">
                            <div className="space-y-3">
                              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                                <h5 className="eyebrow">
                                  Returns against {issue.issueNumber}
                                </h5>
                                {issue.purpose && (
                                  <span className="text-[12px] text-slate-500 italic">
                                    Issued for: {issue.purpose}
                                  </span>
                                )}
                              </div>

                              <div className="rounded-xl border border-slate-200 bg-white divide-y divide-slate-100">
                                {returns.length === 0 && (
                                  <div className="px-4 py-5 text-[13px] text-slate-500">
                                    Nothing has come back from this issue yet — all{" "}
                                    {issue.quantity} {issue.product?.unit || ""} are still with{" "}
                                    <strong className="text-slate-700">{issue.recipient}</strong>.
                                  </div>
                                )}
                                {returns.map((entry) => (
                                  <div
                                    key={entry._id}
                                    className="px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-2"
                                  >
                                    <span className="badge badge-emerald">
                                      +{entry.quantity} {issue.product?.unit || ""}
                                    </span>

                                    <span className="inline-flex items-center gap-1.5 text-[13px]">
                                      <Undo2 className="h-3.5 w-3.5 text-slate-400" />
                                      returned by
                                      <strong className="text-slate-900">
                                        {entry.returnedBy?.name || "Unknown"}
                                      </strong>
                                    </span>

                                    <span className="inline-flex items-center gap-1.5 text-[12px] text-slate-500 whitespace-nowrap">
                                      <Calendar className="h-3.5 w-3.5 opacity-60" />
                                      {formatDate(entry.returnDate)}
                                    </span>

                                    <span className="badge badge-slate badge-soft">
                                      {entry.condition}
                                    </span>

                                    {entry.department && (
                                      <span className="text-[12px] text-slate-500">
                                        from {entry.department}
                                      </span>
                                    )}

                                    <span className="mono text-slate-400">
                                      {entry.restockNumber}
                                    </span>

                                    {/* Returned stock waits in Red Stock until a
                                        merge is approved — say where it got to. */}
                                    <span className="ml-auto inline-flex items-center gap-1.5 text-[12px] text-slate-500 whitespace-nowrap">
                                      <Warehouse className="h-3.5 w-3.5 opacity-60" />
                                      {entry.status === "Moved to Stock Room" &&
                                      entry.destinationRoom
                                        ? `Moved to ${entry.destinationRoom}`
                                        : entry.status}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Product Details Modal */}
      {selectedProduct && (
        <div className="modal-backdrop">
          <div className="modal max-w-lg">
            <div className="modal-head">
              <h3 className="modal-title">
                <Boxes className="h-[18px] w-[18px] text-brand-700" />
                Product Specifications
              </h3>
              <button
                onClick={() => setSelectedProduct(null)}
                className="modal-close"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="modal-body space-y-5">
              <div className="flex gap-4">
                <img
                  src={selectedProduct.image || "https://images.unsplash.com/photo-1595246140707-1e5b22b271d4?w=100&auto=format"}
                  alt=""
                  className="w-20 h-20 shrink-0 rounded-xl object-cover border border-slate-200"
                />
                <div className="min-w-0">
                  <h4 className="text-base font-semibold text-slate-900 leading-tight">
                    {selectedProduct.name}
                  </h4>
                  <span className="mono text-brand-700 mt-1 block">
                    CODE: {selectedProduct.code}
                  </span>
                  <span className="badge badge-slate badge-soft mt-2">
                    {selectedProduct.storeRoom}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="kv">
                  <span className="kv-label">Category</span>
                  <span className="kv-value">{selectedProduct.category}</span>
                </div>
                <div className="kv">
                  <span className="kv-label">Rack Number</span>
                  <span className="kv-value">{selectedProduct.rackNumber || "—"}</span>
                </div>
                <div className="kv">
                  <span className="kv-label">Current Stock</span>
                  <span className="kv-value">
                    {selectedProduct.quantity} {selectedProduct.unit}
                  </span>
                </div>
                <div className="kv">
                  <span className="kv-label">Min Stock Limit</span>
                  <span className="kv-value">
                    {selectedProduct.minStock} {selectedProduct.unit}
                  </span>
                </div>
                <div className="kv col-span-2">
                  <span className="kv-label">Max Stock Limit</span>
                  <span className="kv-value">
                    {selectedProduct.maxStock} {selectedProduct.unit}
                  </span>
                </div>
              </div>

              <div className="kv">
                <span className="kv-label">Description</span>
                <p className="text-[13px] text-slate-700 leading-relaxed">
                  {selectedProduct.description || "No description provided."}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminIssueHistory;
