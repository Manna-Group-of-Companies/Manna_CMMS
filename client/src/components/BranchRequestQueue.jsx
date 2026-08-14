import { useEffect, useMemo, useState } from "react";
import API from "../services/api";
import { useNotifications } from "../context/NotificationContext";
import useAutoRefresh from "../hooks/useAutoRefresh";
import {
  RequestStatusBadge,
  ApprovalStages,
  RequestHistory,
  formatActorStamp,
} from "./RequestStatus";
import {
  Loader2,
  Check,
  X,
  Boxes,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  Warehouse,
} from "lucide-react";

/**
 * The branch request queue as an approver sees it.
 *
 * Both approval stages behave the same way — read the queue, decide the one
 * stage that is yours, and see the whole trail either way — so the Admin and
 * Supervisor portals share this component and differ only by [stage].
 */
const STAGE_CONFIG = {
  Admin: {
    myStatus: "Pending Admin",
    endpoint: (id) => `/branch-requests/${id}/admin`,
    title: "Branch Requests — Admin Approval",
    blurb: "First approval. Approved requests move on to the Supervisor for final sign-off.",
    queueLabel: "Awaiting my approval",
    otherLabel: "With the Supervisor",
    otherStatus: "Pending Supervisor",
    approveHint: "Approving passes this to the Supervisor. No stock moves yet.",
  },
  Supervisor: {
    myStatus: "Pending Supervisor",
    endpoint: (id) => `/branch-requests/${id}/supervisor`,
    title: "Branch Requests — Supervisor Approval",
    blurb: "Final approval. Approving releases the stock from the branch's room.",
    queueLabel: "Awaiting my approval",
    otherLabel: "With the Admin",
    otherStatus: "Pending Admin",
    approveHint: "Approving completes the request and deducts the quantity from the room.",
  },
};

