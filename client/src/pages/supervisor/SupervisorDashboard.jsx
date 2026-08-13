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

  const cards = [
    {
      title: "Total Catalog Products",
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
      icon: Clock,
      color: "from-amber-600/10 to-yellow-600/10 border-amber-500/20 text-amber-600",
    },
    {
      title: "Approved Requests",
      value: metrics.approvedRequests,
      icon: CheckCircle,
      color: "from-emerald-600/10 to-teal-600/10 border-emerald-500/20 text-emerald-600",
    },
    {
      title: "Rejected Requests",
      value: metrics.rejectedRequests,
      icon: XCircle,
      color: "from-rose-600/10 to-red-600/10 border-rose-500/20 text-rose-600",
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
        {/* Today's Activity Timeline */}
        <div className="lg:col-span-2 glass-premium p-6 rounded-2xl border border-slate-200 flex flex-col">
          <div className="flex items-center gap-2 mb-6">
            <Calendar className="h-5 w-5 text-emerald-600" />
            <h3 className="text-lg font-bold text-slate-900">Today's Activity Log</h3>
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
                  className="flex items-center justify-between p-4 rounded-xl bg-slate-50 border border-slate-200 hover:border-slate-300 transition-all"
                >
                  <div className="flex items-center gap-4">
                    <span className="text-xs font-semibold text-slate-500">
                      {formatTime(activity.time)}
                    </span>
                    <div>
                      <h4 className="text-sm font-semibold text-slate-900">
                        {activity.productName}
                      </h4>
                      <p className="text-xs text-slate-600">{activity.requestType}</p>
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

        {/* Quick Instructions / Store Status */}
        <div className="glass-premium p-6 rounded-2xl border border-slate-200 flex flex-col justify-between">
          <div>
            <h3 className="text-lg font-bold text-slate-900 mb-4">Supervisor Guidance</h3>
            <div className="space-y-4 text-xs text-slate-600 leading-relaxed">
              <div className="p-3 bg-indigo-50 border border-indigo-500/10 rounded-lg">
                <p className="font-semibold text-indigo-600 mb-1">Request-Only Catalog updates</p>
                As a Store Supervisor, you cannot modify products directly. Every addition or modification submits a request to the office Admin for approval.
              </div>
              <div className="p-3 bg-emerald-50 border border-emerald-500/10 rounded-lg">
                <p className="font-semibold text-emerald-700 mb-1">Quantity Audits</p>
                Before requesting a "Stock Out", ensure that there is sufficient stock quantity. Reducing stock below min limits automatically alerts the office.
              </div>
            </div>
          </div>

          <div className="pt-6 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
            <span>Room Capacities: Normal</span>
            <div className="flex gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-ping"></span>
              <span className="text-emerald-600 font-semibold">Active Session</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SupervisorDashboard;
