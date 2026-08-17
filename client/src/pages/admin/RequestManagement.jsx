import { useEffect, useState } from "react";
import API from "../../services/api";
import { useNotifications } from "../../context/NotificationContext";
import useAutoRefresh from "../../hooks/useAutoRefresh";
import {
  Loader2,
  User,
  ClipboardList,
  Eye,
  X,
  MessageSquare,
  ArrowRight,
  AlertTriangle,
  HelpCircle,
  GitMerge,
  Building2,
} from "lucide-react";

const PLACEHOLDER_IMAGE =
  "https://images.unsplash.com/photo-1595246140707-1e5b22b271d4?w=50&auto=format";

/**
 * A merge request read as a row of this console.
 *
 * Merges live in their own collection and carry their own vocabulary, so they
 * are mapped onto the shape the table already renders. The original document
 * rides along on `merge` for the inspector.
 */
const asRequestRow = (merge) => ({
  _id: merge._id,
  rawType: "merge",
  requestNumber: merge.requestId,
  requestType: "Stock Merge",
  supervisor: merge.requestedBy,
  createdDate: merge.requestedAt,
  status: merge.status === "Pending Approval" ? "Pending" : merge.status,
  adminComments: merge.status === "Rejected" ? merge.rejectionReason : merge.comment,
  merge,
});

