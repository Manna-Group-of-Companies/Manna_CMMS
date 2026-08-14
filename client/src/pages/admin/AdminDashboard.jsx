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
  ChevronRight,
  TrendingUp,
  ClipboardCheck,
} from "lucide-react";

const AdminDashboard = () => {
  const { showToast } = useNotifications();
  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState({
    totalProducts: 0,
    pendingRequests: 0,
    approvedRequests: 0,
    rejectedRequests: 0,
    lowStockProductsCount: 0,
    lowStockProducts: [],
    todayRequestsCount: 0,
    todayRequests: [],
  });

  /** [silent] is used by the background poll: no error toast. */
  const fetchAdminDashboard = async ({ silent = false } = {}) => {
    try {
      const { data } = await API.get("/dashboard/admin");
      setMetrics(data);
    } catch (error) {
      console.error("Error loading admin metrics:", error);
      if (!silent) showToast("Failed to fetch administrator metrics", "error");
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    fetchAdminDashboard();
  }, []);

  // Counts move whenever a supervisor acts in the app.
  useAutoRefresh(() => fetchAdminDashboard({ silent: true }));

  const getStatusColor = (status) => {
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
    return new Date(timeString).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  if (loading) {
    return (
      <div className="h-[60vh] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 text-brand-500 animate-spin" />
          <span className="text-sm font-medium text-slate-600">Loading metrics...</span>
        </div>
      </div>
    );
  }

  // What the Request Control console shows under "Pending": the four request
  // types plus any merge waiting on a decision.
  const pendingTotal = metrics.pendingRequests + (metrics.mergePendingCount || 0);

  const cardData = [
    {
      title: "Total Catalog Products",
      value: metrics.totalProducts,
      icon: Boxes,
      color: "from-brand-600/10 to-brand-400/10 border-brand-500/20 text-brand-700",
    },
    {
      title: "Pending Requests",
      // Merges are decided in the same console, so they count here too.
      value: pendingTotal,
      icon: Clock,
      color: pendingTotal > 0
        ? "from-amber-500/20 to-yellow-500/20 border-amber-500/30 text-amber-600 animate-pulse"
        : "from-slate-50 to-slate-100 border-slate-200 text-slate-600",
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
      title: "Low Stock Products",
      value: metrics.lowStockProductsCount,
      icon: AlertTriangle,
      color: metrics.lowStockProductsCount > 0
        ? "from-rose-500/20 to-orange-500/20 border-rose-500/30 text-rose-600"
        : "from-slate-50 to-slate-100 border-slate-200 text-slate-600",
    },
    {
      // Stage one of the branch workflow; stage two sits with the Supervisor.
      title: "Branch Requests to Approve",
      value: metrics.branchPendingAdmin || 0,
      icon: ClipboardCheck,
      link: "/admin/branch-requests",
      color: metrics.branchPendingAdmin > 0
        ? "from-amber-500/20 to-yellow-500/20 border-amber-500/30 text-amber-600"
        : "from-slate-50 to-slate-100 border-slate-200 text-slate-600",
    },
  ];

  return (
    <div className="space-y-8">
      {/* Metrics Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {cardData.map((card, idx) => {
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
            <Link key={idx} to={card.link} className="cursor-pointer">
              {body}
            </Link>
          ) : (
            <div key={idx}>{body}</div>
          );
        })}
      </div>

      {/* Grid: Low Stock Alert List & Today's Requests */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
        
        {/* Panel 1: Today's Requests */}
        <div className="glass-premium p-6 rounded-2xl border border-slate-200 flex flex-col">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2">
              <Calendar className="h-5 w-5 text-indigo-600" />
              <h3 className="text-lg font-bold text-slate-900">Today's Requests ({metrics.todayRequestsCount})</h3>
            </div>
            <Link
              to="/admin/requests"
              className="text-xs text-brand-700 hover:text-brand-700 font-semibold flex items-center gap-1 hover:underline cursor-pointer"
            >
              Manage all
              <ChevronRight className="h-4 w-4" />
            </Link>
          </div>

          <div className="flex-1 overflow-x-auto">
            {metrics.todayRequests.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-slate-500 border border-dashed border-slate-200 rounded-xl">
                <Clock className="h-8 w-8 mb-2 opacity-50" />
                <p className="text-sm">No new requests submitted today.</p>
              </div>
            ) : (
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold uppercase">
                    <th className="py-3 px-4">Request #</th>
                    <th className="py-3 px-4">Product Name</th>
                    <th className="py-3 px-4">Type</th>
                    <th className="py-3 px-4">Supervisor</th>
                    <th className="py-3 px-4 text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-slate-700">
                  {metrics.todayRequests.slice(0, 5).map((req) => (
                    <tr key={req._id} className="hover:bg-slate-50">
                      <td className="py-3 px-4 font-mono text-[10px] text-brand-700 font-semibold">
                        {req.requestNumber}
                      </td>
                      <td className="py-3 px-4 font-semibold text-slate-900 max-w-[120px] truncate">
                        {req.productName}
                      </td>
                      <td className="py-3 px-4">{req.requestType}</td>
                      <td className="py-3 px-4 text-slate-600">{req.supervisorName}</td>
                      <td className="py-3 px-4 text-right">
                        <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider ${getStatusColor(req.status)}`}>
                          {req.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Panel 2: Low Stock Products Alert */}
        <div className="glass-premium p-6 rounded-2xl border border-slate-200 flex flex-col">
          <div className="flex items-center gap-2 mb-6">
            <AlertTriangle className="h-5 w-5 text-rose-600" />
            <h3 className="text-lg font-bold text-slate-900">Low Stock Products ({metrics.lowStockProductsCount})</h3>
          </div>

          <div className="flex-1 overflow-x-auto">
            {metrics.lowStockProducts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-slate-500 border border-dashed border-slate-200 rounded-xl">
                <CheckCircle className="h-8 w-8 mb-2 text-emerald-600 opacity-60" />
                <p className="text-sm">All products are adequately stocked.</p>
              </div>
            ) : (
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold uppercase">
                    <th className="py-3 px-4">Code</th>
                    <th className="py-3 px-4">Product Name</th>
                    <th className="py-3 px-4">Store Room</th>
                    <th className="py-3 px-4 text-center">Qty / Min Qty</th>
                    <th className="py-3 px-4 text-right">Severity</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-slate-700">
                  {metrics.lowStockProducts.slice(0, 5).map((prod) => {
                    const ratio = prod.quantity / prod.minStock;
                    const isOutOfStock = prod.quantity === 0;
                    return (
                      <tr key={prod._id} className="hover:bg-slate-50">
                        <td className="py-3 px-4 font-mono text-[10px] text-slate-500">{prod.code}</td>
                        <td className="py-3 px-4 font-semibold text-slate-900 max-w-[150px] truncate">{prod.name}</td>
                        <td className="py-3 px-4 text-slate-600">{prod.storeRoom}</td>
                        <td className="py-3 px-4 text-center font-semibold text-slate-900">
                          <span className={isOutOfStock ? "text-rose-600" : "text-amber-600"}>
                            {prod.quantity}
                          </span>{" "}
                          / {prod.minStock} {prod.unit}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <span className={`px-2 py-0.5 rounded text-[9px] font-bold ${
                            isOutOfStock
                              ? "bg-rose-500/10 text-rose-600 border border-rose-500/20"
                              : ratio <= 0.5
                              ? "bg-orange-500/10 text-orange-600 border border-orange-500/20"
                              : "bg-amber-500/10 text-amber-600 border border-amber-500/20"
                          }`}>
                            {isOutOfStock ? "CRITICAL" : ratio <= 0.5 ? "HIGH" : "WARNING"}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

      </div>
    </div>
  );
};

export default AdminDashboard;
