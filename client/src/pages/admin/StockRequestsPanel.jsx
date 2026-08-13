import { useEffect, useState } from "react";
import API from "../../services/api";
import { useNotifications } from "../../context/NotificationContext";
import useAutoRefresh from "../../hooks/useAutoRefresh";
import {
  Loader2,
  Calendar,
  HelpCircle,
  Building2,
  X,
  User,
  MessageSquare,
  ArrowRight,
} from "lucide-react";

const STATUS_TABS = ["Pending", "Approved", "Rejected", "Cancelled", "All"];

/**
 * Supervisor stock requests (`REQ-IN-…`) awaiting an Admin decision.
 *
 * Accepting credits exactly one stock room — the one selected here — and
 * updates the product total. Rejecting moves no stock at all.
 */
const StockRequestsPanel = () => {
  const { showToast } = useNotifications();
  const [requests, setRequests] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("Pending");

  const [selected, setSelected] = useState(null);
  const [actionType, setActionType] = useState(""); // approve | reject
  const [form, setForm] = useState({ approvedQuantity: 1, stockRoomId: "", comment: "" });
  const [submitting, setSubmitting] = useState(false);

  /** [silent] is used by the background poll: no spinner, no error toast. */
  const fetchData = async ({ silent = false } = {}) => {
    try {
      if (!silent) setLoading(true);
      const [requestsRes, roomsRes] = await Promise.all([
        API.get("/requests/all"),
        API.get("/stock-rooms"),
      ]);
      setRequests(requestsRes.data.filter((req) => req.rawType === "stockin"));
      setRooms(roomsRes.data);
    } catch (error) {
      console.error("Error loading stock requests:", error);
      if (!silent) showToast("Could not retrieve stock requests", "error");
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Supervisors raise and edit these from the app, so the list re-reads the
  // API on its own. Paused while a decision modal is open so the request
  // being acted on cannot shift underneath the form.
  useAutoRefresh(() => fetchData({ silent: true }), { enabled: !actionType });

  const filteredRequests =
    statusFilter === "All" ? requests : requests.filter((req) => req.status === statusFilter);

  const openAction = (req, type) => {
    setSelected(req);
    setActionType(type);
    // Default to the room the supervisor asked for, else the product's home
    // room, else the first room on file.
    const preferredRoom =
      req.requestedStockRoom?._id ||
      rooms.find((room) => room.name === req.product?.storeRoom)?._id ||
      rooms[0]?._id ||
      "";
    setForm({
      approvedQuantity: req.quantity,
      stockRoomId: preferredRoom,
      comment: "",
    });
  };

  const closeAction = () => {
    setSelected(null);
    setActionType("");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (actionType === "reject" && !form.comment.trim()) {
      showToast("A reason for rejection is required", "error");
      return;
    }

    if (actionType === "approve") {
      const qty = Number(form.approvedQuantity);
      if (!Number.isInteger(qty) || qty < 1) {
        showToast("Approved quantity must be a whole number of at least 1", "error");
        return;
      }
      if (qty > selected.quantity) {
        showToast(`Only ${selected.quantity} was requested`, "error");
        return;
      }
      if (!form.stockRoomId) {
        showToast("Select the stock room to credit", "error");
        return;
      }
    }

    try {
      setSubmitting(true);
      const body =
        actionType === "approve"
          ? {
              adminComments: form.comment,
              stockRoomId: form.stockRoomId,
              approvedQuantity: Number(form.approvedQuantity),
            }
          : { adminComments: form.comment };

      await API.put(`/requests/stockin/${selected._id}/${actionType}`, body);

      showToast(
        actionType === "approve"
          ? `${selected.requestNumber} accepted — stock added to ${
              rooms.find((room) => room._id === form.stockRoomId)?.name || "the selected room"
            }`
          : `${selected.requestNumber} rejected — no stock was changed`,
        "success"
      );
      closeAction();
      fetchData();
    } catch (error) {
      console.error("Error processing stock request:", error);
      showToast(error.response?.data?.message || "Failed to process request", "error");
    } finally {
      setSubmitting(false);
    }
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case "Approved":
        return "bg-emerald-500/10 text-emerald-600 border border-emerald-500/20";
      case "Rejected":
        return "bg-rose-500/10 text-rose-600 border border-rose-500/20";
      // Withdrawn by the supervisor rather than decided by an Admin.
      case "Cancelled":
        return "bg-slate-500/10 text-slate-600 border border-slate-500/20";
      default:
        return "bg-amber-500/10 text-amber-600 border border-amber-500/20";
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return "—";
    const d = new Date(dateString);
    return (
      d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" }) +
      " " +
      d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    );
  };

  const pendingCount = requests.filter((req) => req.status === "Pending").length;

  return (
    <div className="space-y-6">
      {/* Filter bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-5 rounded-2xl glass-premium border border-slate-200">
        <div>
          <h3 className="text-lg font-bold text-slate-900">Supervisor Stock Requests</h3>
          <p className="text-xs text-slate-500">
            {pendingCount} pending • accepting credits one stock room only
          </p>
        </div>

        <div className="flex flex-wrap bg-slate-100 p-1.5 rounded-xl border border-slate-200">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setStatusFilter(tab)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                statusFilter === tab
                  ? "bg-brand-600 text-white shadow"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="h-[40vh] flex items-center justify-center">
          <Loader2 className="h-7 w-7 text-brand-500 animate-spin" />
        </div>
      ) : filteredRequests.length === 0 ? (
        <div className="glass-premium p-12 text-center rounded-2xl border border-slate-200 flex flex-col items-center justify-center">
          <HelpCircle className="h-10 w-10 text-slate-400 mb-3" />
          <h3 className="text-base font-bold text-slate-900 mb-1">No stock requests found</h3>
          <p className="text-xs text-slate-500">
            No supervisor requests with status:{" "}
            <strong className="text-brand-700">{statusFilter}</strong>.
          </p>
        </div>
      ) : (
        <div className="glass-premium rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-medium text-xs uppercase tracking-wider">
                  <th className="py-4 px-6">Request ID</th>
                  <th className="py-4 px-6">Supervisor</th>
                  <th className="py-4 px-6">Product</th>
                  <th className="py-4 px-6 text-center">Requested</th>
                  <th className="py-4 px-6 text-center">Current Stock</th>
                  <th className="py-4 px-6">Requested Room</th>
                  <th className="py-4 px-6">Date</th>
                  <th className="py-4 px-6 text-center">Status</th>
                  <th className="py-4 px-6 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-slate-700">
                {filteredRequests.map((req) => (
                  <tr key={req._id} className="hover:bg-slate-50 transition-colors">
                    <td className="py-4 px-6 font-mono text-xs text-brand-700 font-bold">
                      {req.requestNumber}
                    </td>
                    <td className="py-4 px-6">
                      <div className="flex items-center gap-2">
                        <div className="h-7 w-7 rounded-full bg-slate-100 flex items-center justify-center text-slate-600 border border-slate-200">
                          <User className="h-3.5 w-3.5" />
                        </div>
                        <div>
                          <div className="font-semibold text-slate-800 text-xs">
                            {req.supervisor?.name || "System"}
                          </div>
                          <div className="text-[10px] text-slate-500">
                            {req.supervisor?.email}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="py-4 px-6">
                      <div className="flex items-center gap-3">
                        <img
                          src={
                            req.product?.image ||
                            "https://images.unsplash.com/photo-1595246140707-1e5b22b271d4?w=50&auto=format"
                          }
                          alt={req.product?.name}
                          className="w-9 h-9 rounded-lg object-cover border border-slate-200"
                        />
                        <div>
                          <div className="font-bold text-slate-900">
                            {req.product?.name || "Unknown Product"}
                          </div>
                          <div className="text-[10px] font-mono text-brand-700">
                            {req.product?.code || "—"}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="py-4 px-6 text-center">
                      <span className="bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 px-2.5 py-0.5 rounded text-xs font-bold">
                        +{req.quantity} {req.product?.unit || ""}
                      </span>
                      {req.status === "Approved" &&
                        req.approvedQuantity != null &&
                        req.approvedQuantity !== req.quantity && (
                          <span className="block mt-1 text-[10px] text-slate-500">
                            approved {req.approvedQuantity}
                          </span>
                        )}
                    </td>
                    <td className="py-4 px-6 text-center text-xs font-semibold text-slate-900">
                      {req.product?.quantity ?? "—"} {req.product?.unit || ""}
                    </td>
                    <td className="py-4 px-6 text-xs text-slate-600">
                      <span className="flex items-center gap-1.5">
                        <Building2 className="h-3.5 w-3.5 opacity-65" />
                        {req.requestedStockRoom?.name || req.product?.storeRoom || "—"}
                      </span>
                      {req.status === "Approved" && req.stockRoom?.name && (
                        <span className="block mt-1 text-[10px] text-emerald-600 font-semibold">
                          credited to {req.stockRoom.name}
                        </span>
                      )}
                    </td>
                    <td className="py-4 px-6 text-xs text-slate-600">
                      <span className="flex items-center gap-1.5">
                        <Calendar className="h-3.5 w-3.5 opacity-65" />
                        {formatDate(req.createdDate)}
                      </span>
                    </td>
                    <td className="py-4 px-6 text-center">
                      <span
                        className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${getStatusBadge(
                          req.status
                        )}`}
                      >
                        {/* "Approved" is what the API stores; the workflow
                            calls it Accepted. */}
                        {req.status === "Approved" ? "Accepted" : req.status}
                      </span>
                    </td>
                    <td className="py-4 px-6 text-right">
                      {req.status === "Pending" ? (
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => openAction(req, "reject")}
                            className="px-3 py-1.5 rounded-lg bg-rose-50 border border-rose-200 text-xs font-semibold text-rose-600 hover:bg-rose-600 hover:text-white cursor-pointer transition-all"
                          >
                            Reject
                          </button>
                          <button
                            onClick={() => openAction(req, "approve")}
                            className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white cursor-pointer shadow transition-all"
                          >
                            Accept
                          </button>
                        </div>
                      ) : (
                        <span className="text-[10px] text-slate-500 italic">
                          {req.admin?.name ? `by ${req.admin.name}` : "—"}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Accept / Reject modal */}
      {selected && actionType && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
          <div className="glass-premium w-full max-w-md rounded-2xl border border-slate-200 overflow-hidden shadow-2xl animate-fade-in text-left">
            <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-center">
              <div>
                <h3 className="font-bold text-lg text-slate-900">
                  {actionType === "approve" ? "Accept" : "Reject"} Request
                </h3>
                <p className="text-xs text-slate-600 mt-0.5 font-mono">
                  {selected.requestNumber}
                </p>
              </div>
              <button
                onClick={closeAction}
                className="p-1 rounded-lg hover:bg-slate-100 text-slate-600 hover:text-slate-900 cursor-pointer transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div className="flex gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200">
                <img
                  src={
                    selected.product?.image ||
                    "https://images.unsplash.com/photo-1595246140707-1e5b22b271d4?w=80&auto=format"
                  }
                  alt={selected.product?.name}
                  className="w-14 h-14 rounded-lg object-cover border border-slate-200"
                />
                <div className="text-xs">
                  <h4 className="text-sm font-bold text-slate-900">
                    {selected.product?.name || "Unknown Product"}
                  </h4>
                  <span className="font-mono text-brand-700 block mt-0.5">
                    {selected.product?.code || "—"}
                  </span>
                  <span className="text-slate-600 block mt-0.5">
                    Requested by {selected.supervisor?.name || "System"}
                  </span>
                </div>
              </div>

              {actionType === "approve" ? (
                <>
                  {/* Before → after preview */}
                  <div className="p-4 bg-emerald-50 border border-emerald-500/20 rounded-xl flex items-center justify-between text-sm">
                    <div>
                      <span className="text-[10px] text-slate-500 block mb-0.5">
                        Total Now
                      </span>
                      <span className="font-bold text-slate-800">
                        {selected.product?.quantity ?? 0} {selected.product?.unit || ""}
                      </span>
                    </div>
                    <ArrowRight className="h-4 w-4 text-slate-400" />
                    <div>
                      <span className="text-[10px] text-slate-500 block mb-0.5">Adding</span>
                      <span className="font-bold text-emerald-600">
                        +{form.approvedQuantity || 0}
                      </span>
                    </div>
                    <ArrowRight className="h-4 w-4 text-slate-400" />
                    <div>
                      <span className="text-[10px] text-slate-500 block mb-0.5">
                        Total After
                      </span>
                      <span className="font-bold text-slate-900">
                        {(selected.product?.quantity ?? 0) + Number(form.approvedQuantity || 0)}{" "}
                        {selected.product?.unit || ""}
                      </span>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                      Approved Quantity *{" "}
                      <span className="font-normal text-slate-500">
                        ({selected.quantity} requested)
                      </span>
                    </label>
                    <input
                      type="number"
                      min="1"
                      max={selected.quantity}
                      value={form.approvedQuantity}
                      onChange={(e) =>
                        setForm({ ...form, approvedQuantity: e.target.value })
                      }
                      required
                      className="w-full px-4 py-2.5 text-sm rounded-xl bg-white border border-slate-200 text-slate-900 focus:outline-none focus:border-brand-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                      Credit to Stock Room *
                    </label>
                    <select
                      value={form.stockRoomId}
                      onChange={(e) => setForm({ ...form, stockRoomId: e.target.value })}
                      required
                      className="w-full px-4 py-2.5 text-sm rounded-xl bg-white border border-slate-200 text-slate-900 focus:outline-none focus:border-brand-500 cursor-pointer"
                    >
                      <option value="">Select a stock room…</option>
                      {rooms.map((room) => (
                        <option key={room._id} value={room._id}>
                          {room.name}
                        </option>
                      ))}
                    </select>
                    <p className="mt-1.5 text-[11px] text-slate-500 leading-relaxed">
                      Only this room's balance changes. The supervisor asked for{" "}
                      <strong>
                        {selected.requestedStockRoom?.name ||
                          selected.product?.storeRoom ||
                          "no specific room"}
                      </strong>
                      .
                    </p>
                  </div>
                </>
              ) : (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-500/20 text-[11px] text-rose-900 leading-relaxed">
                  No stock will be added. Every stock room keeps its current quantity and the
                  product total is unchanged.
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                  {actionType === "approve" ? "Comment (optional)" : "Reason for Rejection *"}
                </label>
                <div className="relative">
                  <span className="absolute top-3 left-3 text-slate-500">
                    <MessageSquare className="h-4 w-4" />
                  </span>
                  <textarea
                    value={form.comment}
                    onChange={(e) => setForm({ ...form, comment: e.target.value })}
                    required={actionType === "reject"}
                    rows="3"
                    placeholder={
                      actionType === "approve"
                        ? "Leave a note for the supervisor (optional)…"
                        : "e.g. Requested quantity not available."
                    }
                    className="w-full pl-9 pr-4 py-2.5 text-sm rounded-xl bg-white border border-slate-200 text-slate-900 placeholder-slate-400 focus:outline-none focus:border-brand-500 resize-none"
                  ></textarea>
                </div>
              </div>

              <div className="pt-4 border-t border-slate-200 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={closeAction}
                  className="px-4 py-2 text-xs font-semibold rounded-xl bg-white border border-slate-200 text-slate-600 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className={`px-4 py-2 text-xs font-semibold rounded-xl text-white disabled:opacity-50 cursor-pointer active:scale-98 transition-all flex items-center gap-2 ${
                    actionType === "approve"
                      ? "bg-emerald-600 hover:bg-emerald-500"
                      : "bg-rose-600 hover:bg-rose-500"
                  }`}
                >
                  {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Confirm {actionType === "approve" ? "Accept" : "Rejection"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default StockRequestsPanel;
