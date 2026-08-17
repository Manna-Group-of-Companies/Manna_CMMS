import { useEffect, useMemo, useState } from "react";
import API from "../../services/api";
import { useNotifications } from "../../context/NotificationContext";
import useAutoRefresh from "../../hooks/useAutoRefresh";
import {
  Loader2,
  PackageOpen,
  Calendar,
  HelpCircle,
  Building2,
  User,
  Search,
  Layers,
} from "lucide-react";

const STATUS_TABS = [
  "In Red Stock",
  "Weekly Merge Pending",
  "Moved to Stock Room",
  "All",
];

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
  if (!dateString) return "—";
  const d = new Date(dateString);
  return (
    d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" }) +
    " " +
    d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  );
};

const PLACEHOLDER_IMAGE =
  "https://images.unsplash.com/photo-1595246140707-1e5b22b271d4?w=50&auto=format";

/**
 * The Red Stock Room — everything supervisors have handed back.
 *
 * Returns land here with no approval step, so this screen is a read-only
 * ledger: what came back, who returned it, and where it has got to since.
 */
const RedStockRoom = () => {
  const { showToast } = useNotifications();
  const [items, setItems] = useState([]);
  const [summary, setSummary] = useState(null);
  const [room, setRoom] = useState(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("In Red Stock");
  const [search, setSearch] = useState("");

  /** [silent] is used by the background poll: no spinner, no error toast. */
  const fetchData = async ({ silent = false } = {}) => {
    try {
      if (!silent) setLoading(true);
      const [itemsRes, summaryRes, roomRes] = await Promise.all([
        API.get("/red-stock"),
        API.get("/red-stock/summary"),
        API.get("/red-stock/room"),
      ]);
      setItems(itemsRes.data);
      setSummary(summaryRes.data);
      setRoom(roomRes.data);
    } catch (error) {
      console.error("Error loading the Red Stock Room:", error);
      if (!silent) showToast("Could not retrieve the Red Stock Room", "error");
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Supervisors return stock straight into Red Stock, so the ledger changes
  // without any action on this screen.
  useAutoRefresh(() => fetchData({ silent: true }));

  const filteredItems = useMemo(() => {
    const term = search.trim().toLowerCase();
    return items.filter((item) => {
      if (statusFilter !== "All" && item.status !== statusFilter) return false;
      if (!term) return true;
      return [
        item.productName,
        item.productCode,
        item.restockNumber,
        item.returnedBy?.name,
        item.department,
      ]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(term));
    });
  }, [items, statusFilter, search]);

  const summaryTiles = [
    {
      label: "In Red Stock",
      value: summary?.["In Red Stock"],
      classes: "bg-rose-500/10 border-rose-500/20 text-rose-600",
    },
    {
      label: "Weekly Merge Pending",
      value: summary?.["Weekly Merge Pending"],
      classes: "bg-indigo-500/10 border-indigo-500/20 text-indigo-600",
    },
    {
      label: "Moved to Companies",
      value: summary?.["Moved to Stock Room"],
      classes: "bg-emerald-500/10 border-emerald-500/20 text-emerald-600",
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 p-5 rounded-2xl glass-premium border border-slate-200">
        <div className="flex items-center gap-2">
          <PackageOpen className="h-5 w-5 text-rose-600" />
          <div>
            <h3 className="text-lg font-bold text-slate-900">Red Stock Room</h3>
            <p className="text-xs text-slate-500">
              Stock supervisors have handed back
              {room ? (
                <>
                  {" "}
                  • holding{" "}
                  <strong className="text-slate-700">{room.totalQuantity}</strong> pcs across{" "}
                  <strong className="text-slate-700">{room.itemCount}</strong> product(s)
                </>
              ) : null}
            </p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative">
            <Search className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search item, code or supervisor"
              className="w-full sm:w-64 pl-9 pr-3 py-2 rounded-xl border border-slate-200 bg-white text-xs text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
            />
          </div>

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

      {/* Summary tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {summaryTiles.map((tile) => (
          <div key={tile.label} className={`p-4 rounded-2xl border ${tile.classes}`}>
            <span className="text-xs font-semibold block mb-1">{tile.label}</span>
            <span className="text-2xl font-bold text-slate-900 block leading-none">
              {tile.value?.quantity ?? 0}
            </span>
            <span className="text-[11px] text-slate-500 mt-1 block">
              pcs across {tile.value?.items ?? 0} return(s)
            </span>
          </div>
        ))}
      </div>

      {/* What the room is holding, rolled up per product */}
      {room?.items?.length > 0 && (
        <div className="p-5 rounded-2xl glass-premium border border-slate-200">
          <span className="text-xs font-bold text-slate-900 flex items-center gap-1.5 mb-3">
            <Layers className="h-4 w-4 text-brand-700" />
            Currently Holding
          </span>
          <div className="flex flex-wrap gap-2">
            {room.items.map((row) => (
              <div
                key={row.productId}
                className="flex items-center gap-2 pl-2 pr-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200"
              >
                <img
                  src={row.image || PLACEHOLDER_IMAGE}
                  alt={row.name}
                  className="w-7 h-7 rounded-lg object-cover border border-slate-200"
                />
                <div className="leading-tight">
                  <div className="text-xs font-bold text-slate-800">{row.name}</div>
                  <div className="text-[10px] text-slate-500">
                    {row.quantity} {row.unit} • {row.awaitingMerge} awaiting
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Ledger */}
      {loading ? (
        <div className="h-[40vh] flex items-center justify-center">
          <Loader2 className="h-7 w-7 text-brand-500 animate-spin" />
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="glass-premium p-12 text-center rounded-2xl border border-slate-200 flex flex-col items-center justify-center">
          <HelpCircle className="h-10 w-10 text-slate-400 mb-3" />
          <h3 className="text-base font-bold text-slate-900 mb-1">Nothing here</h3>
          <p className="text-xs text-slate-500">
            {search
              ? "No returned stock matches your search."
              : (
                <>
                  No returned stock with status:{" "}
                  <strong className="text-brand-700">{statusFilter}</strong>.
                </>
              )}
          </p>
        </div>
      ) : (
        <div className="glass-premium rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-medium text-xs uppercase tracking-wider">
                  <th className="py-4 px-6">Item</th>
                  <th className="py-4 px-6 text-center">Returned Qty</th>
                  <th className="py-4 px-6">Supervisor / Department</th>
                  <th className="py-4 px-6">Return Date</th>
                  <th className="py-4 px-6">Issued From</th>
                  <th className="py-4 px-6 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-slate-700">
                {filteredItems.map((item) => (
                  <tr key={item._id} className="hover:bg-slate-50 transition-colors">
                    <td className="py-4 px-6">
                      <div className="flex items-center gap-3">
                        <img
                          src={item.product?.image || PLACEHOLDER_IMAGE}
                          alt={item.productName}
                          className="w-9 h-9 rounded-lg object-cover border border-slate-200"
                        />
                        <div>
                          <div className="font-bold text-slate-900">{item.productName}</div>
                          <div className="text-[10px] font-mono text-brand-700">
                            {item.restockNumber} • {item.productCode || "—"}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="py-4 px-6 text-center">
                      <span className="bg-rose-500/10 text-rose-600 border border-rose-500/20 px-2.5 py-0.5 rounded text-xs font-bold">
                        {item.quantity} {item.unit}
                      </span>
                      <span
                        className={`block mt-1 mx-auto w-fit px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${getConditionBadge(
                          item.condition
                        )}`}
                      >
                        {item.condition}
                      </span>
                    </td>
                    <td className="py-4 px-6">
                      <div className="flex items-center gap-2">
                        <div className="h-7 w-7 rounded-full bg-slate-100 flex items-center justify-center text-slate-600 border border-slate-200">
                          <User className="h-3.5 w-3.5" />
                        </div>
                        <div>
                          <div className="font-semibold text-slate-800 text-xs">
                            {item.returnedBy?.name || "Unknown"}
                          </div>
                          <div className="text-[10px] text-slate-500">{item.department}</div>
                        </div>
                      </div>
                    </td>
                    <td className="py-4 px-6 text-xs text-slate-600">
                      <span className="flex items-center gap-1.5">
                        <Calendar className="h-3.5 w-3.5 opacity-65" />
                        {formatDate(item.returnDate)}
                      </span>
                    </td>
                    <td className="py-4 px-6 text-xs text-slate-600">
                      <span className="flex items-center gap-1.5">
                        <Building2 className="h-3.5 w-3.5 opacity-65" />
                        {item.sourceRoom || item.product?.storeRoom || "—"}
                      </span>
                      <span className="block text-[10px] text-slate-400 mt-0.5 font-mono">
                        {item.sourceIssue?.issueNumber || ""}
                      </span>
                    </td>
                    <td className="py-4 px-6 text-center">
                      <span
                        className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${getStatusBadge(
                          item.status
                        )}`}
                      >
                        {item.status}
                      </span>
                      {item.destinationRoom && (
                        <span className="block mt-1 text-[10px] text-emerald-600 font-semibold">
                          → {item.destinationRoom}
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

export default RedStockRoom;