const RequestManagement = () => {
  const { showToast } = useNotifications();
  const [requests, setRequests] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("Pending"); // Pending | Approved | Rejected | All

  // Modal Control
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [actionModalOpen, setActionModalOpen] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [actionType, setActionType] = useState(""); // approve | reject | keep-pending
  const [adminComments, setAdminComments] = useState("");
  // Where an approved merge puts the stock. Only merges use this.
  const [destinationRoom, setDestinationRoom] = useState("");
  // Set while a decision is in flight, so Approve cannot be double-fired now
  // that it commits without a confirmation step.
  const [deciding, setDeciding] = useState(false);

  /** [silent] is used by the background poll: no spinner, no error toast. */
  const fetchRequests = async ({ silent = false } = {}) => {
    try {
      if (!silent) setLoading(true);
      const [requestsRes, mergesRes, roomsRes] = await Promise.all([
        API.get("/requests/all"),
        // Both are newer than the rest of this console; a server that has not
        // been redeployed should still show the ordinary requests.
        API.get("/merge-requests").catch(() => ({ data: [] })),
        API.get("/stock-rooms").catch(() => ({ data: [] })),
      ]);

      const merged = [...requestsRes.data, ...mergesRes.data.map(asRequestRow)];
      // One list, newest first, however the two sources happen to be ordered.
      merged.sort((a, b) => new Date(b.createdDate) - new Date(a.createdDate));

      setRequests(merged);
      setRooms(roomsRes.data);
    } catch (error) {
      console.error("Error loading requests:", error);
      if (!silent) showToast("Could not retrieve requests log", "error");
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    fetchRequests();
  }, []);

  // Supervisors raise, edit and cancel these from the app. Paused while the
  // inspector or an action modal is open.
  useAutoRefresh(() => fetchRequests({ silent: true }), {
    enabled: !inspectorOpen && !actionModalOpen,
  });

  /**
   * Record a decision on [request]. [comment] is optional except on a
   * rejection, and [room] only means anything for a merge.
   */
  const submitDecision = async (request, type, comment = "", room = "") => {
    if (deciding) return;

    if (type === "reject" && !comment.trim()) {
      showToast("A reason for rejection must be provided", "error");
      return;
    }

    // A merge is the only decision that moves stock between rooms, so it needs
    // a destination before it can be approved.
    if (request.rawType === "merge" && type === "approve" && !room) {
      showToast("Choose the store room this stock goes into", "error");
      return;
    }

    try {
      setDeciding(true);
      const id = request._id;

      const { data } =
        request.rawType === "merge"
          ? await API.put(
              `/merge-requests/${id}/${type}`,
              type === "approve"
                ? { comment, destinationRoom: room }
                : { rejectionReason: comment }
            )
          : await API.put(`/requests/${request.rawType}/${id}/${type}`, {
              adminComments: comment,
            });

      showToast(
        data?.message ||
          `Request ${type === "approve" ? "Approved" : type === "reject" ? "Rejected" : "kept Pending"} successfully!`,
        "success"
      );

      setActionModalOpen(false);
      setInspectorOpen(false);
      setAdminComments("");
      fetchRequests();
    } catch (error) {
      showToast(error.response?.data?.message || "Failed to process request", "error");
    } finally {
      setDeciding(false);
    }
  };

  const handleActionSubmit = (e) => {
    e.preventDefault();
    submitDecision(selectedRequest, actionType, adminComments, destinationRoom);
  };

  // Approving goes straight through — the button was the confirmation. The
  // other two decisions still open the modal, because a rejection has to carry
  // a reason and holding one is worth a second look.
  const approveNow = (req) => submitDecision(req, "approve", "", destinationRoom);

  const openActionModal = (req, type) => {
    setSelectedRequest(req);
    setActionType(type);
    setAdminComments("");
    setActionModalOpen(true);
  };

  const openInspector = (req) => {
    setSelectedRequest(req);
    // Seed the destination so a merge can be approved straight from the
    // inspector, whether or not the select is touched.
    setDestinationRoom(req.merge?.destinationRoom || rooms[0]?.name || "");
    setInspectorOpen(true);
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case "Approved":
        return "badge-emerald";
      case "Rejected":
        return "badge-rose";
      // Withdrawn by the supervisor rather than decided by an Admin.
      case "Cancelled":
        return "badge-slate";
      default:
        return "badge-amber";
    }
  };

  const getRequestTypeColor = (type) => {
    switch (type) {
      case "Add Product":
        return "badge-brand";
      case "Edit Product":
        return "badge-indigo";
      case "Stock In":
        return "badge-emerald";
      case "Stock Out":
        return "badge-rose";
      case "Stock Merge":
        return "badge-violet";
      default:
        return "badge-cyan";
    }
  };

  const filteredRequests = statusFilter === "All"
    ? requests
    : requests.filter((r) => r.status === statusFilter);

  const formatDate = (dateString) => {
    const d = new Date(dateString);
    return d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" }) + 
           " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header Panel */}
      <div className="panel">
        <div className="flex items-center gap-3 min-w-0">
          <span className="panel-icon">
            <ClipboardList className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h3 className="panel-title">Office Approvals Console</h3>
            <p className="panel-sub">
              {filteredRequests.length} {statusFilter === "All" ? "total" : statusFilter.toLowerCase()}{" "}
              request(s)
            </p>
          </div>
        </div>

        {/* Tab Controls */}
        <div className="tabs">
          {["Pending", "Approved", "Rejected", "All"].map((tab) => (
            <button
              key={tab}
              onClick={() => setStatusFilter(tab)}
              className={`tab ${statusFilter === tab ? "tab-active" : ""}`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* Requests Listing */}
      {loading ? (
        <div className="h-[40vh] flex items-center justify-center">
          <Loader2 className="h-7 w-7 text-brand-500 animate-spin" />
        </div>
      ) : filteredRequests.length === 0 ? (
        <div className="empty">
          <HelpCircle className="h-10 w-10 text-slate-300 mb-3" />
          <h3 className="empty-title">No requests found</h3>
          <p className="empty-sub">
            No requests exist with status:{" "}
            <strong className="text-brand-700">{statusFilter}</strong>.
          </p>
        </div>
      ) : (
        <div className="table-card">
          <div className="table-scroll">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Request #</th>
                  <th>Type</th>
                  <th>Supervisor</th>
                  <th>Product / Scope</th>
                  <th>Submitted</th>
                  <th>Status</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredRequests.map((req) => (
                  <tr key={req._id}>
                    <td className="mono font-semibold text-brand-700">{req.requestNumber}</td>
                    <td>
                      <span className={`badge ${getRequestTypeColor(req.requestType)}`}>
                        {req.requestType}
                      </span>
                    </td>
                    <td>
                      <div className="flex items-center gap-2.5 min-w-[150px]">
                        <div className="h-8 w-8 shrink-0 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 border border-slate-200">
                          <User className="h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                          <div className="font-semibold text-slate-800 truncate">
                            {req.supervisor?.name || "System"}
                          </div>
                          <div className="text-[11px] text-slate-500 truncate">
                            {req.supervisor?.email || req.supervisor?.role}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div className="min-w-[160px]">
                        {req.rawType === "merge" ? (
                          <>
                            <div className="cell-title">Red Stock → Store Room</div>
                            <span className="text-[11px] text-slate-500">
                              <strong>{req.merge.totalQuantity} pcs</strong> across{" "}
                              {req.merge.itemCount} returned item(s)
                            </span>
                          </>
                        ) : (
                          <>
                            <div className="cell-title">
                              {req.rawType === "product"
                                ? req.details.name
                                : req.product?.name || "Unknown Product"}
                            </div>
                            {req.quantity && (
                              <span className="text-[11px] text-slate-500">
                                Qty:{" "}
                                <strong>
                                  {req.quantity} {req.product?.unit}
                                </strong>
                              </span>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                    <td className="text-[12px] text-slate-500 whitespace-nowrap">
                      {formatDate(req.createdDate)}
                    </td>
                    <td>
                      <span className={`badge badge-pill ${getStatusBadge(req.status)}`}>
                        {req.status}
                      </span>
                    </td>
                    <td>
                      <div className="flex items-center justify-end">
                        {/* Inspect Details */}
                        <button
                          onClick={() => openInspector(req)}
                          className="btn btn-sm btn-neutral"
                        >
                          <Eye className="h-3.5 w-3.5" /> Inspect
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ==============================================
          MODALS & INSPECTOR OVERLAY
          ============================================== */}

      {/* Backdrop */}
      {(inspectorOpen || actionModalOpen) && (
        <div className="modal-backdrop">

          {/* 1. Request Detail Inspector Overlay */}
          {inspectorOpen && selectedRequest && (
            <div className="modal max-w-2xl">
              <div className="modal-head">
                <div className="min-w-0">
                  <h3 className="modal-title">
                    <span className="truncate">Request {selectedRequest.requestNumber}</span>
                    <span className={`badge ${getStatusBadge(selectedRequest.status)}`}>
                      {selectedRequest.status}
                    </span>
                  </h3>
                  <p className="modal-sub">
                    {selectedRequest.requestType} · submitted by{" "}
                    {selectedRequest.supervisor?.name || "System"} ·{" "}
                    {formatDate(selectedRequest.createdDate)}
                  </p>
                </div>
                <button
                  onClick={() => setInspectorOpen(false)}
                  className="modal-close"
                  aria-label="Close"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="modal-body space-y-5">
                {/* Specific details based on Request Type */}

                {/* TYPE: STOCK MERGE — the only decision that moves stock out
                    of the Red Stock Room and into a store room. */}
                {selectedRequest.rawType === "merge" && (
                  <div className="space-y-4">
                    <div className="note note-violet flex-col gap-1">
                      <strong className="text-violet-700 flex items-center gap-1.5">
                        <GitMerge className="h-4 w-4" />
                        {selectedRequest.merge.createdVia === "Supervisor"
                          ? "Raised by a supervisor"
                          : "Weekly merge"}{" "}
                        • {selectedRequest.merge.weekKey}
                      </strong>
                      <span>
                        Approving moves{" "}
                        <strong>{selectedRequest.merge.totalQuantity} pcs</strong> out of the
                        Red Stock Room and into the store room you choose. Rejecting moves
                        nothing — the stock stays in Red Stock for the next merge.
                      </span>
                    </div>

                    {selectedRequest.status === "Pending" && (
                      <div className="note note-brand flex-col sm:flex-row sm:items-center gap-3 sm:justify-between">
                        <div>
                          <strong className="text-brand-700 flex items-center gap-1.5">
                            <Building2 className="h-4 w-4" /> Destination Store Room
                          </strong>
                          Every line below is credited to this room on approval.
                        </div>
                        <select
                          value={destinationRoom}
                          onChange={(e) => setDestinationRoom(e.target.value)}
                          className="field field-sm sm:w-52 shrink-0 cursor-pointer"
                          aria-label="Destination store room"
                        >
                          {rooms.length === 0 && <option value="">No stock rooms found</option>}
                          {rooms.map((room) => (
                            <option key={room._id} value={room.name}>
                              {room.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    <div className="rounded-xl border border-slate-200 divide-y divide-slate-100 max-h-64 overflow-y-auto">
                      {selectedRequest.merge.items.map((line) => (
                        <div
                          key={String(line.restockItem)}
                          className="px-4 py-3 flex items-center justify-between gap-3 text-xs"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <img
                              src={line.product?.image || PLACEHOLDER_IMAGE}
                              alt={line.productName}
                              className="w-8 h-8 rounded-lg object-cover border border-slate-200 shrink-0"
                            />
                            <div className="min-w-0">
                              <div className="font-semibold text-slate-800 truncate">
                                {line.productName}
                              </div>
                              <div className="font-mono text-[10px] text-slate-500">
                                {line.product?.code || "—"}
                              </div>
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <span className="font-bold text-emerald-600">
                              +{line.quantity} {line.unit}
                            </span>
                            {line.destinationRoom && (
                              <span className="block text-[10px] text-slate-500">
                                → {line.destinationRoom}
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>

                    {selectedRequest.status === "Approved" && (
                      <div className="note note-emerald">
                        Moved into <strong>{selectedRequest.merge.destinationRoom}</strong> on{" "}
                        {formatDate(selectedRequest.merge.reviewedAt)}.
                      </div>
                    )}
                  </div>
                )}

                {/* TYPE: ADD PRODUCT */}
                {selectedRequest.requestType === "Add Product" && (
                  <div className="space-y-4">
                    <div className="flex gap-4 p-4 bg-brand-50 rounded-xl border border-brand-500/15">
                      <img
                        src={selectedRequest.details.image || "https://images.unsplash.com/photo-1595246140707-1e5b22b271d4?w=80&auto=format"}
                        alt=""
                        className="w-20 h-20 shrink-0 rounded-xl object-cover border border-slate-200"
                      />
                      <div className="min-w-0">
                        <h4 className="text-[15px] font-semibold text-slate-900 leading-tight">
                          {selectedRequest.details.name}
                        </h4>
                        <span className="mono text-brand-700 mt-1 block">
                          CODE: {selectedRequest.details.code}
                        </span>
                        <span className="badge badge-slate badge-soft mt-2 bg-white">
                          To be saved in:&nbsp;<strong>{selectedRequest.details.storeRoom}</strong>
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="kv">
                        <span className="kv-label">Category</span>
                        <span className="kv-value">{selectedRequest.details.category}</span>
                      </div>
                      <div className="kv">
                        <span className="kv-label">Initial Quantity</span>
                        <span className="kv-value text-emerald-600">
                          {selectedRequest.details.quantity} {selectedRequest.details.unit}
                        </span>
                      </div>
                      <div className="kv">
                        <span className="kv-label">Min Stock Limit</span>
                        <span className="kv-value">
                          {selectedRequest.details.minStock} {selectedRequest.details.unit}
                        </span>
                      </div>
                    </div>

                    <div className="kv">
                      <span className="kv-label">Description</span>
                      <p className="text-[13px] text-slate-700 leading-relaxed">
                        {selectedRequest.details.description || "No description provided."}
                      </p>
                    </div>
                  </div>
                )}

                {/* TYPE: EDIT PRODUCT */}
                {selectedRequest.requestType === "Edit Product" && (
                  <div className="space-y-4">
                    <h4 className="eyebrow">Compare Values (Original vs Request)</h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {/* Current details */}
                      <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3">
                        <span className="eyebrow block border-b border-slate-200 pb-1.5">
                          Current Catalog Version
                        </span>
                        <div>
                          <span className="kv-label">Name</span>
                          <span className="kv-value text-slate-600">{selectedRequest.product?.name}</span>
                        </div>
                        <div>
                          <span className="kv-label">Category</span>
                          <span className="kv-value text-slate-600">{selectedRequest.product?.category}</span>
                        </div>
                        <div>
                          <span className="kv-label">Store Room</span>
                          <span className="kv-value text-slate-600">{selectedRequest.product?.storeRoom}</span>
                        </div>
                        <div>
                          <span className="kv-label">Min Stock</span>
                          <span className="kv-value text-slate-600">
                            {selectedRequest.product?.minStock}
                          </span>
                        </div>
                      </div>

                      {/* Requested edits */}
                      <div className="bg-brand-50 p-4 rounded-xl border border-brand-500/15 space-y-3">
                        <span className="eyebrow block border-b border-brand-500/15 pb-1.5 text-brand-700">
                          Proposed Updates
                        </span>
                        <div>
                          <span className="kv-label">Name</span>
                          <span className={`kv-value ${selectedRequest.product?.name !== selectedRequest.details.name ? "text-brand-700" : "text-slate-700"}`}>
                            {selectedRequest.details.name}
                          </span>
                        </div>
                        <div>
                          <span className="kv-label">Category</span>
                          <span className={`kv-value ${
                            selectedRequest.product?.category !== selectedRequest.details.category
                              ? "text-brand-700"
                              : "text-slate-700"
                          }`}>
                            {selectedRequest.details.category}
                          </span>
                        </div>
                        <div>
                          <span className="kv-label">Store Room</span>
                          <span className={`kv-value ${selectedRequest.product?.storeRoom !== selectedRequest.details.storeRoom ? "text-brand-700" : "text-slate-700"}`}>
                            {selectedRequest.details.storeRoom}
                          </span>
                        </div>
                        <div>
                          <span className="kv-label">Min Stock</span>
                          <span className={`kv-value ${
                            selectedRequest.product?.minStock !== selectedRequest.details.minStock
                              ? "text-brand-700"
                              : "text-slate-700"
                          }`}>
                            {selectedRequest.details.minStock}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* TYPE: STOCK IN / STOCK OUT / STOCK RETURN */}
                {(selectedRequest.requestType === "Stock In" || 
                  selectedRequest.requestType === "Stock Out" || 
                  selectedRequest.requestType === "Stock Return") && (
                  <div className="space-y-4">
                    <div className="flex gap-4 p-4 bg-slate-50 rounded-xl border border-slate-200">
                      <img
                        src={selectedRequest.product?.image || "https://images.unsplash.com/photo-1595246140707-1e5b22b271d4?w=80&auto=format"}
                        alt=""
                        className="w-16 h-16 shrink-0 rounded-xl object-cover border border-slate-200"
                      />
                      <div className="min-w-0 space-y-0.5">
                        <h4 className="text-[15px] font-semibold text-slate-900 truncate">
                          {selectedRequest.product?.name}
                        </h4>
                        <span className="mono text-slate-500 block">
                          Code: {selectedRequest.product?.code}
                        </span>
                        <span className="text-[12px] text-slate-600 block">
                          Location: <strong>{selectedRequest.product?.storeRoom}</strong>
                        </span>
                      </div>
                    </div>

                    {/* Before → change → after. Wraps to two rows on a phone
                        rather than squeezing three figures onto one. */}
                    <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl flex flex-wrap items-center gap-x-4 gap-y-3">
                      <div>
                        <span className="kv-label">Current Stock Level</span>
                        <span className="text-[15px] font-bold text-slate-800">
                          {selectedRequest.product?.quantity} {selectedRequest.product?.unit}
                        </span>
                      </div>

                      <ArrowRight className="h-4 w-4 text-slate-300 shrink-0" />

                      <div>
                        <span className="kv-label">
                          {selectedRequest.requestType === "Stock In" ? "Add Quantity" : selectedRequest.requestType === "Stock Out" ? "Deduct Quantity" : "To Red Stock"}
                        </span>
                        <span className={`text-[15px] font-bold ${
                          selectedRequest.requestType === "Stock In" || selectedRequest.requestType === "Stock Return"
                            ? "text-emerald-600"
                            : "text-rose-600"
                        }`}>
                          {selectedRequest.requestType === "Stock In" || selectedRequest.requestType === "Stock Return" ? "+" : "−"}
                          {selectedRequest.quantity} {selectedRequest.product?.unit}
                        </span>
                      </div>

                      <ArrowRight className="h-4 w-4 text-slate-300 shrink-0" />

                      <div>
                        <span className="kv-label">Resulting Stock</span>
                        <span className="text-[15px] font-bold text-slate-900">
                          {selectedRequest.requestType === "Stock Return"
                            ? selectedRequest.product?.quantity || 0
                            : selectedRequest.requestType === "Stock In"
                            ? (selectedRequest.product?.quantity || 0) + selectedRequest.quantity
                            : (selectedRequest.product?.quantity || 0) - selectedRequest.quantity}{" "}
                          {selectedRequest.product?.unit}
                        </span>
                      </div>
                    </div>

                    {/* Returned stock is parked, not added: store room balances
                        only move when the weekly merge is approved. */}
                    {selectedRequest.requestType === "Stock Return" && (
                      <div className="note note-rose">
                        <span>
                          Approving this puts{" "}
                          <strong>
                            {selectedRequest.quantity} {selectedRequest.product?.unit}
                          </strong>{" "}
                          into the <strong>Red Stock Room</strong>, not into a store room. It
                          reaches the Engineer Room or the Consumables Room only through an
                          approved merge.
                        </span>
                      </div>
                    )}

                    {/* Stock Out Check */}
                    {selectedRequest.requestType === "Stock Out" &&
                     (selectedRequest.product?.quantity || 0) < selectedRequest.quantity && (
                      <div className="note note-rose font-semibold text-rose-600">
                        <AlertTriangle className="h-4 w-4 shrink-0 mt-px" />
                        <span>
                          Current quantity is insufficient to fulfil this Stock Out request.
                          Approving it will leave the product on negative stock.
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {/* If approved/rejected, show administrative notes */}
                {selectedRequest.status !== "Pending" && (
                  <div className="kv bg-white">
                    <span className="kv-label font-semibold">Administrative Review Notes</span>
                    <p className="text-[13px] text-slate-700 italic leading-relaxed">
                      "{selectedRequest.adminComments || "No comment was supplied by administrator."}"
                    </p>
                  </div>
                )}
              </div>

              {/* Action Buttons for Pending request */}
              {selectedRequest.status === "Pending" && (
                <div className="modal-foot flex-wrap">
                  {/* A merge is decided outright — there is no pending state to
                      return it to without releasing the stock it holds. */}
                  {selectedRequest.rawType !== "merge" && (
                    <button
                      onClick={() => openActionModal(selectedRequest, "keep-pending")}
                      disabled={deciding}
                      className="btn btn-subtle mr-auto"
                    >
                      Keep Pending
                    </button>
                  )}
                  <button
                    onClick={() => openActionModal(selectedRequest, "reject")}
                    disabled={deciding}
                    className="btn btn-danger-soft"
                  >
                    Reject
                  </button>
                  <button
                    onClick={() => approveNow(selectedRequest)}
                    disabled={
                      deciding ||
                      (selectedRequest.requestType === "Stock Out" &&
                        (selectedRequest.product?.quantity || 0) < selectedRequest.quantity)
                    }
                    className="btn btn-success"
                  >
                    {deciding && <Loader2 className="h-4 w-4 animate-spin" />}
                    Approve
                  </button>
                </div>
              )}
            </div>
          )}

          {/* 2. Action Confirmation Modal (for commenting) */}
          {actionModalOpen && selectedRequest && (
            <div className="modal max-w-md">
              <div className="modal-head">
                <div className="min-w-0">
                  <h3 className="modal-title">
                    {actionType === "reject" ? "Reject" : "Keep Pending"} Request
                  </h3>
                  <p className="modal-sub">{selectedRequest.requestNumber}</p>
                </div>
                <button
                  onClick={() => setActionModalOpen(false)}
                  className="modal-close"
                  aria-label="Close"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <form onSubmit={handleActionSubmit} className="contents">
                <div className="modal-body space-y-4">
                <p className="text-[13px] text-slate-600 leading-relaxed">
                  {actionType === "reject"
                    ? "Say why this is being rejected. The reason is sent back to supervisor "
                    : "Note why this is being held. The note is sent back to supervisor "}
                  <strong>{selectedRequest.supervisor?.name}</strong>.
                </p>

                <div>
                  <label className="field-label">
                    Admin Feedback / Comments {actionType === "reject" ? "*" : ""}
                  </label>
                  <div className="relative">
                    <span className="absolute top-3 left-3.5 text-slate-400 pointer-events-none">
                      <MessageSquare className="h-4 w-4" />
                    </span>
                    <textarea
                      value={adminComments}
                      onChange={(e) => setAdminComments(e.target.value)}
                      required={actionType === "reject"}
                      rows="3"
                      placeholder={
                        actionType === "reject"
                          ? "Explain why the request is rejected (required)…"
                          : "Leave a comment (optional)…"
                      }
                      className="field field-area field-search"
                    ></textarea>
                  </div>
                </div>
                </div>

                <div className="modal-foot">
                  <button
                    type="button"
                    onClick={() => setActionModalOpen(false)}
                    className="btn btn-neutral"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={deciding}
                    className={`btn ${actionType === "reject" ? "btn-danger" : "btn-primary"}`}
                  >
                    {deciding && <Loader2 className="h-4 w-4 animate-spin" />}
                    Confirm {actionType === "reject" ? "Rejection" : "Hold"}
                  </button>
                </div>
              </form>
            </div>
          )}

        </div>
      )}

    </div>
  );
};

export default RequestManagement;
