import { useEffect, useState } from "react";
import API from "../../services/api";
import { useNotifications } from "../../context/NotificationContext";
import useAutoRefresh from "../../hooks/useAutoRefresh";
import {
  Loader2,
  PackageOpen,
  Calendar,
  HelpCircle,
  Building2,
  GitMerge,
  UserRound,
} from "lucide-react";

const STATUS_TABS = ["All", "In Red Stock", "Weekly Merge Pending", "Moved to Stock Room"];

/**
 * Returns of the caller's own this screen will offer to merge.
 *
 * "Weekly Merge Pending" is in here because a supervisor is never blocked by the
 * Admin's sweep: the server takes their returns back out of an open weekly merge
 * and applies their merge on the spot. Leaving it out would grey the button
 * out — the one moment they most need it — over a claim the server gives up.
 */
const MERGEABLE_STATUSES = ["In Red Stock", "Weekly Merge Pending"];

/**
 * The whole Red Stock Room — every supervisor's returns, what came back, who
 * returned it and when. A return needs no approval, it is in the room straight
 * away, so this screen tracks how far each one has moved through the merge
 * afterwards. Asking for a merge stays own-scoped: the server only ever picks
 * up the caller's own items, so the button is counted against those.
 */
const MyReturns = () => {
  const { showToast } = useNotifications();
  const [items, setItems] = useState([]);
  const [merges, setMerges] = useState([]);
  const [loading, setLoading] = useState(true);
  const [merging, setMerging] = useState(false);
  const [statusFilter, setStatusFilter] = useState("All");
  const [scope, setScope] = useState("All"); // All | Mine

  /** [silent] is used by the background poll: no spinner, no error toast. */
  const fetchItems = async ({ silent = false } = {}) => {
    try {
      if (!silent) setLoading(true);
      const [itemsRes, mergesRes] = await Promise.all([
        API.get("/red-stock"),
        // Older servers do not serve this yet; the returns list matters more.
        API.get("/merge-requests/mine").catch(() => ({ data: [] })),
      ]);
      setItems(itemsRes.data);
      setMerges(mergesRes.data);
    } catch (error) {
      console.error("Error loading returns:", error);
      if (!silent) showToast("Failed to load your returns", "error");
    } finally {
      if (!silent) setLoading(false);
    }
  };

  /**
   * Merges this supervisor's Red Stock into the main store room, applied
   * immediately without waiting for Admin approval.
   */
  const requestMerge = async () => {
    try {
      setMerging(true);
      const { data } = await API.post("/merge-requests/mine", {});
      showToast(data.message || "Merged out of Red Stock", "success");
      fetchItems();
    } catch (error) {
      console.error("Error merging Red Stock:", error);
      showToast(error.response?.data?.message || "Could not merge the Red Stock", "error");
    } finally {
      setMerging(false);
    }
  };

  useEffect(() => {
    fetchItems();
  }, []);

  // The Admin's weekly merge, or another supervisor's, can move this room's
  // stock from elsewhere, so re-read on a timer.
  useAutoRefresh(() => fetchItems({ silent: true }));

  const getStatusBadge = (status) => {
    switch (status) {
      case "Moved to Stock Room":
        return "bg-emerald-500/10 text-emerald-600 border border-emerald-500/20";
      case "Weekly Merge Pending":
        return "bg-indigo-500/10 text-indigo-600 border border-indigo-500/20";
      default:
        return "bg-rose-500/10 text-rose-600 border border-rose-500/20";
    }
  };

  const getConditionBadge = (condition) => {
    switch (condition) {
      case "Good":
        return "bg-emerald-500/10 text-emerald-600 border border-emerald-500/20";
      case "Repairable":
        return "bg-amber-500/10 text-amber-600 border border-amber-500/20";
      default:
        return "bg-rose-500/10 text-rose-600 border border-rose-500/20";
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

  // Scope narrows who returned it; the status tabs then narrow that.
  const scopedItems = scope === "Mine" ? items.filter((item) => item.isMine) : items;

  const filteredItems =
    statusFilter === "All"
      ? scopedItems
      : scopedItems.filter((item) => item.status === statusFilter);

  const inRedStock = items.filter((item) => item.status !== "Moved to Stock Room").length;
  const myItemCount = items.filter((item) => item.isMine).length;

  // What a merge would cover: the caller's own returns still in the Red Stock
  // Room. Someone else's returns are visible here but not mergeable —
  // `requestSupervisorMerge` filters on `returnedBy` server-side.
  const awaiting = items.filter(
    (item) => item.isMine && MERGEABLE_STATUSES.includes(item.status)
  );
  const awaitingQuantity = awaiting.reduce((sum, item) => sum + item.quantity, 0);

  // A supervisor's own merge applies on the spot, so this is the last one and it
  // is Approved. Pending only ever means a row an older server left behind,
  // which the Admin still has to place.
  const latestMerge = merges.find((merge) => merge.status === "Pending Approval") || merges[0];

  const mergeSummary = (merge) => {
    if (merge.status === "Approved") {
      return merge.destinationRoom
        ? `Merged into ${merge.destinationRoom} — in stock now`
        : "Merged into a store room — in stock now";
    }
    if (merge.status === "Rejected") {
      return merge.rejectionReason
        ? `Rejected: ${merge.rejectionReason}`
        : "Rejected — your stock stays in Red Stock";
    }
    // Older servers held a supervisor's merge for the Admin; nothing raised
    // here reaches this state now.
    return "Waiting for the Admin to choose a store room";
  };

  const mergeTone = (status) => {
    switch (status) {
      case "Approved":
        return "bg-emerald-500/10 text-emerald-700 border-emerald-500/20";
      case "Rejected":
        return "bg-rose-500/10 text-rose-700 border-rose-500/20";
      default:
        return "bg-indigo-500/10 text-indigo-700 border-indigo-500/20";
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-2xl glass-premium border border-slate-200">
        <div className="flex items-center gap-2">
          <PackageOpen className="h-5 w-5 text-rose-600" />
          <div>
            <h3 className="text-lg font-bold text-slate-900">Red Stock Room</h3>
            <p className="text-xs text-slate-500">
              {inRedStock} sitting in the Red Stock Room until the weekly merge •{" "}
              {myItemCount} of {items.length} returned by you
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex bg-slate-100 p-1.5 rounded-xl border border-slate-200">
            {["All", "Mine"].map((tab) => (
              <button
                key={tab}
                onClick={() => setScope(tab)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                  scope === tab
                    ? "bg-brand-600 text-white shadow"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                {tab === "All" ? "All Supervisors" : "Returned by Me"}
              </button>
            ))}
          </div>

          <button
            onClick={requestMerge}
            disabled={merging || awaiting.length === 0}
            title={
              awaiting.length === 0
                ? "Nothing of yours is sitting in Red Stock"
                : "Merge your Red Stock back into the store rooms"
            }
            className="px-4 py-2 rounded-xl text-xs font-bold text-white bg-rose-600 hover:bg-rose-500 disabled:bg-slate-200 disabled:text-slate-500 disabled:cursor-not-allowed inline-flex items-center gap-2 cursor-pointer shadow active:scale-98 transition-all"
          >
            {merging ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <GitMerge className="h-3.5 w-3.5" />
            )}
            {awaiting.length === 0
              ? "Nothing to merge"
              : `Merge ${awaitingQuantity} pcs to Main Store`}
          </button>

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
      </div>

      {/* Where the supervisor's own merge request stands */}
      {latestMerge && (
        <div
          className={`p-4 rounded-2xl border text-xs flex flex-wrap items-center gap-x-3 gap-y-1.5 ${mergeTone(
            latestMerge.status
          )}`}
        >
          <GitMerge className="h-4 w-4 shrink-0" />
          <span className="font-mono font-bold">{latestMerge.requestId}</span>
          <span className="font-semibold">{mergeSummary(latestMerge)}</span>
          <span className="text-slate-500">
            {latestMerge.totalQuantity} pcs • {latestMerge.itemCount} item(s) •{" "}
            {formatDate(latestMerge.reviewedAt || latestMerge.requestedAt)}
          </span>
        </div>
      )}

      {loading ? (
        <div className="h-[40vh] flex items-center justify-center">
          <Loader2 className="h-7 w-7 text-brand-500 animate-spin" />
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="glass-premium p-12 text-center rounded-2xl border border-slate-200 flex flex-col items-center justify-center">
          <HelpCircle className="h-10 w-10 text-slate-400 mb-3" />
          <h3 className="text-base font-bold text-slate-900 mb-1">
            {scope === "Mine" ? "You have no returns here" : "No returns found"}
          </h3>
          <p className="text-xs text-slate-500">
            Return issued stock from the Issue History — it goes straight into the Red Stock
            Room.
          </p>
        </div>
      ) : (
        <div className="glass-premium rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-medium text-xs uppercase tracking-wider">
                  <th className="py-4 px-6">Return #</th>
                  <th className="py-4 px-6">Product</th>
                  <th className="py-4 px-6 text-center">Qty</th>
                  <th className="py-4 px-6 text-center">Condition</th>
                  <th className="py-4 px-6">Returned By</th>
                  <th className="py-4 px-6">Returned On</th>
                  <th className="py-4 px-6 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-slate-700">
                {filteredItems.map((item) => (
                  <tr key={item._id} className="hover:bg-slate-50 transition-colors">
                    <td className="py-4 px-6 font-mono text-xs text-rose-600 font-bold">
                      {item.restockNumber}
                    </td>
                    <td className="py-4 px-6">
                      <div className="flex items-center gap-3">
                        <img
                          src={
                            item.product?.image ||
                            "https://images.unsplash.com/photo-1595246140707-1e5b22b271d4?w=50&auto=format"
                          }
                          alt={item.productName}
                          className="w-9 h-9 rounded-lg object-cover border border-slate-200"
                        />
                        <div>
                          <div className="font-bold text-slate-900">{item.productName}</div>
                          <div className="text-[10px] font-mono text-brand-700 flex items-center gap-1">
                            {item.productCode || "—"}
                            {item.sourceRoom && (
                              <>
                                <Building2 className="h-2.5 w-2.5 opacity-70" />
                                from {item.sourceRoom}
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="py-4 px-6 text-center">
                      <span className="bg-rose-500/10 text-rose-600 border border-rose-500/20 px-2.5 py-0.5 rounded text-xs font-bold">
                        {item.quantity} {item.unit}
                      </span>
                    </td>
                    <td className="py-4 px-6 text-center">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${getConditionBadge(
                          item.condition
                        )}`}
                      >
                        {item.condition}
                      </span>
                    </td>
                    <td className="py-4 px-6">
                      <span
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold ${
                          item.isMine
                            ? "bg-brand-500/10 text-brand-700 border border-brand-500/20"
                            : "bg-slate-100 text-slate-700 border border-slate-200"
                        }`}
                      >
                        <UserRound className="h-3.5 w-3.5 opacity-70" />
                        {item.returnedBy?.name || "Unknown"}
                        {item.isMine && <span className="text-[10px] opacity-70">(you)</span>}
                      </span>
                      {item.department && (
                        <span className="block mt-1 text-[10px] text-slate-500">
                          from {item.department}
                        </span>
                      )}
                    </td>
                    <td className="py-4 px-6 text-xs text-slate-600">
                      <span className="flex items-center gap-1.5">
                        <Calendar className="h-3.5 w-3.5 opacity-65" />
                        {formatDate(item.returnDate)}
                      </span>
                    </td>
                    <td className="py-4 px-6 text-center">
                      <span
                        className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${getStatusBadge(
                          item.status
                        )}`}
                      >
                        {item.status === "In Red Stock" ? "Returned / In Red Stock" : item.status}
                      </span>
                      {item.destinationRoom && (
                        <span className="block mt-1 text-[10px] text-emerald-600 font-semibold">
                          → {item.destinationRoom}
                        </span>
                      )}
                      {item.status === "In Red Stock" && item.lastRejection?.reason && (
                        <span className="block mt-1 text-[10px] text-rose-600 italic max-w-[180px] truncate mx-auto">
                          Merge rejected: {item.lastRejection.reason}
                        </span>
                      )}
                      {item.mergeRequest?.requestId && (
                        <span className="block mt-1 text-[10px] font-mono text-slate-500">
                          {item.mergeRequest.requestId}
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
    </div>
  );
};

export default MyReturns;
