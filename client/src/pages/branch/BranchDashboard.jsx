import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import API from "../../services/api";
import { useAuth } from "../../context/AuthContext";
import { useNotifications } from "../../context/NotificationContext";
import useAutoRefresh from "../../hooks/useAutoRefresh";
import RequestFormModal from "./RequestFormModal";
import {
  Boxes,
  Layers,
  Loader2,
  AlertTriangle,
  PackageX,
  Search,
  Warehouse,
  PackageSearch,
  Send,
  ClipboardList,
} from "lucide-react";

/**
 * Everything a Branch account sees: the stock standing in its own room.
 *
 * The room is never sent up — the API reads it off the account — so this page
 * cannot be pointed at another branch's stock.
 */
const BranchDashboard = () => {
  const { user } = useAuth();
  const { showToast } = useNotifications();

  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("All");
  // The product a row's "Apply" button opened the request form for.
  const [requestFor, setRequestFor] = useState(null);
  const [stock, setStock] = useState({
    room: null,
    itemCount: 0,
    totalQuantity: 0,
    lowStockCount: 0,
    outOfStockCount: 0,
    categoryCount: 0,
    branchPendingAdmin: 0,
    branchPendingSupervisor: 0,
    branchApproved: 0,
    branchRejected: 0,
    items: [],
  });

  /** [silent] is used by the background poll: no error toast. */
  const fetchStock = async ({ silent = false } = {}) => {
    try {
      const { data } = await API.get("/dashboard/branch");
      setStock(data);
    } catch (error) {
      console.error("Error fetching branch stock:", error);
      if (!silent) {
        showToast(
          error.response?.data?.message || "Failed to load your stock room",
          "error"
        );
      }
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    fetchStock();
  }, []);

  // The Admin moves and corrects this stock elsewhere; polling keeps the
  // branch's copy of the numbers honest.
  useAutoRefresh(() => fetchStock({ silent: true }));

  const visibleItems = useMemo(() => {
    const term = search.trim().toLowerCase();
    return stock.items.filter((item) => {
      if (filter === "Low" && !item.isLowStock) return false;
      if (filter === "Out" && !item.isOutOfStock) return false;
      if (!term) return true;
      return (
        item.name?.toLowerCase().includes(term) ||
        item.code?.toLowerCase().includes(term) ||
        item.category?.toLowerCase().includes(term)
      );
    });
  }, [stock.items, search, filter]);

  if (loading) {
    return (
      <div className="h-[60vh] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 text-brand-600 animate-spin" />
          <span className="text-sm font-medium text-slate-600">Loading stock room...</span>
        </div>
      </div>
    );
  }

  const roomName = stock.room?.name || user?.stockRoom?.name || "Your Company";

  const cards = [
    {
      title: "Items in Room",
      value: stock.itemCount,
      icon: Boxes,
      color: "from-brand-600/10 to-brand-400/10 border-brand-500/20 text-brand-700",
    },
    {
      title: "Total Quantity",
      value: stock.totalQuantity,
      icon: Warehouse,
      color: "from-emerald-600/10 to-teal-600/10 border-emerald-500/20 text-emerald-600",
    },
    {
      title: "Categories",
      value: stock.categoryCount,
      icon: Layers,
      color: "from-indigo-600/10 to-blue-600/10 border-indigo-500/20 text-indigo-600",
    },
    {
      title: "Low Stock",
      value: stock.lowStockCount,
      icon: AlertTriangle,
      color:
        stock.lowStockCount > 0
          ? "from-amber-500/20 to-orange-500/20 border-amber-500/30 text-amber-600"
          : "from-slate-50 to-slate-100 border-slate-200 text-slate-600",
    },
    {
      title: "Out of Stock",
      value: stock.outOfStockCount,
      icon: PackageX,
      color:
        stock.outOfStockCount > 0
          ? "from-rose-600/10 to-red-600/10 border-rose-500/20 text-rose-600"
          : "from-slate-50 to-slate-100 border-slate-200 text-slate-600",
    },
  ];

  const filters = [
    { key: "All", label: `All (${stock.itemCount})` },
    { key: "Low", label: `Low Stock (${stock.lowStockCount})` },
    { key: "Out", label: `Out of Stock (${stock.outOfStockCount})` },
  ];

  const statusBadge = (item) => {
    if (item.isOutOfStock) {
      return { text: "Out of Stock", className: "bg-rose-500/10 text-rose-600 border border-rose-500/20" };
    }
    if (item.isLowStock) {
      return { text: "Low Stock", className: "bg-amber-500/10 text-amber-600 border border-amber-500/20" };
    }
    return { text: "In Stock", className: "bg-emerald-500/10 text-emerald-600 border border-emerald-500/20" };
  };

  return (
    <div className="space-y-8">
      {/* Room Header */}
      <div className="glass-premium p-6 rounded-2xl border border-slate-200 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="bg-brand-600/10 border border-brand-500/20 p-3 rounded-xl">
            <Warehouse className="h-6 w-6 text-brand-700" />
          </div>
          <div>
            <h3 className="text-xl font-bold text-slate-900 tracking-tight">{roomName}</h3>
            <p className="text-xs text-slate-600 mt-1">
              {stock.room?.description || "Live stock held in your branch room."}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Link
            to="/branch/requests"
            className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-brand-600 to-brand-700 hover:from-brand-500 hover:to-brand-600 text-white text-sm font-semibold shadow-lg transition-all flex items-center gap-2 cursor-pointer"
          >
            <ClipboardList className="h-4 w-4" />
            My Requests
          </Link>
        </div>
      </div>

      {/* Where this branch's requests stand, so the stage is visible from the
          stock screen as well as the requests screen. */}
      <div className="glass-premium p-5 rounded-2xl border border-slate-200 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <ClipboardList className="h-4 w-4 text-slate-500" />
          <h4 className="text-sm font-bold text-slate-900">My Request Status</h4>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {[
            { label: "Pending Admin", value: stock.branchPendingAdmin, className: "bg-amber-500/10 text-amber-600 border-amber-500/20" },
            { label: "Supervisor Pending", value: stock.branchPendingSupervisor, className: "bg-indigo-500/10 text-indigo-600 border-indigo-500/20" },
            { label: "Approved", value: stock.branchApproved, className: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20" },
            { label: "Rejected", value: stock.branchRejected, className: "bg-rose-500/10 text-rose-600 border-rose-500/20" },
          ].map((entry) => (
            <div
              key={entry.label}
              className={`px-3.5 py-2 rounded-xl border text-xs font-semibold flex items-center gap-2 ${entry.className}`}
            >
              <span className="text-base font-bold">{entry.value}</span>
              {entry.label}
            </div>
          ))}
          <Link
            to="/branch/requests"
            className="text-xs font-semibold text-brand-700 hover:text-brand-600 underline underline-offset-2 cursor-pointer"
          >
            View all
          </Link>
        </div>
      </div>

      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-5">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <div
              key={card.title}
              className={`p-6 rounded-2xl border bg-gradient-to-br ${card.color} shadow-sm`}
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
        })}
      </div>

      {/* Stock Table */}
      <div className="glass-premium rounded-2xl border border-slate-200 overflow-hidden">
        <div className="p-6 border-b border-slate-200 flex flex-wrap items-center justify-between gap-4">
          <h3 className="text-lg font-bold text-slate-900">Stock on Hand</h3>

          <div className="flex flex-wrap items-center gap-3">
            {/* Status Filter */}
            <div className="flex gap-1 p-1 rounded-xl bg-slate-100 border border-slate-200">
              {filters.map((option) => (
                <button
                  key={option.key}
                  onClick={() => setFilter(option.key)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                    filter === option.key
                      ? "bg-white text-brand-700 shadow-sm"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>

            {/* Search */}
            <div className="relative">
              <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-500">
                <Search className="h-4 w-4" />
              </span>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name, code or category"
                className="w-64 pl-9 pr-4 py-2 rounded-xl bg-white border border-slate-200 text-slate-900 placeholder-slate-400 text-sm focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/20 transition-all"
              />
            </div>
          </div>
        </div>

        {visibleItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-500">
            <PackageSearch className="h-10 w-10 mb-3 opacity-50" />
            <p className="text-sm">
              {stock.items.length === 0
                ? "No stock is held in this room yet."
                : "No items match this search."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr className="text-[11px] uppercase tracking-wider text-slate-600">
                  <th className="px-6 py-3 font-semibold">Product</th>
                  <th className="px-6 py-3 font-semibold">Code</th>
                  <th className="px-6 py-3 font-semibold">Category</th>
                  <th className="px-6 py-3 font-semibold text-right">Quantity</th>
                  <th className="px-6 py-3 font-semibold text-right">Min</th>
                  <th className="px-6 py-3 font-semibold">Status</th>
                  <th className="px-6 py-3 font-semibold text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {visibleItems.map((item) => {
                  const badge = statusBadge(item);
                  return (
                    <tr key={item._id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          {item.image ? (
                            <img
                              src={item.image}
                              alt={item.name}
                              className="h-10 w-10 rounded-lg object-cover border border-slate-200"
                            />
                          ) : (
                            <div className="h-10 w-10 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center">
                              <Boxes className="h-4 w-4 text-slate-500" />
                            </div>
                          )}
                          <span className="text-sm font-semibold text-slate-900">
                            {item.name}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-xs text-slate-600">{item.code}</td>
                      <td className="px-6 py-4 text-xs text-slate-600">
                        {item.category || "—"}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <span className="text-sm font-bold text-slate-900">
                          {item.quantity}
                        </span>
                        <span className="text-xs text-slate-500 ml-1">{item.unit}</span>
                      </td>
                      <td className="px-6 py-4 text-right text-xs text-slate-600">
                        {item.minStock}
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${badge.className}`}
                        >
                          {badge.text}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button
                          onClick={() => setRequestFor(item)}
                          disabled={item.isOutOfStock}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-brand-500/30 bg-brand-500/10 text-brand-700 text-xs font-semibold hover:bg-brand-500/20 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                          title={item.isOutOfStock ? "Nothing in stock to request" : "Apply for this product"}
                        >
                          <Send className="h-3.5 w-3.5" />
                          Apply
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {requestFor && (
        <RequestFormModal
          items={stock.items}
          preselected={requestFor}
          onClose={() => setRequestFor(null)}
          onSubmitted={() => fetchStock({ silent: true })}
        />
      )}
    </div>
  );
};

export default BranchDashboard;
