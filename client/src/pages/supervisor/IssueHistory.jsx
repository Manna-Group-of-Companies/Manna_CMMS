import { useEffect, useState } from "react";
import API from "../../services/api";
import { useNotifications } from "../../context/NotificationContext";
import useAutoRefresh from "../../hooks/useAutoRefresh";
import {
  Loader2,
  Send,
  Calendar,
  HelpCircle,
  Boxes,
  X,
  RotateCcw,
  PackageOpen,
  UserRound,
  Flame,
  Trash2,
} from "lucide-react";
import {
  formatCurrency,
  outstandingOf,
  settlementOf,
  TONE_CLASSES,
} from "../../utils/currency";

const RETURN_CONDITIONS = ["Good", "Damaged", "Repairable", "Expired"];

/**
 * What the store has issued and not yet had back, by any supervisor — what
 * went out, to whom, why and when. Returning one is open to any supervisor:
 * `isMine` only labels the row, and the return is booked against whoever is
 * signed in. The server drops fully returned issues from this list, so a row
 * disappearing after a return is the expected outcome, not a lost record —
 * the Admin's own Issue History keeps every one of them.
 */
const SupervisorIssueHistory = () => {
  const { showToast } = useNotifications();
  const [issues, setIssues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [scope, setScope] = useState("All"); // All | Mine

  // Return flow. The stock is in the Red Stock Room the moment this succeeds —
  // no approval — so the form only collects what the weekly merge will need.
  const [returnIssue, setReturnIssue] = useState(null);
  const [returnForm, setReturnForm] = useState({
    quantity: 1,
    condition: "Good",
    department: "",
  });
  const [submitting, setSubmitting] = useState(false);

  // Consume / scrap flow. Neither restores stock: the quantity left the store
  // room when it was issued, so this only closes it out against the issue.
  // `disposal` holds both the issue and which of the two is being recorded.
  const [disposal, setDisposal] = useState(null);
  const [disposalForm, setDisposalForm] = useState({ quantity: 1, reason: "" });

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

  // Paused while either form is open so the outstanding quantity the form was
  // built from cannot change underneath it.
  useAutoRefresh(() => fetchIssues({ silent: true }), {
    enabled: !returnIssue && !disposal,
  });

  const openReturnModal = (issue) => {
    setReturnIssue(issue);
    setReturnForm({
      quantity: outstandingOf(issue),
      condition: "Good",
      department: issue.recipient || "",
    });
  };

  const handleReturnSubmit = async (e) => {
    e.preventDefault();

    const outstanding = outstandingOf(returnIssue);
    const quantity = Number(returnForm.quantity);

    if (!Number.isInteger(quantity) || quantity < 1) {
      showToast("Return quantity must be a whole number of at least 1", "error");
      return;
    }
    if (quantity > outstanding) {
      showToast(`Only ${outstanding} still outstanding on this issue`, "error");
      return;
    }

    try {
      setSubmitting(true);
      const { data } = await API.post("/red-stock/returns", {
        issueId: returnIssue._id,
        quantity,
        condition: returnForm.condition,
        department: returnForm.department.trim(),
      });
      showToast(data.message || "Stock returned to the Red Stock Room", "success");
      setReturnIssue(null);
      fetchIssues();
    } catch (error) {
      console.error("Error returning stock:", error);
      showToast(error.response?.data?.message || "Failed to return stock", "error");
    } finally {
      setSubmitting(false);
    }
  };

  const openDisposalModal = (issue, type) => {
    setDisposal({ issue, type });
    setDisposalForm({ quantity: outstandingOf(issue), reason: "" });
  };

  const handleDisposalSubmit = async (e) => {
    e.preventDefault();

    const { issue, type } = disposal;
    const outstanding = outstandingOf(issue);
    const quantity = Number(disposalForm.quantity);
    const isScrap = type === "Scrapped";

    if (!Number.isInteger(quantity) || quantity < 1) {
      showToast("Quantity must be a whole number of at least 1", "error");
      return;
    }
    if (quantity > outstanding) {
      showToast(`Only ${outstanding} still outstanding on this issue`, "error");
      return;
    }
    // A write-off should say why; routine consumption need not.
    if (isScrap && !disposalForm.reason.trim()) {
      showToast("Give a reason for scrapping this item", "error");
      return;
    }

    try {
      setSubmitting(true);
      const { data } = await API.post("/disposals", {
        type,
        issueId: issue._id,
        quantity,
        reason: disposalForm.reason.trim(),
      });
      showToast(data.message || `Recorded as ${type.toLowerCase()}`, "success");
      setDisposal(null);
      fetchIssues();
    } catch (error) {
      console.error("Error recording disposal:", error);
      showToast(
        error.response?.data?.message || "Failed to record the entry",
        "error"
      );
    } finally {
      setSubmitting(false);
    }
  };

  const formatDate = (dateString) => {
    const d = new Date(dateString);
    return (
      d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" }) +
      " " +
      d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    );
  };

  const visibleIssues = scope === "Mine" ? issues.filter((issue) => issue.isMine) : issues;
  const myIssueCount = issues.filter((issue) => issue.isMine).length;
  const totalIssuedQuantity = visibleIssues.reduce((sum, issue) => sum + issue.quantity, 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-2xl glass-premium border border-slate-200">
        <div className="flex items-center gap-2">
          <Send className="h-5 w-5 text-amber-600" />
          <div>
            <h3 className="text-lg font-bold text-slate-900">Issue History</h3>
            <p className="text-xs text-slate-500">
              Still out with a recipient — {myIssueCount} of {issues.length} issued by you
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <span className="px-3 py-1 rounded-full bg-amber-500/10 text-amber-600 border border-amber-500/20 text-xs font-bold">
            {visibleIssues.length} Outstanding • {totalIssuedQuantity} pcs
          </span>

          <div className="flex bg-slate-100 p-1.5 rounded-xl border border-slate-200">
            {["All", "Mine"].map((tab) => (
              <button
                key={tab}
                onClick={() => setScope(tab)}
                className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                  scope === tab
                    ? "bg-brand-600 text-white shadow"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                {tab === "All" ? "All Supervisors" : "Issued by Me"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="h-[40vh] flex items-center justify-center">
          <Loader2 className="h-7 w-7 text-brand-500 animate-spin" />
        </div>
      ) : visibleIssues.length === 0 ? (
        <div className="glass-premium p-12 text-center rounded-2xl border border-slate-200 flex flex-col items-center justify-center">
          <HelpCircle className="h-10 w-10 text-slate-400 mb-3" />
          <h3 className="text-base font-bold text-slate-900 mb-1">
            {scope === "Mine"
              ? "Nothing you issued is still out"
              : "Nothing is still out with a recipient"}
          </h3>
          <p className="text-xs text-slate-500">
            Fully returned issues drop off this list. Use the "Issue Product" button on
            the Products catalog to issue items.
          </p>
        </div>
      ) : (
        <div className="glass-premium rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-medium text-xs uppercase tracking-wider">
                  <th className="py-4 px-6">Issue #</th>
                  <th className="py-4 px-6">Product</th>
                  <th className="py-4 px-6 text-center">Qty Issued</th>
                  <th className="py-4 px-6">Issued By</th>
                  <th className="py-4 px-6">Recipient</th>
                  <th className="py-4 px-6">Purpose</th>
                  <th className="py-4 px-6">Date & Time</th>
                  <th className="py-4 px-6 text-center">Return Status</th>
                  <th className="py-4 px-6 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-slate-700">
                {visibleIssues.map((issue) => {
                  const outstanding = outstandingOf(issue);
                  const settlement = settlementOf(issue);
                  const scrapValue = (issue.disposals || [])
                    .filter((d) => d.type === "Scrapped")
                    .reduce((sum, d) => sum + (d.value || 0), 0);
                  return (
                    <tr key={issue._id} className="hover:bg-slate-50 transition-colors">
                      <td className="py-4 px-6 font-mono text-xs text-amber-600 font-bold">
                        {issue.issueNumber}
                      </td>
                      <td className="py-4 px-6">
                        <div
                          className="flex items-center gap-3 cursor-pointer hover:bg-slate-100 p-2 rounded-lg transition-colors -ml-2"
                          onClick={() => issue.product && setSelectedProduct(issue.product)}
                        >
                          <img
                            src={
                              issue.product?.image ||
                              "https://images.unsplash.com/photo-1595246140707-1e5b22b271d4?w=50&auto=format"
                            }
                            alt={issue.product?.name}
                            className="w-9 h-9 rounded-lg object-cover border border-slate-200"
                          />
                          <div>
                            <div className="font-bold text-slate-900 group-hover:text-brand-700 transition-colors">
                              {issue.product?.name || "Deleted Product"}
                            </div>
                            <div className="text-[10px] font-mono text-brand-700">
                              {issue.product?.code || "—"} • {issue.product?.storeRoom || ""}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="py-4 px-6 text-center">
                        <span className="bg-amber-500/10 text-amber-600 border border-amber-500/20 px-2.5 py-0.5 rounded text-xs font-bold">
                          −{issue.quantity} {issue.product?.unit || ""}
                        </span>
                      </td>
                      <td className="py-4 px-6">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold ${
                            issue.isMine
                              ? "bg-brand-500/10 text-brand-700 border border-brand-500/20"
                              : "bg-slate-100 text-slate-700 border border-slate-200"
                          }`}
                        >
                          <UserRound className="h-3.5 w-3.5 opacity-70" />
                          {issue.supervisor?.name || "Unknown"}
                          {issue.isMine && <span className="text-[10px] opacity-70">(you)</span>}
                        </span>
                      </td>
                      <td className="py-4 px-6 font-semibold text-slate-900">{issue.recipient}</td>
                      <td className="py-4 px-6 text-xs text-slate-600 italic max-w-[200px] truncate">
                        {issue.purpose || "—"}
                      </td>
                      <td className="py-4 px-6 text-xs text-slate-600 flex items-center gap-1.5">
                        <Calendar className="h-3.5 w-3.5 opacity-65" />
                        {formatDate(issue.createdAt)}
                      </td>
                      <td className="py-4 px-6 text-center">
                        <span
                          className={`px-2 py-1 rounded-md text-xs font-semibold ${
                            TONE_CLASSES[settlement.tone]
                          }`}
                        >
                          {settlement.label}
                        </span>
                        {/* Spell out how it settled whenever more than nothing
                            has been closed out — three routes are in play, so
                            "Part Settled" on its own says too little. */}
                        <span className="block mt-1 text-[10px] text-slate-500 leading-relaxed">
                          {(issue.returnedQuantity || 0) > 0 &&
                            `${issue.returnedQuantity} returned `}
                          {(issue.consumedQuantity || 0) > 0 &&
                            `${issue.consumedQuantity} used `}
                          {(issue.scrappedQuantity || 0) > 0 &&
                            `${issue.scrappedQuantity} scrapped `}
                          {outstanding > 0 &&
                            outstanding < issue.quantity &&
                            `• ${outstanding} still out`}
                        </span>
                        {scrapValue > 0 && (
                          <span className="block mt-0.5 text-[10px] font-semibold text-rose-600">
                            {formatCurrency(scrapValue)} written off
                          </span>
                        )}
                      </td>
                      <td className="py-4 px-6 text-center">
                        {/* Any supervisor may action any issue — whoever the
                            recipient hands the stock back to books it in. The
                            three buttons are the three ways it can settle. */}
                        {outstanding > 0 && (
                          <div className="flex items-center justify-center gap-0.5">
                            <button
                              onClick={() => openReturnModal(issue)}
                              className="p-1.5 hover:bg-slate-100 rounded-lg text-rose-600 hover:text-rose-700 transition-all cursor-pointer"
                              title={`Return to Red Stock (${outstanding} outstanding)`}
                            >
                              <RotateCcw className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => openDisposalModal(issue, "Consumed")}
                              className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-600 hover:text-slate-900 transition-all cursor-pointer"
                              title={`Mark consumed (${outstanding} outstanding)`}
                            >
                              <Flame className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => openDisposalModal(issue, "Scrapped")}
                              className="p-1.5 hover:bg-slate-100 rounded-lg text-rose-700 hover:text-rose-800 transition-all cursor-pointer"
                              title={`Scrap (${outstanding} outstanding)`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Return to Red Stock Modal */}
      {returnIssue && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
          <div className="glass-premium w-full max-w-md rounded-2xl border border-slate-200 max-h-[90vh] overflow-y-auto shadow-2xl animate-fade-in text-left">
            <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-center">
              <div>
                <h3 className="font-bold text-lg text-slate-900 flex items-center gap-2">
                  <PackageOpen className="h-5 w-5 text-rose-600" />
                  Return to Red Stock
                </h3>
                <p className="text-xs text-slate-600 mt-0.5">{returnIssue.issueNumber}</p>
              </div>
              <button
                onClick={() => setReturnIssue(null)}
                className="p-1 rounded-lg hover:bg-slate-100 text-slate-600 hover:text-slate-900 cursor-pointer transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleReturnSubmit} className="p-6 space-y-4">
              {/* Product summary */}
              <div className="flex gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200">
                <img
                  src={
                    returnIssue.product?.image ||
                    "https://images.unsplash.com/photo-1595246140707-1e5b22b271d4?w=80&auto=format"
                  }
                  alt={returnIssue.product?.name}
                  className="w-14 h-14 rounded-lg object-cover border border-slate-200"
                />
                <div className="text-xs">
                  <h4 className="text-sm font-bold text-slate-900">
                    {returnIssue.product?.name || "Deleted Product"}
                  </h4>
                  <span className="font-mono text-brand-700 block mt-0.5">
                    {returnIssue.product?.code || "—"}
                  </span>
                  <span className="text-slate-600 block mt-0.5">
                    Issued from <strong>{returnIssue.sourceRoom || returnIssue.product?.storeRoom || "a store room"}</strong>
                  </span>
                </div>
              </div>

              <div className="p-3 rounded-xl bg-rose-50 border border-rose-500/20 text-[11px] text-rose-900 leading-relaxed">
                This goes straight into the <strong>Red Stock Room</strong> — no approval needed.
                It stays there until the Admin approves the weekly merge into a store room.
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                  Quantity to Return * <span className="font-normal text-slate-500">
                    ({outstandingOf(returnIssue)} outstanding)
                  </span>
                </label>
                <input
                  type="number"
                  min="1"
                  max={outstandingOf(returnIssue)}
                  value={returnForm.quantity}
                  onChange={(e) => setReturnForm({ ...returnForm, quantity: e.target.value })}
                  required
                  className="w-full px-4 py-2.5 text-sm rounded-xl bg-white border border-slate-200 text-slate-900 focus:outline-none focus:border-brand-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                  Condition *
                </label>
                <select
                  value={returnForm.condition}
                  onChange={(e) => setReturnForm({ ...returnForm, condition: e.target.value })}
                  className="w-full px-4 py-2.5 text-sm rounded-xl bg-white border border-slate-200 text-slate-900 focus:outline-none focus:border-brand-500 cursor-pointer"
                >
                  {RETURN_CONDITIONS.map((condition) => (
                    <option key={condition} value={condition}>
                      {condition}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                  Returning Department *
                </label>
                <input
                  type="text"
                  value={returnForm.department}
                  onChange={(e) => setReturnForm({ ...returnForm, department: e.target.value })}
                  required
                  placeholder="e.g. Maintenance"
                  className="w-full px-4 py-2.5 text-sm rounded-xl bg-white border border-slate-200 text-slate-900 placeholder-slate-400 focus:outline-none focus:border-brand-500"
                />
              </div>

              <div className="pt-4 border-t border-slate-200 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setReturnIssue(null)}
                  className="px-4 py-2 text-xs font-semibold rounded-xl bg-white border border-slate-200 text-slate-600 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 text-xs font-semibold rounded-xl bg-rose-600 hover:bg-rose-500 text-white disabled:opacity-50 cursor-pointer active:scale-98 transition-all flex items-center gap-2"
                >
                  {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Send to Red Stock
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Consume / Scrap Modal.
          One form for both: the operation is identical — close a quantity out
          against an issue, with a reason — and only the wording, the colour
          and the value line differ. */}
      {disposal && (() => {
        const { issue, type } = disposal;
        const isScrap = type === "Scrapped";
        const outstanding = outstandingOf(issue);
        const unitCost = issue.product?.unitCost || 0;
        const previewValue = unitCost * (Number(disposalForm.quantity) || 0);
        const accent = isScrap ? "rose" : "slate";

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
            <div className="glass-premium w-full max-w-md rounded-2xl border border-slate-200 max-h-[90vh] overflow-y-auto shadow-2xl animate-fade-in text-left">
              <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-center">
                <div>
                  <h3 className="font-bold text-lg text-slate-900 flex items-center gap-2">
                    {isScrap ? (
                      <Trash2 className="h-5 w-5 text-rose-600" />
                    ) : (
                      <Flame className="h-5 w-5 text-slate-600" />
                    )}
                    {isScrap ? "Scrap Item" : "Mark as Consumed"}
                  </h3>
                  <p className="text-xs text-slate-600 mt-0.5">{issue.issueNumber}</p>
                </div>
                <button
                  onClick={() => setDisposal(null)}
                  className="p-1 rounded-lg hover:bg-slate-100 text-slate-600 hover:text-slate-900 cursor-pointer transition-colors"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <form onSubmit={handleDisposalSubmit} className="p-6 space-y-4">
                <div className="flex gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200">
                  <img
                    src={
                      issue.product?.image ||
                      "https://images.unsplash.com/photo-1595246140707-1e5b22b271d4?w=80&auto=format"
                    }
                    alt={issue.product?.name}
                    className="w-14 h-14 rounded-lg object-cover border border-slate-200"
                  />
                  <div className="text-xs">
                    <h4 className="text-sm font-bold text-slate-900">
                      {issue.product?.name || "Deleted Product"}
                    </h4>
                    <span className="font-mono text-brand-700 block mt-0.5">
                      {issue.product?.code || "—"}
                    </span>
                    <span className="text-slate-600 block mt-0.5">
                      Issued to <strong>{issue.recipient}</strong>
                    </span>
                  </div>
                </div>

                <div
                  className={`p-3 rounded-xl text-[11px] leading-relaxed ${
                    isScrap
                      ? "bg-rose-50 border border-rose-500/20 text-rose-900"
                      : "bg-slate-50 border border-slate-200 text-slate-700"
                  }`}
                >
                  {isScrap ? (
                    <>
                      This stock is being <strong>written off</strong> — it will not come
                      back to a shelf. The value below is recorded against the scrap
                      metric and cannot be edited afterwards.
                    </>
                  ) : (
                    <>
                      This stock has been <strong>used up</strong> and will not come back.
                      It was already taken off the shelf when it was issued, so no store
                      room changes here.
                    </>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                    Quantity to {isScrap ? "Scrap" : "Consume"} *{" "}
                    <span className="font-normal text-slate-500">
                      ({outstanding} outstanding)
                    </span>
                  </label>
                  <input
                    type="number"
                    min="1"
                    max={outstanding}
                    value={disposalForm.quantity}
                    onChange={(e) =>
                      setDisposalForm({ ...disposalForm, quantity: e.target.value })
                    }
                    required
                    className="w-full px-4 py-2.5 text-sm rounded-xl bg-white border border-slate-200 text-slate-900 focus:outline-none focus:border-brand-500"
                  />
                </div>

                {/* Price the scrap before it is booked, so the person recording
                    it sees the number that lands on the maintenance metric. */}
                {isScrap &&
                  (unitCost > 0 ? (
                    <div className="p-3.5 rounded-xl bg-rose-50/60 border border-rose-500/20 space-y-2">
                      <div className="flex justify-between text-xs">
                        <span className="text-slate-600">Unit cost</span>
                        <span className="font-semibold text-slate-800">
                          {formatCurrency(unitCost)}
                        </span>
                      </div>
                      <div className="border-t border-rose-500/20 pt-2 flex justify-between items-center">
                        <span className="text-xs font-semibold text-slate-900">
                          Scrap value ({Number(disposalForm.quantity) || 0} × unit cost)
                        </span>
                        <span className="text-base font-extrabold text-rose-700">
                          {formatCurrency(previewValue)}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-[11px] text-slate-600 leading-relaxed">
                      This product has no unit cost recorded, so the scrap cannot be
                      valued. The quantity is still logged.
                    </div>
                  ))}

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                    {isScrap ? "Reason for Scrapping *" : "Note"}
                  </label>
                  <textarea
                    rows={3}
                    value={disposalForm.reason}
                    onChange={(e) =>
                      setDisposalForm({ ...disposalForm, reason: e.target.value })
                    }
                    required={isScrap}
                    placeholder={
                      isScrap
                        ? "e.g. Bearing seized, beyond repair"
                        : "e.g. Used on the mixer overhaul"
                    }
                    className="w-full px-4 py-2.5 text-sm rounded-xl bg-white border border-slate-200 text-slate-900 placeholder-slate-400 focus:outline-none focus:border-brand-500"
                  />
                </div>

                <div className="pt-4 border-t border-slate-200 flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setDisposal(null)}
                    className="px-4 py-2 text-xs font-semibold rounded-xl bg-white border border-slate-200 text-slate-600 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className={`px-4 py-2 text-xs font-semibold rounded-xl text-white disabled:opacity-50 cursor-pointer active:scale-98 transition-all flex items-center gap-2 ${
                      accent === "rose"
                        ? "bg-rose-600 hover:bg-rose-500"
                        : "bg-slate-700 hover:bg-slate-600"
                    }`}
                  >
                    {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    {isScrap ? "Record Scrap" : "Record Consumption"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        );
      })()}

      {/* Product Details Modal */}
      {selectedProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
          <div className="glass-premium w-full max-w-lg rounded-2xl border border-slate-200 max-h-[90vh] overflow-y-auto shadow-2xl animate-fade-in text-left">
            <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-center">
              <h3 className="font-bold text-lg text-slate-900 flex items-center gap-2">
                <Boxes className="h-5 w-5 text-brand-700" />
                Product Specifications
              </h3>
              <button
                onClick={() => setSelectedProduct(null)}
                className="p-1 rounded-lg hover:bg-slate-100 text-slate-600 hover:text-slate-900 cursor-pointer transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-6 space-y-6">
              <div className="flex gap-4">
                <img
                  src={selectedProduct.image || "https://images.unsplash.com/photo-1595246140707-1e5b22b271d4?w=100&auto=format"}
                  alt={selectedProduct.name}
                  className="w-24 h-24 rounded-xl object-cover border border-slate-200"
                />
                <div>
                  <h4 className="text-xl font-bold text-slate-900 leading-tight">{selectedProduct.name}</h4>
                  <span className="text-xs font-mono text-brand-700 mt-1 block">CODE: {selectedProduct.code}</span>
                  <span className="inline-block mt-2 px-2 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-600 border border-slate-200">
                    {selectedProduct.storeRoom}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 text-xs">
                <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                  <span className="text-slate-500 block mb-0.5">Category</span>
                  <span className="font-semibold text-slate-800">{selectedProduct.category}</span>
                </div>
                <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                  <span className="text-slate-500 block mb-0.5">Rack Number</span>
                  <span className="font-semibold text-slate-800">{selectedProduct.rackNumber || "—"}</span>
                </div>
                <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                  <span className="text-slate-500 block mb-0.5">Current Stock</span>
                  <span className="font-bold text-slate-900">{selectedProduct.quantity} {selectedProduct.unit}</span>
                </div>
                <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                  <span className="text-slate-500 block mb-0.5">Min Stock Limit</span>
                  <span className="font-semibold text-slate-800">{selectedProduct.minStock} {selectedProduct.unit}</span>
                </div>
              </div>

              <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 text-xs">
                <span className="text-slate-500 block mb-1">Description</span>
                <p className="text-slate-700 leading-relaxed">{selectedProduct.description || "No description provided."}</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SupervisorIssueHistory;
