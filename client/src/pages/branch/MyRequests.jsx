import { useEffect, useMemo, useState } from "react";
import API from "../../services/api";
import { useNotifications } from "../../context/NotificationContext";
import useAutoRefresh from "../../hooks/useAutoRefresh";
import RequestFormModal from "./RequestFormModal";
import {
  RequestStatusBadge,
  ApprovalStages,
  RequestHistory,
  metaFor,
} from "../../components/RequestStatus";
import {
  Loader2,
  Plus,
  ClipboardList,
  ChevronDown,
  ChevronUp,
  Trash2,
  Boxes,
} from "lucide-react";

/** Filters over the branch's own queue. */
const FILTERS = [
  { key: "All", label: "All", match: () => true },
  { key: "Open", label: "In Progress", match: (r) => metaFor(r.status).step > 0 && r.status !== "Approved" },
  { key: "Pending Admin", label: "Pending Admin", match: (r) => r.status === "Pending Admin" },
  { key: "Pending Supervisor", label: "Supervisor Pending", match: (r) => r.status === "Pending Supervisor" },
  { key: "Approved", label: "Approved", match: (r) => r.status === "Approved" },
  { key: "Rejected", label: "Rejected", match: (r) => r.status === "Rejected" },
];

/**
 * The branch engineer's own request queue: raise one, follow it through both
 * approvals, and read the full decision trail.
 */
