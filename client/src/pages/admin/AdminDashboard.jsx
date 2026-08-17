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
        return "badge-emerald";
      case "Rejected":
        return "badge-rose";
      default:
        return "badge-amber";
    }
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

  // Every tile is the same white card; only the icon chip carries the colour,
  // and a tile that needs attention gets a tinted edge instead of a pulse.
  const IDLE_CHIP = "bg-slate-100 text-slate-500 border-slate-200";

  const cardData = [
    {
      title: "Catalog Products",
      value: metrics.totalProducts,
      icon: Boxes,
      chip: "bg-brand-50 text-brand-700 border-brand-500/20",
      link: "/admin/products",
      hint: "Across every company",
    },
    {
      title: "Pending Requests",
      // Merges are decided in the same console, so they count here too.
      value: pendingTotal,
      icon: Clock,
      link: "/admin/requests",
      alert: pendingTotal > 0,
      chip: pendingTotal > 0 ? "bg-amber-50 text-amber-600 border-amber-500/20" : IDLE_CHIP,
      hint: pendingTotal > 0 ? "Waiting on a decision" : "Nothing waiting",
    },
    {
      title: "Approved Requests",
      value: metrics.approvedRequests,
      icon: CheckCircle,
      chip: "bg-emerald-50 text-emerald-600 border-emerald-500/20",
      hint: "All time",
    },
    {
      title: "Rejected Requests",
      value: metrics.rejectedRequests,
      icon: XCircle,
      chip: "bg-rose-50 text-rose-600 border-rose-500/20",
      hint: "All time",
    },
    {
      title: "Low Stock Products",
      value: metrics.lowStockProductsCount,
      icon: AlertTriangle,
      link: "/admin/products",
      alert: metrics.lowStockProductsCount > 0,
      chip:
        metrics.lowStockProductsCount > 0
          ? "bg-rose-50 text-rose-600 border-rose-500/20"
          : IDLE_CHIP,
      hint: metrics.lowStockProductsCount > 0 ? "At or below minimum" : "All stocked",
    },
    {
      // Stage one of the branch workflow; stage two sits with the Supervisor.
      title: "Branch Requests to Approve",
      value: metrics.branchPendingAdmin || 0,
      icon: ClipboardCheck,
      link: "/admin/branch-requests",
      alert: metrics.branchPendingAdmin > 0,
      chip:
        metrics.branchPendingAdmin > 0
          ? "bg-amber-50 text-amber-600 border-amber-500/20"
          : IDLE_CHIP,
      hint: "First-stage approval",
    },
  ];

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Metrics Row */}
      {/* Six across only from 2xl — below that the longest title wraps to
          three lines and the tiles stop reading as a row. */}
      <div className="grid grid-cols-2 md:grid-cols-3 2xl:grid-cols-6 gap-3 sm:gap-4">
        {cardData.map((card, idx) => {
          const Icon = card.icon;
          const body = (
            <div
              className={`card h-full p-4 flex flex-col gap-3 ${
                card.alert ? "border-amber-500/40" : ""
              } ${card.link ? "transition-shadow hover:shadow-md" : ""}`}
            >
              <div className="flex items-start justify-between gap-2">
                <span
                  className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl border ${card.chip}`}
                >
                  <Icon className="h-[18px] w-[18px]" />
                </span>
                {card.link && (
                  <ChevronRight className="h-4 w-4 text-slate-300 shrink-0" />
                )}
              </div>
              <div>
                <p className="text-[28px] font-bold leading-none tracking-tight text-slate-900">
                  {card.value}
                </p>
                <p className="mt-2 text-[12px] font-semibold leading-tight text-slate-700">
                  {card.title}
                </p>
                <p className="mt-0.5 text-[11px] leading-tight text-slate-500">{card.hint}</p>
              </div>
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
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 sm:gap-6">

        {/* Panel 1: Today's Requests */}
        <div className="card flex flex-col overflow-hidden">
          <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-200">
            <h3 className="section-title">
              <Calendar className="h-[18px] w-[18px] text-indigo-600 shrink-0" />
              Today's Requests
              <span className="badge badge-slate badge-soft">{metrics.todayRequestsCount}</span>
            </h3>
            <Link
              to="/admin/requests"
              className="shrink-0 text-[12px] font-semibold text-brand-700 hover:text-brand-600 flex items-center gap-0.5 cursor-pointer"
            >
              Manage all
              <ChevronRight className="h-4 w-4" />
            </Link>
          </div>

          <div className="flex-1 table-scroll">
            {metrics.todayRequests.length === 0 ? (
              <div className="empty-inline m-5">
                <Clock className="h-8 w-8 mb-2 opacity-40" />
                <p className="text-[13px]">No new requests submitted today.</p>
              </div>
            ) : (
              <table className="tbl tbl-compact">
                <thead>
                  <tr>
                    <th>Request #</th>
                    <th>Product</th>
                    <th>Type</th>
                    <th>Supervisor</th>
                    <th className="text-right">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.todayRequests.slice(0, 5).map((req) => (
                    <tr key={req._id}>
                      <td className="mono font-semibold text-brand-700">{req.requestNumber}</td>
                      <td className="cell-title max-w-[160px] truncate">{req.productName}</td>
                      <td className="text-slate-600">{req.requestType}</td>
                      <td className="text-slate-600">{req.supervisorName}</td>
                      <td className="text-right">
                        <span className={`badge badge-pill ${getStatusColor(req.status)}`}>
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
        <div className="card flex flex-col overflow-hidden">
          <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-200">
            <h3 className="section-title">
              <AlertTriangle className="h-[18px] w-[18px] text-rose-600 shrink-0" />
              Low Stock Products
              <span className="badge badge-slate badge-soft">
                {metrics.lowStockProductsCount}
              </span>
            </h3>
            <Link
              to="/admin/products"
              className="shrink-0 text-[12px] font-semibold text-brand-700 hover:text-brand-600 flex items-center gap-0.5 cursor-pointer"
            >
              View catalog
              <ChevronRight className="h-4 w-4" />
            </Link>
          </div>

          <div className="flex-1 table-scroll">
            {metrics.lowStockProducts.length === 0 ? (
              <div className="empty-inline m-5">
                <CheckCircle className="h-8 w-8 mb-2 text-emerald-600 opacity-60" />
                <p className="text-[13px]">All products are adequately stocked.</p>
              </div>
            ) : (
              <table className="tbl tbl-compact">
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Product</th>
                    <th>Company</th>
                    <th className="text-center">Qty / Min</th>
                    <th className="text-right">Severity</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.lowStockProducts.slice(0, 5).map((prod) => {
                    const ratio = prod.quantity / prod.minStock;
                    const isOutOfStock = prod.quantity === 0;
                    return (
                      <tr key={prod._id}>
                        <td className="mono text-slate-500">{prod.code}</td>
                        <td className="cell-title max-w-[180px] truncate">{prod.name}</td>
                        <td className="text-slate-600">{prod.storeRoom}</td>
                        <td className="text-center whitespace-nowrap">
                          <span
                            className={`font-bold ${
                              isOutOfStock ? "text-rose-600" : "text-amber-600"
                            }`}
                          >
                            {prod.quantity}
                          </span>
                          <span className="text-slate-500">
                            {" "}
                            / {prod.minStock} {prod.unit}
                          </span>
                        </td>
                        <td className="text-right">
                          <span
                            className={`badge ${
                              isOutOfStock
                                ? "badge-rose"
                                : ratio <= 0.5
                                ? "badge-orange"
                                : "badge-amber"
                            }`}
                          >
                            {isOutOfStock ? "Critical" : ratio <= 0.5 ? "High" : "Warning"}
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