const BranchRequestQueue = ({ stage }) => {
  const config = STAGE_CONFIG[stage];
  const { showToast } = useNotifications();

  const [loading, setLoading] = useState(true);
  const [requests, setRequests] = useState([]);
  const [tab, setTab] = useState("mine");
  const [expanded, setExpanded] = useState(null);
  // Per-request decision inputs, keyed by request id.
  const [drafts, setDrafts] = useState({});
  const [busyId, setBusyId] = useState(null);

  /** [silent] is used by the background poll: no error toast. */
  const fetchRequests = async ({ silent = false } = {}) => {
    try {
      const { data } = await API.get("/branch-requests");
      setRequests(data);
    } catch (error) {
      console.error("Error fetching branch requests:", error);
      if (!silent) showToast("Failed to load branch requests", "error");
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    fetchRequests();
  }, []);

  // The other portal decides the other stage; polling keeps this queue current.
  useAutoRefresh(() => fetchRequests({ silent: true }));

  const buckets = useMemo(
    () => ({
      mine: requests.filter((r) => r.status === config.myStatus),
      other: requests.filter((r) => r.status === config.otherStatus),
      approved: requests.filter((r) => r.status === "Approved"),
      closed: requests.filter((r) => r.status === "Rejected" || r.status === "Cancelled"),
      all: requests,
    }),
    [requests, config]
  );

  const tabs = [
    { key: "mine", label: config.queueLabel, count: buckets.mine.length },
    { key: "other", label: config.otherLabel, count: buckets.other.length },
    { key: "approved", label: "Completed", count: buckets.approved.length },
    { key: "closed", label: "Rejected / Withdrawn", count: buckets.closed.length },
    { key: "all", label: "All", count: buckets.all.length },
  ];

  const draftFor = (request) =>
    drafts[request._id] || {
      quantity: request.approvedQuantity ?? request.quantity,
      comment: "",
    };

  // Merged onto the defaults, not onto whatever happens to be in state, or
  // typing a remark first would drop the quantity and leave the input
  // uncontrolled.
  const setDraft = (request, patch) =>
    setDrafts((prev) => ({
      ...prev,
      [request._id]: {
        quantity: request.approvedQuantity ?? request.quantity,
        comment: "",
        ...prev[request._id],
        ...patch,
      },
    }));

  const decide = async (request, action) => {
    const draft = draftFor(request);

    if (action === "reject" && !draft.comment.trim()) {
      showToast("Add a reason before rejecting", "error");
      return;
    }

    setBusyId(request._id);
    try {
      const { data } = await API.put(config.endpoint(request._id), {
        action,
        comment: draft.comment,
        approvedQuantity: action === "approve" ? Number(draft.quantity) : undefined,
      });

      showToast(
        action === "approve"
          ? stage === "Admin"
            ? `${data.requestNumber} approved — sent to the Supervisor`
            : `${data.requestNumber} fully approved and released`
          : `${data.requestNumber} rejected`,
        action === "approve" ? "success" : "info"
      );

      setRequests((prev) => prev.map((r) => (r._id === data._id ? data : r)));
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[request._id];
        return next;
      });
    } catch (error) {
      showToast(error.response?.data?.message || "Could not record the decision", "error");
      // The queue may have moved under us — re-read it.
      fetchRequests({ silent: true });
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return (
      <div className="h-[60vh] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 text-brand-600 animate-spin" />
          <span className="text-sm font-medium text-slate-600">Loading branch requests...</span>
        </div>
      </div>
    );
  }

  const visible = buckets[tab] || [];

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="glass-premium p-6 rounded-2xl border border-slate-200 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="bg-brand-600/10 border border-brand-500/20 p-3 rounded-xl">
            <ClipboardList className="h-6 w-6 text-brand-700" />
          </div>
          <div>
            <h3 className="text-xl font-bold text-slate-900 tracking-tight">{config.title}</h3>
            <p className="text-xs text-slate-600 mt-1">{config.blurb}</p>
          </div>
        </div>
        <div className="text-center">
          <p className="text-3xl font-bold text-amber-600">{buckets.mine.length}</p>
          <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
            Waiting on you
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 p-1 rounded-xl bg-slate-100 border border-slate-200 w-fit">
        {tabs.map((option) => (
          <button
            key={option.key}
            onClick={() => setTab(option.key)}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              tab === option.key
                ? "bg-white text-brand-700 shadow-sm"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            {option.label} ({option.count})
          </button>
        ))}
      </div>

      {/* Requests */}
      {visible.length === 0 ? (
        <div className="glass-premium rounded-2xl border border-slate-200 flex flex-col items-center justify-center py-16 text-slate-500">
          <ClipboardList className="h-10 w-10 mb-3 opacity-50" />
          <p className="text-sm">Nothing here right now.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {visible.map((request) => {
            const isOpen = expanded === request._id;
            const actionable = request.status === config.myStatus;
            const draft = draftFor(request);
            const ceiling = request.approvedQuantity ?? request.quantity;

            // The populated ref is null once an account is deleted, so fall
            // back to the name the history snapshotted at decision time.
            const decidedBy = (stage, live) =>
              live?.name ||
              [...(request.history || [])].reverse().find((e) => e.stage === stage)?.byName ||
              "Pending";

            return (
              <div
                key={request._id}
                className={`glass-premium rounded-2xl border overflow-hidden ${
                  actionable ? "border-amber-500/30" : "border-slate-200"
                }`}
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
                      <p className="text-xs text-slate-600 mt-0.5 flex flex-wrap items-center gap-x-2">
                        <span className="font-semibold text-slate-800">
                          {request.quantity} {request.unit}
                        </span>
                        <span>· {request.branch?.name || "Branch"}</span>
                        <span className="inline-flex items-center gap-1">
                          <Warehouse className="h-3 w-3" />
                          {request.stockRoomName}
                        </span>
                        <span>· {request.stockAtRequest} in room when raised</span>
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <RequestStatusBadge status={request.status} />
                    <button
                      onClick={() => setExpanded(isOpen ? null : request._id)}
                      className="p-2 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-all cursor-pointer"
                      title={isOpen ? "Hide history" : "Show history"}
                    >
                      {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                {/* Stage chain, always visible */}
                <div className="px-5 pb-4">
                  <ApprovalStages request={request} />
                </div>

                {/* Decision panel — only for the stage this portal owns */}
                {actionable && (
                  <div className="px-5 py-4 border-t border-slate-200 bg-amber-500/5">
                    <p className="text-[11px] text-slate-600 mb-3">{config.approveHint}</p>
                    <div className="flex flex-wrap items-end gap-3">
                      <div>
                        <label className="block text-[10px] font-semibold text-slate-600 uppercase tracking-wider mb-1.5">
                          Approve quantity (max {ceiling})
                        </label>
                        <input
                          type="number"
                          min="1"
                          max={ceiling}
                          value={draft.quantity}
                          onChange={(e) => setDraft(request, { quantity: e.target.value })}
                          className="w-32 px-3 py-2 rounded-xl bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/20 transition-all"
                        />
                      </div>
                      <div className="flex-1 min-w-[240px]">
                        <label className="block text-[10px] font-semibold text-slate-600 uppercase tracking-wider mb-1.5">
                          Remark (required to reject)
                        </label>
                        <input
                          type="text"
                          value={draft.comment}
                          onChange={(e) => setDraft(request, { comment: e.target.value })}
                          placeholder="Reason or note for the branch"
                          className="w-full px-3 py-2 rounded-xl bg-white border border-slate-200 text-slate-900 placeholder-slate-400 text-sm focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/20 transition-all"
                        />
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => decide(request, "approve")}
                          disabled={busyId === request._id}
                          className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold shadow transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50"
                        >
                          {busyId === request._id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Check className="h-4 w-4" />
                          )}
                          Approve
                        </button>
                        <button
                          onClick={() => decide(request, "reject")}
                          disabled={busyId === request._id}
                          className="px-4 py-2 rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-600 hover:bg-rose-500/20 text-sm font-semibold transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50"
                        >
                          <X className="h-4 w-4" />
                          Reject
                        </button>
                      </div>
                    </div>
                  </div>
                )}

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
                          <p className="text-slate-500">Product code</p>
                          <p className="font-semibold text-slate-900">{request.productCode}</p>
                        </div>
                        <div>
                          <p className="text-slate-500">Requested by</p>
                          <p className="font-semibold text-slate-900">
                            {request.branch?.name}
                            {request.branch?.email && ` (${request.branch.email})`}
                          </p>
                        </div>
                        <div>
                          <p className="text-slate-500">Admin decision</p>
                          <p className="font-semibold text-slate-900">
                            {decidedBy("Admin", request.admin)}
                          </p>
                          {request.adminDecidedAt && (
                            <p className="text-[11px] text-slate-500">
                              {formatActorStamp(request.adminDecidedAt)}
                            </p>
                          )}
                        </div>
                        <div>
                          <p className="text-slate-500">Supervisor decision</p>
                          <p className="font-semibold text-slate-900">
                            {decidedBy("Supervisor", request.supervisor)}
                          </p>
                          {request.supervisorDecidedAt && (
                            <p className="text-[11px] text-slate-500">
                              {formatActorStamp(request.supervisorDecidedAt)}
                            </p>
                          )}
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
    </div>
  );
};

export default BranchRequestQueue;
