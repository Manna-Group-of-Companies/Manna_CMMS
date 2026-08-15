import { Fragment, useEffect, useState } from "react";
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
} from "lucide-react";

const AdminIssueHistory = () => {
  const { showToast } = useNotifications();
  const [issues, setIssues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedProduct, setSelectedProduct] = useState(null);
  // The issue whose return trail is open, if any.
  const [expanded, setExpanded] = useState(null);

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

  const RETURN_STATUS = {
    Returned: { tone: "badge-emerald", label: "Returned" },
    "Partially Returned": { tone: "badge-amber", label: "Part returned" },
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
            {issues.length} total issues
          </span>
          <span className="badge badge-pill badge-rose badge-soft">
            {issues.reduce((sum, issue) => sum + outstandingOf(issue), 0)} pcs still out
          </span>
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="h-[40vh] flex items-center justify-center">
          <Loader2 className="h-7 w-7 text-brand-500 animate-spin" />
        </div>
      ) : issues.length === 0 ? (
        <div className="empty">
          <HelpCircle className="h-10 w-10 text-slate-300 mb-3" />
          <h3 className="empty-title">No products have been issued yet</h3>
          <p className="empty-sub">When a supervisor issues a product, it will appear here.</p>
        </div>
      ) : (
        <div className="table-card">
          <div className="table-scroll">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Issue #</th>
                  <th>Product</th>
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
                {issues.map((issue) => {
                  const returns = issue.returns || [];
                  const returnedQty = issue.returnedQuantity || 0;
                  const outstanding = outstandingOf(issue);
                  const isOpen = expanded === issue._id;
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
                          <td colSpan={9} className="py-4!">
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