const MyRequests = () => {
  const { showToast } = useNotifications();

  const [loading, setLoading] = useState(true);
  const [requests, setRequests] = useState([]);
  const [items, setItems] = useState([]);
  const [filter, setFilter] = useState("All");
  const [expanded, setExpanded] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);

  /** [silent] is used by the background poll: no error toast. */
  const fetchAll = async ({ silent = false } = {}) => {
    try {
      const [mine, stock] = await Promise.all([
        API.get("/branch-requests/mine"),
        API.get("/dashboard/branch"),
      ]);
      setRequests(mine.data);
      setItems(stock.data.items || []);
    } catch (error) {
      console.error("Error fetching branch requests:", error);
      if (!silent) showToast("Failed to load your requests", "error");
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
  }, []);

  // Approvals happen in the other two portals; polling shows the stage move.
  useAutoRefresh(() => fetchAll({ silent: true }));

  const counts = useMemo(
    () => ({
      pendingAdmin: requests.filter((r) => r.status === "Pending Admin").length,
      pendingSupervisor: requests.filter((r) => r.status === "Pending Supervisor").length,
      approved: requests.filter((r) => r.status === "Approved").length,
      rejected: requests.filter((r) => r.status === "Rejected").length,
    }),
    [requests]
  );

  const visible = useMemo(() => {
    const rule = FILTERS.find((f) => f.key === filter) || FILTERS[0];
    return requests.filter(rule.match);
  }, [requests, filter]);

  const withdraw = async (request) => {
    if (!window.confirm(`Withdraw request ${request.requestNumber}?`)) return;
    try {
      await API.delete(`/branch-requests/${request._id}`);
      showToast(`Request ${request.requestNumber} withdrawn`, "success");
      fetchAll({ silent: true });
    } catch (error) {
      showToast(error.response?.data?.message || "Could not withdraw the request", "error");
    }
  };

  if (loading) {
    return (
      <div className="h-[60vh] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 text-brand-600 animate-spin" />
          <span className="text-sm font-medium text-slate-600">Loading your requests...</span>
        </div>
      </div>
    );
  }

  const summary = [
    { label: "Pending Admin", value: counts.pendingAdmin, tone: "text-amber-600" },
    { label: "Supervisor Pending", value: counts.pendingSupervisor, tone: "text-indigo-600" },
    { label: "Approved", value: counts.approved, tone: "text-emerald-600" },
    { label: "Rejected", value: counts.rejected, tone: "text-rose-600" },
  ];

  return (
    <div className="space-y-8">
      {/* Header + stage summary */}
      <div className="glass-premium p-6 rounded-2xl border border-slate-200 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="bg-brand-600/10 border border-brand-500/20 p-3 rounded-xl">
            <ClipboardList className="h-6 w-6 text-brand-700" />
          </div>
          <div>
            <h3 className="text-xl font-bold text-slate-900 tracking-tight">My Engineering Stock Requests</h3>
            <p className="text-xs text-slate-600 mt-1">
              Admin approval first, then Supervisor approval completes the request.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-6">
          {summary.map((entry) => (
            <div key={entry.label} className="text-center">
              <p className={`text-2xl font-bold ${entry.tone}`}>{entry.value}</p>
              <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
                {entry.label}
              </p>
            </div>
          ))}
          <button
            onClick={() => setModalOpen(true)}
            className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-brand-600 to-brand-700 hover:from-brand-500 hover:to-brand-600 text-white text-sm font-semibold shadow-lg transition-all flex items-center gap-2 cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            New Request
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-1 p-1 rounded-xl bg-slate-100 border border-slate-200 w-fit">
        {FILTERS.map((option) => (
          <button
            key={option.key}
            onClick={() => setFilter(option.key)}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              filter === option.key
                ? "bg-white text-brand-700 shadow-sm"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            {option.label} ({requests.filter(option.match).length})
          </button>
        ))}
      </div>

      {/* Request list */}
      {visible.length === 0 ? (
        <div className="glass-premium rounded-2xl border border-slate-200 flex flex-col items-center justify-center py-16 text-slate-500">
          <ClipboardList className="h-10 w-10 mb-3 opacity-50" />
          <p className="text-sm">
            {requests.length === 0
              ? "You have not raised any requests yet."
              : "No requests match this filter."}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {visible.map((request) => {
            const isOpen = expanded === request._id;
            return (
              <div
                key={request._id}
                className="glass-premium rounded-2xl border border-slate-200 overflow-hidden"
              >
                <div className="p-5 flex flex-wrap items-center justify-between gap-4">
                  <div className="flex items-center gap-4 min-w-0">
                    {request.product?.image ? (
                      <img
                        src={request.product.image}
                        alt={request.productName}
                        className="h-12 w-12 rounded-xl object-cover border border-slate-200"
                      />
                    ) : (
                      <div className="h-12 w-12 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center">
                        <Boxes className="h-5 w-5 text-slate-500" />
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="text-sm font-bold text-slate-900 truncate">
                          {request.productName}
                        </h4>
                        <span className="text-[11px] text-slate-500">
                          #{request.requestNumber}
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 mt-0.5">
                        {request.quantity} {request.unit} requested
                        {request.approvedQuantity && request.approvedQuantity !== request.quantity
                          ? ` · ${request.approvedQuantity} approved`
                          : ""}{" "}
                        · {request.stockRoomName}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <RequestStatusBadge status={request.status} />
                    {request.status === "Pending Admin" && (
                      <button
                        onClick={() => withdraw(request)}
                        className="p-2 rounded-lg text-slate-500 hover:text-rose-600 hover:bg-rose-500/10 transition-all cursor-pointer"
                        title="Withdraw request"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                    <button
                      onClick={() => setExpanded(isOpen ? null : request._id)}
                      className="p-2 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-all cursor-pointer"
                      title={isOpen ? "Hide history" : "Show history"}
                    >
                      {isOpen ? (
                        <ChevronUp className="h-4 w-4" />
                      ) : (
                        <ChevronDown className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </div>

                {/* Stage chain, always visible */}
                <div className="px-5 pb-4">
                  <ApprovalStages request={request} />
                </div>

                {/* Full trail */}
                {isOpen && (
                  <div className="px-5 py-5 border-t border-slate-200 bg-slate-50/60 grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div>
                      <h5 className="text-xs font-bold uppercase tracking-wider text-slate-600 mb-3">
                        Approval History
                      </h5>
                      <RequestHistory history={request.history} />
                    </div>
                    <div className="space-y-3 text-xs">
                      <h5 className="text-xs font-bold uppercase tracking-wider text-slate-600">
                        Details
                      </h5>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <p className="text-slate-500">Engineering Stock code</p>
                          <p className="font-semibold text-slate-900">{request.productCode}</p>
                        </div>
                        <div>
                          <p className="text-slate-500">Room stock when raised</p>
                          <p className="font-semibold text-slate-900">{request.stockAtRequest}</p>
                        </div>
                        <div>
                          <p className="text-slate-500">Admin</p>
                          <p className="font-semibold text-slate-900">
                            {request.admin?.name || "Not decided yet"}
                          </p>
                        </div>
                        <div>
                          <p className="text-slate-500">Supervisor</p>
                          <p className="font-semibold text-slate-900">
                            {request.supervisor?.name || "Not decided yet"}
                          </p>
                        </div>
                      </div>
                      {request.purpose && (
                        <div>
                          <p className="text-slate-500">Purpose</p>
                          <p className="text-slate-800">{request.purpose}</p>
                        </div>
                      )}
                      {request.adminComments && (
                        <div>
                          <p className="text-slate-500">Admin remark</p>
                          <p className="text-slate-800">"{request.adminComments}"</p>
                        </div>
                      )}
                      {request.supervisorComments && (
                        <div>
                          <p className="text-slate-500">Supervisor remark</p>
                          <p className="text-slate-800">"{request.supervisorComments}"</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {modalOpen && (
        <RequestFormModal
          items={items}
          onClose={() => setModalOpen(false)}
          onSubmitted={() => fetchAll({ silent: true })}
        />
      )}
    </div>
  );
};

export default MyRequests;
