import { useEffect, useState } from "react";
import API from "../../services/api";
import { useNotifications } from "../../context/NotificationContext";
import useAutoRefresh from "../../hooks/useAutoRefresh";
import {
  Loader2,
  GitMerge,
  Calendar,
  HelpCircle,
  Building2,
  X,
  Eye,
  User,
  MessageSquare,
  History,
} from "lucide-react";

const STATUS_TABS = ["Pending Approval", "Approved", "Rejected", "All"];

/** How the merge came to be raised, as shown under the requester's name. */
const CREATED_VIA_LABELS = {
  Scheduled: "Scheduled run",
  Manual: "Run by hand",
  Supervisor: "Supervisor request",
};

/**
 * What each line's destination room will hold once the merge is approved.
 *
 * Accumulated per product-and-room as the lines are walked, because a merge
 * usually carries several returns of the same product: reading each of them
 * against the room's opening balance would promise "5 → 8" on two lines when
 * the room actually ends at 11.
 *
 * Only meaningful while the request is still pending — once it is approved the
 * quantities are already inside `roomQuantities`, and adding them again would
 * show the merge landing twice.
 */
const projectBalances = (items, destinationOf) => {
  const running = new Map();

  return items.map((line) => {
    const room = destinationOf(line);
    const key = `${String(line.product?._id || line.product)}::${room}`;

    const before =
      running.get(key) ??
      (line.roomQuantities || []).find((entry) => entry.stockRoom === room)?.quantity ??
      0;

    const after = before + line.quantity;
    running.set(key, after);

    return { room, before, after };
  });
};

/**
 * The merge review — the only Admin approval in the return flow. Merges arrive
 * from the weekly run and from supervisors asking for their own returns to be
 * moved early; both are decided here.
 *
 * Approving moves the quantity out of Red Stock into the store room the Admin
 * picks here; rejecting moves nothing and leaves it in Red Stock for next
 * week.
 */
