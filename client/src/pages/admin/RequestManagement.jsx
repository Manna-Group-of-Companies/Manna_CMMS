import { useEffect, useState } from "react";
import API from "../../services/api";
import { useNotifications } from "../../context/NotificationContext";
import useAutoRefresh from "../../hooks/useAutoRefresh";
import {
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  User,
  ClipboardList,
  Eye,
  X,
  MessageSquare,
  ArrowRight,
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

  const handleActionSubmit = async (e) => {
    e.preventDefault();
    if (actionType === "reject" && !adminComments.trim()) {
      showToast("A reason for rejection must be provided", "error");
      return;
    }

    // A merge is the only decision that moves stock between rooms, so it needs
    // a destination before it can be approved.
    if (selectedRequest.rawType === "merge" && actionType === "approve" && !destinationRoom) {
      showToast("Choose the store room this stock goes into", "error");
      return;
    }

    try {
      const id = selectedRequest._id;

      const { data } =
        selectedRequest.rawType === "merge"
          ? await API.put(
              `/merge-requests/${id}/${actionType}`,
              actionType === "approve"
                ? { comment: adminComments, destinationRoom }
                : { rejectionReason: adminComments }
            )
          : await API.put(`/requests/${selectedRequest.rawType}/${id}/${actionType}`, {
              adminComments,
            });

      showToast(
        data?.message ||
          `Request ${actionType === "approve" ? "Approved" : actionType === "reject" ? "Rejected" : "kept Pending"} successfully!`,
        "success"
      );

      setActionModalOpen(false);
      setInspectorOpen(false);
      setAdminComments("");
      fetchRequests();
    } catch (error) {
      showToast(error.response?.data?.message || "Failed to process request", "error");
    }
  };

  const openActionModal = (req, type) => {
    setSelectedRequest(req);
    setActionType(type);
    setAdminComments("");
    // Default to the room the whole merge would go to, then the first room.
    setDestinationRoom(req.merge?.destinationRoom || rooms[0]?.name || "");
    setActionModalOpen(true);
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

  const getRequestTypeColor = (type) => {
    switch (type) {
      case "Add Product":
        return "bg-brand-500/10 text-brand-700 border border-brand-500/20";
      case "Edit Product":
        return "bg-indigo-500/10 text-indigo-600 border border-indigo-500/20";
      case "Stock In":
        return "bg-emerald-500/10 text-emerald-600 border border-emerald-500/20";
      case "Stock Out":
        return "bg-rose-500/10 text-rose-600 border border-rose-500/20";
      case "Stock Merge":
        return "bg-violet-500/10 text-violet-700 border border-violet-500/20";
      default:
        return "bg-cyan-500/10 text-cyan-700 border border-cyan-500/20";
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
    <div className="space-y-6">
      {/* Header Panel */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-2xl glass-premium border border-slate-200">
        <div className="flex items-center gap-2">
          <ClipboardList className="h-5 w-5 text-brand-700" />
          <h3 className="text-lg font-bold text-slate-900">Office Approvals Console</h3>
        </div>

        {/* Tab Controls */}
        <div className="flex bg-slate-100 p-1.5 rounded-xl border border-slate-200">
          {["Pending", "Approved", "Rejected", "All"].map((tab) => (
            <button
              key={tab}
              onClick={() => setStatusFilter(tab)}
              className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
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

      {/* Requests Listing */}
      {loading ? (
        <div className="h-[40vh] flex items-center justify-center">
          <Loader2 className="h-7 w-7 text-brand-500 animate-spin" />
        </div>
      ) : filteredRequests.length === 0 ? (
        <div className="glass-premium p-12 text-center rounded-2xl border border-slate-200 flex flex-col items-center justify-center">
          <HelpCircle className="h-10 w-10 text-slate-400 mb-3" />
          <h3 className="text-base font-bold text-slate-900 mb-1">No requests found</h3>
          <p className="text-xs text-slate-500">
            No requests exist with status: <strong className="text-brand-700">{statusFilter}</strong>.
          </p>
        </div>
      ) : (
        <div className="glass-premium rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-medium text-xs uppercase tracking-wider">
                  <th className="py-4 px-6">Request Number</th>
                  <th className="py-4 px-6">Type</th>
                  <th className="py-4 px-6">Supervisor</th>
                  <th className="py-4 px-6">Product / Scope</th>
                  <th className="py-4 px-6">Submitted Date</th>
                  <th className="py-4 px-6">Status</th>
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
                      <span className={`px-2.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${getRequestTypeColor(req.requestType)}`}>
                        {req.requestType}
                      </span>
                    </td>
                    <td className="py-4 px-6 flex items-center gap-2">
                      <div className="h-7 w-7 rounded-full bg-slate-100 flex items-center justify-center text-xs text-slate-600 border border-slate-200">
                        <User className="h-3.5 w-3.5" />
                      </div>
                      <div>
                        <div className="font-semibold text-slate-800">{req.supervisor?.name || "System"}</div>
                        <div className="text-[10px] text-slate-500">
                          {req.supervisor?.email || req.supervisor?.role}
                        </div>
                      </div>
                    </td>
                    <td className="py-4 px-6 font-semibold text-slate-900">
                      {req.rawType === "merge" ? (
                        <>
                          Red Stock → Store Room
                          <span className="text-xs text-slate-600 block font-normal">
                            <strong>{req.merge.totalQuantity} pcs</strong> across{" "}
                            {req.merge.itemCount} returned item(s)
                          </span>
                        </>
                      ) : (
                        <>
                          {req.rawType === "product"
                            ? req.details.name
                            : req.product?.name || "Unknown Product"}
                          {req.quantity && (
                            <span className="text-xs text-slate-600 block font-normal">
                              Qty: <strong>{req.quantity} {req.product?.unit}</strong>
                            </span>
                          )}
                        </>
                      )}
                    </td>
                    <td className="py-4 px-6 text-xs text-slate-600">
                      {formatDate(req.createdDate)}
                    </td>
                    <td className="py-4 px-6">
                      <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${getStatusBadge(req.status)}`}>
                        {req.status}
                      </span>
                    </td>
                    <td className="py-4 px-6 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {/* Inspect Details */}
                        <button
                          onClick={() => {
                            setSelectedRequest(req);
                            setInspectorOpen(true);
                          }}
                          className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-xs font-semibold text-slate-700 hover:text-slate-900 flex items-center gap-1 cursor-pointer transition-all hover:bg-slate-100"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
          
          {/* 1. Request Detail Inspector Overlay */}
          {inspectorOpen && selectedRequest && (
            <div className="glass-premium w-full max-w-2xl rounded-2xl border border-slate-200 max-h-[90vh] overflow-y-auto shadow-2xl animate-fade-in text-left">
              <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-center">
                <div>
                  <h3 className="font-bold text-lg text-slate-900">Inspect Request: {selectedRequest.requestNumber}</h3>
                  <p className="text-xs text-slate-600">
                    Submitted by {selectedRequest.supervisor?.name || "System"}
                  </p>
                </div>
                <button
                  onClick={() => setInspectorOpen(false)}
                  className="p-1 rounded-lg hover:bg-slate-100 text-slate-600 hover:text-slate-900 cursor-pointer"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
                {/* Specific details based on Request Type */}

                {/* TYPE: STOCK MERGE — the only decision that moves stock out
                    of the Red Stock Room and into a store room. */}
                {selectedRequest.rawType === "merge" && (
                  <div className="space-y-4">
                    <div className="p-4 rounded-xl bg-violet-500/5 border border-violet-500/20 text-[11px] leading-relaxed text-slate-700">
                      <strong className="text-violet-700 flex items-center gap-1.5 mb-1">
                        <GitMerge className="h-3.5 w-3.5" />
                        {selectedRequest.merge.createdVia === "Supervisor"
                          ? "Raised by a supervisor"
                          : "Weekly merge"}{" "}
                        • {selectedRequest.merge.weekKey}
                      </strong>
                      Approving moves{" "}
                      <strong>{selectedRequest.merge.totalQuantity} pcs</strong> out of the
                      Red Stock Room and into the store room you choose. Rejecting moves
                      nothing — the stock stays in Red Stock for the next merge.
                    </div>

                    {selectedRequest.status === "Pending" && (
                      <div className="p-4 rounded-xl bg-brand-50 border border-brand-500/20 flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
                        <div className="text-[11px] text-slate-700 leading-relaxed">
                          <strong className="text-brand-700 flex items-center gap-1.5">
                            <Building2 className="h-3.5 w-3.5" /> Destination Store Room
                          </strong>
                          Every line below is credited to this room on approval.
                        </div>
                        <select
                          value={destinationRoom || rooms[0]?.name || ""}
                          onChange={(e) => setDestinationRoom(e.target.value)}
                          className="px-4 py-2 text-sm rounded-xl bg-white border border-slate-200 text-slate-900 focus:outline-none focus:border-brand-500 cursor-pointer shrink-0"
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

                    <div className="rounded-xl border border-slate-200 divide-y divide-slate-200 max-h-64 overflow-y-auto">
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
                      <div className="p-3 bg-emerald-50 border border-emerald-500/20 text-emerald-900 text-[11px] rounded-lg">
                        Moved into <strong>{selectedRequest.merge.destinationRoom}</strong> on{" "}
                        {formatDate(selectedRequest.merge.reviewedAt)}.
                      </div>
                    )}
                  </div>
                )}

                {/* TYPE: ADD PRODUCT */}
                {selectedRequest.requestType === "Add Product" && (
                  <div className="space-y-4">
                    <div className="flex gap-4 p-4 bg-brand-50 rounded-xl border border-brand-500/10">
                      <img
                        src={selectedRequest.details.image || "https://images.unsplash.com/photo-1595246140707-1e5b22b271d4?w=80&auto=format"}
                        alt={selectedRequest.details.name}
                        className="w-20 h-20 rounded-lg object-cover border border-slate-200"
                      />
                      <div>
                        <h4 className="text-base font-bold text-slate-900 leading-tight">{selectedRequest.details.name}</h4>
                        <span className="text-xs font-mono text-brand-700 mt-1 block">CODE: {selectedRequest.details.code}</span>
                        <span className="inline-block mt-2 px-2 py-0.5 rounded text-[10px] font-medium bg-white border border-slate-200 text-slate-600">
                          To be saved in: <strong>{selectedRequest.details.storeRoom}</strong>
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4 text-xs">
                      <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                        <span className="text-slate-500 block mb-0.5">Category</span>
                        <span className="font-semibold text-slate-800">{selectedRequest.details.category}</span>
                      </div>
                      <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                        <span className="text-slate-500 block mb-0.5">Initial Quantity</span>
                        <span className="font-bold text-emerald-600">{selectedRequest.details.quantity} {selectedRequest.details.unit}</span>
                      </div>
                      <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                        <span className="text-slate-500 block mb-0.5">Min Stock Limit</span>
                        <span className="font-semibold text-slate-800">{selectedRequest.details.minStock} {selectedRequest.details.unit}</span>
                      </div>
                      <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                        <span className="text-slate-500 block mb-0.5">Max Stock Limit</span>
                        <span className="font-semibold text-slate-800">{selectedRequest.details.maxStock} {selectedRequest.details.unit}</span>
                      </div>
                    </div>

                    <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 text-xs">
                      <span className="text-slate-500 block mb-1">Description</span>
                      <p className="text-slate-700 leading-relaxed">{selectedRequest.details.description || "No description provided."}</p>
                    </div>
                  </div>
                )}

                {/* TYPE: EDIT PRODUCT */}
                {selectedRequest.requestType === "Edit Product" && (
                  <div className="space-y-4">
                    <h4 className="text-sm font-semibold text-slate-600 uppercase tracking-wider mb-2">Compare Values (Original vs Request)</h4>
                    <div className="grid grid-cols-2 gap-4 text-xs">
                      {/* Current details */}
                      <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3">
                        <span className="text-xs font-bold text-slate-500 uppercase block border-b border-slate-200 pb-1">Current Catalog Version</span>
                        <div>
                          <span className="text-slate-500 block">Name</span>
                          <span className="font-semibold text-slate-700">{selectedRequest.product?.name}</span>
                        </div>
                        <div>
                          <span className="text-slate-500 block">Category</span>
                          <span className="font-semibold text-slate-700">{selectedRequest.product?.category}</span>
                        </div>
                        <div>
                          <span className="text-slate-500 block">Store Room</span>
                          <span className="font-semibold text-slate-700">{selectedRequest.product?.storeRoom}</span>
                        </div>
                        <div>
                          <span className="text-slate-500 block">Stock Bounds</span>
                          <span className="font-semibold text-slate-700">Min: {selectedRequest.product?.minStock} | Max: {selectedRequest.product?.maxStock}</span>
                        </div>
                      </div>

                      {/* Requested edits */}
                      <div className="bg-brand-50 p-4 rounded-xl border border-brand-500/10 space-y-3">
                        <span className="text-xs font-bold text-brand-700 uppercase block border-b border-brand-500/10 pb-1">Proposed Updates</span>
                        <div>
                          <span className="text-slate-500 block">Name</span>
                          <span className={`font-bold ${selectedRequest.product?.name !== selectedRequest.details.name ? "text-brand-700" : "text-slate-700"}`}>
                            {selectedRequest.details.name}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-500 block">Category</span>
                          <span className={`font-bold ${
                            selectedRequest.product?.category !== selectedRequest.details.category
                              ? "text-brand-700"
                              : "text-slate-700"
                          }`}>
                            {selectedRequest.details.category}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-500 block">Store Room</span>
                          <span className={`font-bold ${selectedRequest.product?.storeRoom !== selectedRequest.details.storeRoom ? "text-brand-700" : "text-slate-700"}`}>
                            {selectedRequest.details.storeRoom}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-500 block">Stock Bounds</span>
                          <span className={`font-bold ${
                            selectedRequest.product?.minStock !== selectedRequest.details.minStock || 
                            selectedRequest.product?.maxStock !== selectedRequest.details.maxStock 
                              ? "text-brand-700" 
                              : "text-slate-700"
                          }`}>
                            Min: {selectedRequest.details.minStock} | Max: {selectedRequest.details.maxStock}
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
                    <div className="flex gap-4 p-4 bg-slate-50 rounded-xl border border-slate-200 text-xs">
                      <img
                        src={selectedRequest.product?.image || "https://images.unsplash.com/photo-1595246140707-1e5b22b271d4?w=80&auto=format"}
                        alt={selectedRequest.product?.name}
                        className="w-16 h-16 rounded-lg object-cover border border-slate-200"
                      />
                      <div className="space-y-1">
                        <h4 className="text-sm font-bold text-slate-900">{selectedRequest.product?.name}</h4>
                        <span className="text-[10px] text-slate-500 font-mono block">Code: {selectedRequest.product?.code}</span>
                        <span className="text-[10px] text-slate-600 block">Location: <strong>{selectedRequest.product?.storeRoom}</strong></span>
                      </div>
                    </div>

                    <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between text-sm">
                      <div>
                        <span className="text-xs text-slate-500 block mb-0.5">Current Stock Level</span>
                        <span className="font-bold text-slate-800">
                          {selectedRequest.product?.quantity} {selectedRequest.product?.unit}
                        </span>
                      </div>
                      
                      <div className="flex items-center text-slate-400">
                        <ArrowRight className="h-5 w-5" />
                      </div>

                      <div>
                        <span className="text-xs text-slate-500 block mb-0.5">
                          {selectedRequest.requestType === "Stock In" ? "Add Quantity" : selectedRequest.requestType === "Stock Out" ? "Deduct Quantity" : "To Red Stock"}
                        </span>
                        <span className={`font-bold flex items-center gap-1 ${
                          selectedRequest.requestType === "Stock In" || selectedRequest.requestType === "Stock Return"
                            ? "text-emerald-600 font-bold"
                            : "text-rose-600 font-bold"
                        }`}>
                          {selectedRequest.requestType === "Stock In" || selectedRequest.requestType === "Stock Return" ? "+" : "-"}
                          {selectedRequest.quantity} {selectedRequest.product?.unit}
                        </span>
                      </div>

                      <div className="flex items-center text-slate-400">
                        <ArrowRight className="h-5 w-5" />
                      </div>

                      <div>
                        <span className="text-xs text-slate-500 block mb-0.5">Simulated Stock Output</span>
                        <span className="font-bold text-slate-900 border-b border-dashed border-slate-200 pb-0.5">
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
                      <div className="p-3 bg-rose-50 border border-rose-500/20 text-rose-900 text-[11px] leading-relaxed rounded-lg">
                        Approving this puts <strong>{selectedRequest.quantity}{" "}
                        {selectedRequest.product?.unit}</strong> into the{" "}
                        <strong>Red Stock Room</strong>, not into a store room. It reaches the
                        Engineer Room or the Consumables Room only through an approved merge.
                      </div>
                    )}

                    {/* Stock Out Check */}
                    {selectedRequest.requestType === "Stock Out" && 
                     (selectedRequest.product?.quantity || 0) < selectedRequest.quantity && (
                      <div className="p-3 bg-rose-50 border border-rose-500/20 text-rose-600 text-xs font-semibold rounded-lg">
                        ⚠️ High Alert: Current quantity is insufficient to fulfill this Stock Out request. Processing this approval will result in negative stock.
                      </div>
                    )}
                  </div>
                )}

                {/* If approved/rejected, show administrative notes */}
                {selectedRequest.status !== "Pending" && (
                  <div className="p-4 bg-white border border-slate-200 rounded-xl text-xs space-y-1.5">
                    <span className="text-slate-500 block font-semibold">Administrative Review Notes:</span>
                    <p className="text-slate-700 italic">
                      "{selectedRequest.adminComments || "No comment was supplied by administrator."}"
                    </p>
                  </div>
                )}
              </div>

              {/* Action Buttons for Pending request */}
              {selectedRequest.status === "Pending" && (
                <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex justify-end gap-3">
                  {/* A merge is decided outright — there is no pending state to
                      return it to without releasing the stock it holds. */}
                  {selectedRequest.rawType !== "merge" && (
                    <button
                      onClick={() => openActionModal(selectedRequest, "keep-pending")}
                      className="px-4 py-2 text-xs font-bold rounded-xl bg-slate-100 border border-slate-200 text-slate-600 hover:text-slate-900 cursor-pointer"
                    >
                      Keep Pending
                    </button>
                  )}
                  <button
                    onClick={() => openActionModal(selectedRequest, "reject")}
                    className="px-4 py-2 text-xs font-bold rounded-xl bg-rose-50 border border-rose-200 text-rose-600 hover:bg-rose-600 hover:text-white cursor-pointer transition-all"
                  >
                    Reject Request
                  </button>
                  <button
                    onClick={() => openActionModal(selectedRequest, "approve")}
                    disabled={selectedRequest.requestType === "Stock Out" && (selectedRequest.product?.quantity || 0) < selectedRequest.quantity}
                    className="px-4 py-2 text-xs font-bold rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50 cursor-pointer shadow-lg active:scale-98 transition-all"
                  >
                    Approve Request
                  </button>
                </div>
              )}
            </div>
          )}

          {/* 2. Action Confirmation Modal (for commenting) */}
          {actionModalOpen && selectedRequest && (
            <div className="glass-premium w-full max-w-md rounded-2xl border border-slate-200 max-h-[90vh] overflow-y-auto shadow-2xl animate-fade-in text-left">
              <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-center">
                <h3 className="font-bold text-slate-900 capitalize">
                  {actionType === "approve" ? "Approve" : actionType === "reject" ? "Reject" : "Set Pending"} Request
                </h3>
                <button
                  onClick={() => setActionModalOpen(false)}
                  className="p-1 rounded-lg hover:bg-slate-100 text-slate-600 hover:text-slate-900 cursor-pointer"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <form onSubmit={handleActionSubmit} className="p-6 space-y-4">
                <p className="text-xs text-slate-600 leading-relaxed">
                  Provide notes, comments, or a reason regarding this decision. This will be sent back to supervisor <strong>{selectedRequest.supervisor?.name}</strong>.
                </p>

                {/* Confirm where an approved merge lands before committing. */}
                {selectedRequest.rawType === "merge" && actionType === "approve" && (
                  <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-500/20 space-y-2">
                    <p className="text-[11px] text-emerald-900 leading-relaxed">
                      <strong>{selectedRequest.merge.totalQuantity} pcs</strong> across{" "}
                      {selectedRequest.merge.itemCount} item(s) leave the Red Stock Room and
                      are added to:
                    </p>
                    <select
                      value={destinationRoom}
                      onChange={(e) => setDestinationRoom(e.target.value)}
                      required
                      className="w-full px-4 py-2 text-sm rounded-xl bg-white border border-slate-200 text-slate-900 focus:outline-none focus:border-brand-500 cursor-pointer"
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

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                    Admin Feedback / Comments {actionType === "reject" ? "*" : ""}
                  </label>
                  <div className="relative">
                    <span className="absolute top-3 left-3 text-slate-500">
                      <MessageSquare className="h-4 w-4" />
                    </span>
                    <textarea
                      value={adminComments}
                      onChange={(e) => setAdminComments(e.target.value)}
                      required={actionType === "reject"}
                      rows="3"
                      placeholder={
                        actionType === "reject"
                          ? "Explain why the request is rejected (required)..."
                          : "Leave a comment (optional)..."
                      }
                      className="w-full pl-9 pr-4 py-2.5 text-sm rounded-xl bg-white border border-slate-200 text-slate-900 placeholder-slate-400 focus:outline-none focus:border-brand-500 resize-none"
                    ></textarea>
                  </div>
                </div>

                <div className="pt-4 border-t border-slate-200 flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setActionModalOpen(false)}
                    className="px-4 py-2 text-xs font-semibold rounded-xl bg-white border border-slate-200 text-slate-600 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className={`px-4 py-2 text-xs font-semibold rounded-xl cursor-pointer active:scale-98 transition-all ${
                      actionType === "approve"
                        ? "bg-emerald-600 hover:bg-emerald-500 text-white"
                        : actionType === "reject"
                        ? "bg-rose-600 hover:bg-rose-500 text-white"
                        : "bg-brand-600 hover:bg-brand-500 text-white"
                    }`}
                  >
                    Confirm {actionType === "approve" ? "Approval" : actionType === "reject" ? "Rejection" : "Pending State"}
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
