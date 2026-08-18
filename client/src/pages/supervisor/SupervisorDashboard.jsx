import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import API from "../../services/api";
import { useNotifications } from "../../context/NotificationContext";
import useAutoRefresh from "../../hooks/useAutoRefresh";
import {
  Boxes,
  Loader2,
  Clock,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Calendar,
  ClipboardCheck,
  Send,
  PackageOpen,
  UserRound,
} from "lucide-react";

const SupervisorDashboard = () => {
  const { showToast } = useNotifications();
  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState({
    totalProducts: 0,
    pendingRequests: 0,
    approvedRequests: 0,
    rejectedRequests: 0,
    lowStockProductsCount: 0,
    todayActivity: [],
    recentIssues: [],
  });

  /** [silent] is used by the background poll: no error toast. */
  const fetchDashboardData = async ({ silent = false } = {}) => {
    try {
      const { data } = await API.get("/dashboard/supervisor");
      setMetrics(data);
    } catch (error) {
      console.error("Error fetching supervisor dashboard:", error);
      if (!silent) showToast("Failed to fetch dashboard metrics", "error");
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboardData();
  }, []);

  // Counts move whenever the Admin decides a request.
  useAutoRefresh(() => fetchDashboardData({ silent: true }));

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

  const formatTime = (timeString) => {
    const date = new Date(timeString);
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  if (loading) {
    return (
      <div className="h-[60vh] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 text-emerald-600 animate-spin" />
          <span className="text-sm font-medium text-slate-600">Loading dashboard...</span>
        </div>
      </div>
    );
  }

  // Every card counts the whole store; `note` is this supervisor's share of it.
  const cards = [
    {
      title: "Total Engineering Stock",
      value: metrics.totalProducts,
      icon: Boxes,
      color: "from-brand-600/10 to-brand-400/10 border-brand-500/20 text-brand-700",
    },
    {
      // Stage two of the branch workflow lands here.
      title: "Branch Requests to Approve",
      value: metrics.branchPendingSupervisor || 0,
      icon: ClipboardCheck,
      link: "/supervisor/branch-approvals",
      color:
        metrics.branchPendingSupervisor > 0
          ? "from-indigo-600/10 to-blue-600/10 border-indigo-500/20 text-indigo-600"
          : "from-slate-50 to-slate-100 border-slate-200 text-slate-600",
    },
    {
      title: "Pending Approvals",
      value: metrics.pendingRequests,
      note: `${metrics.myPendingRequests || 0} raised by you`,
      icon: Clock,
      link: "/supervisor/requests",
      color: "from-amber-600/10 to-yellow-600/10 border-amber-500/20 text-amber-600",
    },
    {
      title: "Approved Requests",
      value: metrics.approvedRequests,
      note: `${metrics.myApprovedRequests || 0} raised by you`,
      icon: CheckCircle,
      link: "/supervisor/requests",
      color: "from-emerald-600/10 to-teal-600/10 border-emerald-500/20 text-emerald-600",
    },
    {
      title: "Rejected Requests",
      value: metrics.rejectedRequests,
      note: `${metrics.myRejectedRequests || 0} raised by you`,
      icon: XCircle,
      link: "/supervisor/requests",
      color: "from-rose-600/10 to-red-600/10 border-rose-500/20 text-rose-600",
    },
    {
      title: "Issued Today",
      value: metrics.issuedTodayCount || 0,
      note: `${metrics.myIssuedTodayCount || 0} issued by you`,
      icon: Send,
      link: "/supervisor/issues",
      color: "from-amber-600/10 to-orange-600/10 border-amber-500/20 text-amber-700",
    },
    {
      title: "In Red Stock",
      value: metrics.restockPendingCount || 0,
      note: `${metrics.restockPendingQuantity || 0} pcs • ${
        metrics.myRestockPendingCount || 0
      } returned by you`,
      icon: PackageOpen,
      link: "/supervisor/returns",
      color: "from-rose-600/10 to-pink-600/10 border-rose-500/20 text-rose-600",
    },
    {
      title: "Low Stock Items",
      value: metrics.lowStockProductsCount,
      icon: AlertTriangle,
      color: metrics.lowStockProductsCount > 0
        ? "from-amber-500/20 to-orange-500/20 border-amber-500/30 text-amber-600 animate-pulse"
        : "from-slate-50 to-slate-100 border-slate-200 text-slate-600",
    },
  ];

  return (
    <div className="space-y-8">
      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {cards.map((card, index) => {
          const Icon = card.icon;
          const body = (
            <div
              className={`p-6 rounded-2xl border bg-gradient-to-br ${card.color} shadow-sm h-full ${
                card.link ? "hover:shadow-md transition-all" : ""
              }`}
            >
              <div className="flex justify-between items-start">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-600">
                  {card.title}
                </p>
                <Icon className="h-5 w-5 opacity-80" />
              </div>
              <h3 className="text-3xl font-bold text-slate-900 mt-4 tracking-tight">
                {card.value}
              </h3>
              {card.note && (
                <p className="text-[11px] font-medium text-slate-500 mt-1">{card.note}</p>
              )}
            </div>
          );

          return card.link ? (
            <Link key={index} to={card.link} className="cursor-pointer">
              {body}
            </Link>
          ) : (
            <div key={index}>{body}</div>
          );
        })}
      </div>

      {/* Grid: Activities and Quick Links */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Today's Activity Timeline — every supervisor's requests */}
        <div className="lg:col-span-2 glass-premium p-6 rounded-2xl border border-slate-200 flex flex-col">
          <div className="flex items-center justify-between gap-2 mb-6">
            <div className="flex items-center gap-2">
              <Calendar className="h-5 w-5 text-emerald-600" />
              <h3 className="text-lg font-bold text-slate-900">Today's Activity Log</h3>
            </div>
            <span className="text-[11px] font-semibold text-slate-500">
              All supervisors • {metrics.todayActivity.length} today
            </span>
          </div>

          <div className="flex-1 space-y-4 max-h-[400px] overflow-y-auto pr-2">
            {metrics.todayActivity.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-slate-500 border border-dashed border-slate-200 rounded-xl">
                <Clock className="h-8 w-8 mb-2 opacity-50" />
                <p className="text-sm">No activity recorded today yet.</p>
              </div>
            ) : (
              metrics.todayActivity.map((activity) => (
                <div
                  key={activity._id}
                  className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-xl bg-slate-50 border border-slate-200 hover:border-slate-300 transition-all"
                >
                  <div className="flex items-center gap-4">
                    <span className="text-xs font-semibold text-slate-500">
                      {formatTime(activity.time)}
                    </span>
                    <div>
                      <h4 className="text-sm font-semibold text-slate-900">
                        {activity.productName}
                        {activity.quantity ? (
                          <span className="ml-1.5 text-xs font-bold text-slate-500">
                            ×{activity.quantity}
                          </span>
                        ) : null}
                      </h4>
                      <p className="text-xs text-slate-600 flex items-center gap-1.5">
                        {activity.requestType}
                        <span className="text-slate-300">•</span>
                        <UserRound className="h-3 w-3 opacity-70" />
                        <span className={activity.isMine ? "font-semibold text-brand-700" : ""}>
                          {activity.supervisorName}
                          {activity.isMine ? " (you)" : ""}
                        </span>
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-slate-500">
                      #{activity.requestNumber}
                    </span>
                    <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${getStatusBadge(activity.status)}`}>
                      {activity.status}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Latest issues out of the store, whoever made them */}
        <div className="glass-premium p-6 rounded-2xl border border-slate-200 flex flex-col">
          <div className="flex items-center gap-2 mb-6">
            <Send className="h-5 w-5 text-amber-600" />
            <h3 className="text-lg font-bold text-slate-900">Latest Issues</h3>
          </div>

          <div className="flex-1 space-y-3 max-h-[400px] overflow-y-auto pr-2">
            {(metrics.recentIssues || []).length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-slate-500 border border-dashed border-slate-200 rounded-xl">
                <Send className="h-8 w-8 mb-2 opacity-50" />
                <p className="text-sm text-center">Nothing has been issued yet.</p>
              </div>
            ) : (
              metrics.recentIssues.map((issue) => (
                <div
                  key={issue._id}
                  className="p-3 rounded-xl bg-slate-50 border border-slate-200 hover:border-slate-300 transition-all"
                >
                  <div className="flex items-start justify-between gap-2">
                    <h4 className="text-sm font-semibold text-slate-900 leading-tight">
                      {issue.product?.name || "Deleted Engineering Stock"}
                    </h4>
                    <span className="shrink-0 bg-amber-500/10 text-amber-600 border border-amber-500/20 px-2 py-0.5 rounded text-[10px] font-bold">
                      −{issue.quantity} {issue.product?.unit || ""}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-slate-600">
                    to <strong className="text-slate-700">{issue.recipient}</strong> by{" "}
                    {issue.supervisor?.name || "Unknown"}
                  </p>
                  <p className="mt-0.5 text-[10px] text-slate-500 font-mono">
                    {issue.issueNumber} • {formatTime(issue.createdAt)}
                  </p>
                </div>
              ))
            )}
          </div>

          <Link
            to="/supervisor/issues"
            className="mt-4 pt-4 border-t border-slate-200 text-xs font-semibold text-brand-700 hover:text-brand-600 transition-colors"
          >
            View the full issue history →
          </Link>
        </div>
      </div>

      {/* Quick Instructions / Store Status */}
      <div className="glass-premium p-6 rounded-2xl border border-slate-200">
        <h3 className="text-lg font-bold text-slate-900 mb-4">Supervisor Guidance</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-slate-600 leading-relaxed">
          <div className="p-3 bg-indigo-50 border border-indigo-500/10 rounded-lg">
            <p className="font-semibold text-indigo-600 mb-1">Request-Only Catalog updates</p>
            As a Store Supervisor, you cannot modify products directly. Every addition or modification submits a request to the office Admin for approval.
          </div>
          <div className="p-3 bg-emerald-50 border border-emerald-500/10 rounded-lg">
            <p className="font-semibold text-emerald-700 mb-1">Quantity Audits</p>
            Before requesting a "Stock Out", ensure that there is sufficient stock quantity. Reducing stock below min limits automatically alerts the office.
          </div>
        </div>

        <div className="pt-4 mt-4 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
          <span>
            You can see every supervisor's work here; you can only change your own records.
          </span>
          <div className="flex gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-ping"></span>
            <span className="text-emerald-600 font-semibold">Active Session</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SupervisorDashboard;