const MergeRequests = () => {
  const { showToast } = useNotifications();
  const [requests, setRequests] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("Pending Approval");

  // The list carries enough for the table; the inspector needs the enriched
  // detail (Red Stock held, store room balances, return history).
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [actionType, setActionType] = useState(""); // approve | reject
  const [actionComment, setActionComment] = useState("");
  const [destinationRoom, setDestinationRoom] = useState("");
  const [lineDestinations, setLineDestinations] = useState({});
  const [submitting, setSubmitting] = useState(false);

  /** [silent] is used by the background poll: no spinner, no error toast. */
  const fetchRequests = async ({ silent = false } = {}) => {
    try {
      if (!silent) setLoading(true);
      const [requestsRes, roomsRes] = await Promise.all([
        API.get("/merge-requests"),
        API.get("/stock-rooms"),
      ]);
      setRequests(requestsRes.data);
      setRooms(roomsRes.data);
    } catch (error) {
      console.error("Error loading merge requests:", error);
      if (!silent) showToast("Could not retrieve merge requests", "error");
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    fetchRequests();
  }, []);

  // The scheduler can raise a merge at any time; paused while one is open for
  // inspection or decision.
  useAutoRefresh(() => fetchRequests({ silent: true }), { enabled: !selectedId });

  // Load the review detail whenever a request is opened.
  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        setDetailLoading(true);
        const { data } = await API.get(`/merge-requests/${selectedId}`);
        if (cancelled) return;
        setDetail(data);
        setDestinationRoom(data.destinationRoom || rooms[0]?.name || "");
        setLineDestinations({});
      } catch (error) {
        console.error("Error loading merge request detail:", error);
        if (!cancelled) showToast("Could not open this merge request", "error");
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const filteredRequests =
    statusFilter === "All" ? requests : requests.filter((req) => req.status === statusFilter);

  const closeInspector = () => {
    setSelectedId(null);
    setActionType("");
    setActionComment("");
    setLineDestinations({});
  };

  const handleAction = async (e) => {
    e.preventDefault();

    if (actionType === "reject" && !actionComment.trim()) {
      showToast("A rejection reason is required", "error");
      return;
    }
    if (actionType === "approve" && !destinationRoom) {
      showToast("Choose the destination company", "error");
      return;
    }

    try {
      setSubmitting(true);
      const body =
        actionType === "approve"
          ? { comment: actionComment, destinationRoom, lineDestinations }
          : { rejectionReason: actionComment };

      const { data } = await API.put(`/merge-requests/${selectedId}/${actionType}`, body);

      showToast(data.message || "Merge request processed", "success");
      closeInspector();
      fetchRequests();
    } catch (error) {
      console.error("Error processing merge request:", error);
      showToast(error.response?.data?.message || "Failed to process merge request", "error");
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

  const destinationFor = (line) =>
    lineDestinations[String(line.restockItem?._id || line.restockItem)] || destinationRoom;

  // Recomputed each render rather than memoised, so the projected balances
  // follow the destination dropdowns the moment the Admin changes one.
  const isPending = detail?.status === "Pending Approval";
  const projections = detail?.items ? projectBalances(detail.items, destinationFor) : [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-2xl glass-premium border border-slate-200">
        <div className="flex items-center gap-2">
          <GitMerge className="h-5 w-5 text-brand-700" />
          <div>
            <h3 className="text-lg font-bold text-slate-900">Merge Review</h3>
            <p className="text-xs text-slate-500">
              Approve to move Red Stock into a company
            </p>
          </div>
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

      {/* Table */}
      {loading ? (
        <div className="h-[40vh] flex items-center justify-center">
          <Loader2 className="h-7 w-7 text-brand-500 animate-spin" />
        </div>
      ) : filteredRequests.length === 0 ? (
        <div className="glass-premium p-12 text-center rounded-2xl border border-slate-200 flex flex-col items-center justify-center">
          <HelpCircle className="h-10 w-10 text-slate-400 mb-3" />
          <h3 className="text-base font-bold text-slate-900 mb-1">No merge requests found</h3>
          <p className="text-xs text-slate-500">
            One merge request is raised per week over the Red Stock Room, plus any a
            supervisor sends in for their own returns.
          </p>
        </div>
      ) : (
        <div className="glass-premium rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-medium text-xs uppercase tracking-wider">
                  <th className="py-4 px-6">Merge Request</th>
                  <th className="py-4 px-6">Week</th>
                  <th className="py-4 px-6 text-center">Items</th>
                  <th className="py-4 px-6 text-center">Total Qty</th>
                  <th className="py-4 px-6">Raised By</th>
                  <th className="py-4 px-6">Merge Date</th>
                  <th className="py-4 px-6 text-center">Status</th>
                  <th className="py-4 px-6 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-slate-700">
                {filteredRequests.map((req) => (
                  <tr key={req._id} className="hover:bg-slate-50 transition-colors">
                    <td className="py-4 px-6 font-mono text-xs text-brand-700 font-bold">
                      {req.requestId}
                    </td>
                    <td className="py-4 px-6 text-xs font-semibold text-slate-700">
                      {req.weekKey}
                    </td>
                    <td className="py-4 px-6 text-center font-semibold text-slate-900">
                      {req.itemCount}
                    </td>
                    <td className="py-4 px-6 text-center">
                      <span className="bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 px-2.5 py-0.5 rounded text-xs font-bold">
                        {req.totalQuantity} pcs
                      </span>
                    </td>
                    <td className="py-4 px-6">
                      <div className="flex items-center gap-2">
                        <div className="h-7 w-7 rounded-full bg-slate-100 flex items-center justify-center text-slate-600 border border-slate-200">
                          <User className="h-3.5 w-3.5" />
                        </div>
                        <div>
                          <div className="font-semibold text-slate-800 text-xs">
                            {req.requestedBy?.name || "System"}
                          </div>
                          <div className="text-[10px] text-slate-500">
                            {CREATED_VIA_LABELS[req.createdVia] || "Run by hand"}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="py-4 px-6 text-xs text-slate-600">
                      <span className="flex items-center gap-1.5">
                        <Calendar className="h-3.5 w-3.5 opacity-65" />
                        {formatDate(req.requestedAt)}
                      </span>
                    </td>
                    <td className="py-4 px-6 text-center">
                      <span
                        className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${getStatusBadge(
                          req.status
                        )}`}
                      >
                        {req.status}
                      </span>
                      {req.destinationRoom && req.status === "Approved" && (
                        <span className="block mt-1 text-[10px] text-emerald-600 font-semibold">
                          → {req.destinationRoom}
                        </span>
                      )}
                    </td>
                    <td className="py-4 px-6 text-right">
                      <button
                        onClick={() => setSelectedId(req._id)}
                        className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-xs font-semibold text-slate-700 hover:text-slate-900 inline-flex items-center gap-1 cursor-pointer transition-all hover:bg-slate-100"
                      >
                        <Eye className="h-3.5 w-3.5" /> Review
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Inspector + action modal */}
      {selectedId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
          {detailLoading || !detail ? (
            <div className="glass-premium p-10 rounded-2xl border border-slate-200 shadow-2xl">
              <Loader2 className="h-7 w-7 text-brand-500 animate-spin" />
            </div>
          ) : actionType ? (
            /* Action confirmation takes over when an action is chosen */
            <div className="glass-premium w-full max-w-md rounded-2xl border border-slate-200 max-h-[90vh] overflow-y-auto shadow-2xl animate-fade-in text-left">
              <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-center">
                <h3 className="font-bold text-slate-900">
                  {actionType === "approve" ? "Approve" : "Reject"} {detail.requestId}
                </h3>
                <button
                  onClick={() => setActionType("")}
                  className="p-1 rounded-lg hover:bg-slate-100 text-slate-600 hover:text-slate-900 cursor-pointer transition-colors"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <form onSubmit={handleAction} className="p-6 space-y-4">
                <div
                  className={`p-3 rounded-xl text-[11px] leading-relaxed border ${
                    actionType === "approve"
                      ? "bg-emerald-50 border-emerald-500/20 text-emerald-900"
                      : "bg-rose-50 border-rose-500/20 text-rose-900"
                  }`}
                >
                  {actionType === "approve" ? (
                    <>
                      This moves <strong>{detail.totalQuantity} pcs</strong> across{" "}
                      <strong>{detail.itemCount} item(s)</strong> out of Red Stock and into{" "}
                      <strong>{destinationRoom}</strong>. Red Stock decreases by the same
                      quantity.
                    </>
                  ) : (
                    <>
                      Nothing moves. The stock stays in the Red Stock Room and joins next week's
                      merge.
                    </>
                  )}
                </div>

                {actionType === "approve" && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                      Destination Company *
                    </label>
                    <select
                      value={destinationRoom}
                      onChange={(e) => setDestinationRoom(e.target.value)}
                      required
                      className="w-full px-4 py-2.5 text-sm rounded-xl bg-white border border-slate-200 text-slate-900 focus:outline-none focus:border-brand-500 cursor-pointer"
                    >
                      {rooms.map((room) => (
                        <option key={room._id} value={room.name}>
                          {room.name}
                        </option>
                      ))}
                    </select>
                    <p className="text-[10px] text-slate-500 mt-1.5">
                      Lines you routed individually in the review keep their own room.
                    </p>
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
                      value={actionComment}
                      onChange={(e) => setActionComment(e.target.value)}
                      required={actionType === "reject"}
                      rows="3"
                      placeholder={
                        actionType === "approve"
                          ? "Leave a comment (optional)..."
                          : "Explain why this merge is rejected (required)..."
                      }
                      className="w-full pl-9 pr-4 py-2.5 text-sm rounded-xl bg-white border border-slate-200 text-slate-900 placeholder-slate-400 focus:outline-none focus:border-brand-500 resize-none"
                    ></textarea>
                  </div>
                </div>

                <div className="pt-4 border-t border-slate-200 flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setActionType("")}
                    className="px-4 py-2 text-xs font-semibold rounded-xl bg-white border border-slate-200 text-slate-600 cursor-pointer"
                  >
                    Back
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
                    Confirm {actionType === "approve" ? "Merge" : "Rejection"}
                  </button>
                </div>
              </form>
            </div>
          ) : (
            <div className="glass-premium w-full max-w-4xl rounded-2xl border border-slate-200 max-h-[90vh] overflow-y-auto shadow-2xl animate-fade-in text-left">
              <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-center">
                <div>
                  <h3 className="font-bold text-lg text-slate-900">
                    Merge Request: {detail.requestId}
                  </h3>
                  <p className="text-xs text-slate-600">
                    {detail.weekKey} • {CREATED_VIA_LABELS[detail.createdVia] || "Run by hand"} by{" "}
                    {detail.requestedBy?.name || "System"} • {formatDate(detail.requestedAt)}
                  </p>
                </div>
                <button
                  onClick={closeInspector}
                  className="p-1 rounded-lg hover:bg-slate-100 text-slate-600 hover:text-slate-900 cursor-pointer transition-colors"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="p-6 space-y-5 max-h-[70vh] overflow-y-auto">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
                  <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                    <span className="text-slate-500 block mb-0.5">Items</span>
                    <span className="font-bold text-slate-900">{detail.itemCount}</span>
                  </div>
                  <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                    <span className="text-slate-500 block mb-0.5">Total Quantity</span>
                    <span className="font-bold text-emerald-600">{detail.totalQuantity} pcs</span>
                  </div>
                  <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                    <span className="text-slate-500 block mb-0.5">Status</span>
                    <span className="font-bold text-slate-900">{detail.status}</span>
                  </div>
                  <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                    <span className="text-slate-500 block mb-0.5">Merge Date</span>
                    <span className="font-bold text-slate-900">
                      {formatDate(detail.reviewedAt || detail.requestedAt)}
                    </span>
                  </div>
                </div>

                {/* Destination for the whole merge */}
                {detail.status === "Pending Approval" && (
                  <div className="p-4 rounded-xl bg-brand-50 border border-brand-500/20 flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
                    <div className="text-[11px] text-slate-700 leading-relaxed">
                      <strong className="text-brand-700 flex items-center gap-1.5">
                        <Building2 className="h-3.5 w-3.5" /> Destination
                      </strong>
                      Approved quantities move into this company. Override any single line
                      below to split the merge.
                    </div>
                    <select
                      value={destinationRoom}
                      onChange={(e) => setDestinationRoom(e.target.value)}
                      className="px-4 py-2 text-sm rounded-xl bg-white border border-slate-200 text-slate-900 focus:outline-none focus:border-brand-500 cursor-pointer shrink-0"
                    >
                      {rooms.map((room) => (
                        <option key={room._id} value={room.name}>
                          {room.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Line-by-line review */}
                <div className="rounded-xl border border-slate-200 overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-medium uppercase tracking-wider">
                          <th className="py-3 px-4">Item</th>
                          <th className="py-3 px-4 text-center">Qty</th>
                          <th className="py-3 px-4 text-center">Red Stock</th>
                          {(detail.stockRooms || []).map((room) => (
                            <th key={room._id} className="py-3 px-4 text-center">
                              {room.name}
                            </th>
                          ))}
                          {isPending && (
                            <th className="py-3 px-4 text-center">In Stock After Merge</th>
                          )}
                          <th className="py-3 px-4">Destination</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 text-slate-700">
                        {detail.items.map((line, index) => {
                          const lineId = String(line.restockItem?._id || line.restockItem);
                          const projection = projections[index];
                          return (
                            <tr key={lineId} className="hover:bg-slate-50">
                              <td className="py-3 px-4">
                                <div className="flex items-center gap-2.5">
                                  <img
                                    src={
                                      line.product?.image ||
                                      "https://images.unsplash.com/photo-1595246140707-1e5b22b271d4?w=50&auto=format"
                                    }
                                    alt={line.productName}
                                    className="w-8 h-8 rounded-lg object-cover border border-slate-200"
                                  />
                                  <div>
                                    <span className="font-semibold text-slate-800">
                                      {line.productName}
                                    </span>
                                    <span className="block font-mono text-[10px] text-slate-500">
                                      {line.product?.code || "—"}
                                    </span>
                                  </div>
                                </div>
                              </td>
                              <td className="py-3 px-4 text-center font-bold text-emerald-600">
                                +{line.quantity} {line.unit}
                              </td>
                              <td className="py-3 px-4 text-center font-semibold text-rose-600">
                                {line.redStockQuantity}
                              </td>
                              {(line.roomQuantities || []).map((room) => (
                                <td
                                  key={room.stockRoomId}
                                  className={`py-3 px-4 text-center ${
                                    isPending && room.stockRoom === projection?.room
                                      ? "font-semibold text-slate-900"
                                      : "text-slate-600"
                                  }`}
                                >
                                  {room.quantity}
                                </td>
                              ))}
                              {isPending && (
                                <td className="py-3 px-4 text-center whitespace-nowrap">
                                  <span className="text-slate-500">{projection.before}</span>
                                  <span className="mx-1.5 text-slate-400">&rarr;</span>
                                  <span className="font-bold text-emerald-600">
                                    {projection.after}
                                  </span>
                                  <span className="block text-[10px] text-slate-400">
                                    in {projection.room}
                                  </span>
                                </td>
                              )}
                              <td className="py-3 px-4">
                                {detail.status === "Pending Approval" ? (
                                  <select
                                    value={destinationFor(line)}
                                    onChange={(e) =>
                                      setLineDestinations((prev) => ({
                                        ...prev,
                                        [lineId]: e.target.value,
                                      }))
                                    }
                                    className="px-2 py-1.5 text-xs rounded-lg bg-white border border-slate-200 text-slate-900 focus:outline-none focus:border-brand-500 cursor-pointer"
                                  >
                                    {rooms.map((room) => (
                                      <option key={room._id} value={room.name}>
                                        {room.name}
                                      </option>
                                    ))}
                                  </select>
                                ) : (
                                  <span className="font-semibold text-slate-700">
                                    {line.destinationRoom || "—"}
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Return history behind the lines */}
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold text-slate-600 uppercase tracking-wider flex items-center gap-1.5">
                    <History className="h-3.5 w-3.5" /> Return History
                  </h4>
                  <div className="rounded-xl border border-slate-200 divide-y divide-slate-200 max-h-56 overflow-y-auto">
                    {detail.items.flatMap((line) =>
                      (line.returnHistory || []).map((entry) => (
                        <div
                          key={`${line.productName}-${entry.restockNumber}`}
                          className="px-4 py-2 flex items-center justify-between text-[11px] gap-3"
                        >
                          <div className="min-w-0">
                            <span className="font-semibold text-slate-800">
                              {line.productName}
                            </span>
                            <span className="block text-slate-500 truncate">
                              {entry.restockNumber} • {entry.returnedBy} • {entry.department} •{" "}
                              {entry.sourceRoom || "—"}
                            </span>
                          </div>
                          <div className="text-right shrink-0">
                            <span className="font-bold text-slate-700">{entry.quantity} pcs</span>
                            <span className="block text-slate-500">
                              {formatDate(entry.returnDate)}
                            </span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {detail.comment && (
                  <div className="p-4 bg-white border border-slate-200 rounded-xl text-xs space-y-1.5">
                    <span className="text-slate-500 block font-semibold">Comment:</span>
                    <p className="text-slate-700 italic">"{detail.comment}"</p>
                  </div>
                )}

                {detail.status !== "Pending Approval" && (
                  <div className="p-4 bg-white border border-slate-200 rounded-xl text-xs space-y-1.5">
                    <span className="text-slate-500 block font-semibold">
                      Reviewed by {detail.reviewedBy?.name || "—"} • {formatDate(detail.reviewedAt)}
                    </span>
                    {detail.rejectionReason && (
                      <p className="text-rose-600 italic">"{detail.rejectionReason}"</p>
                    )}
                  </div>
                )}
              </div>

              {detail.status === "Pending Approval" && (
                <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex justify-end gap-3">
                  <button
                    onClick={() => {
                      setActionType("reject");
                      setActionComment("");
                    }}
                    className="px-4 py-2 text-xs font-bold rounded-xl bg-rose-50 border border-rose-200 text-rose-600 hover:bg-rose-600 hover:text-white cursor-pointer transition-all"
                  >
                    Reject Merge
                  </button>
                  <button
                    onClick={() => {
                      setActionType("approve");
                      setActionComment("");
                    }}
                    className="px-4 py-2 text-xs font-bold rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer shadow-lg active:scale-98 transition-all"
                  >
                    Approve Merge
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default MergeRequests;
