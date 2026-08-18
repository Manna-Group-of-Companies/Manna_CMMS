import { useCallback, useEffect, useState } from "react";
import API from "../../services/api";
import { useNotifications } from "../../context/NotificationContext";
import { formatCurrency } from "../../utils/currency";
import {
  Loader2,
  Trash2,
  Flame,
  HelpCircle,
  TrendingDown,
  Warehouse,
  Package,
  Calendar,
} from "lucide-react";

const GROUPINGS = [
  { key: "month", label: "Monthly" },
  { key: "week", label: "Weekly" },
  { key: "day", label: "Daily" },
];

/** Presets rather than a date picker: these are the windows anyone asks for. */
const RANGES = [
  { key: "30", label: "Last 30 days", days: 30 },
  { key: "90", label: "Last quarter", days: 90 },
  { key: "365", label: "Last year", days: 365 },
  { key: "all", label: "All time", days: null },
];

/**
 * Total scrap value by item, store room and period — the primary maintenance
 * metric — with the consumption and scrap logs underneath it.
 *
 * Scrap value is `quantity × unit cost` snapshotted when the scrap was
 * recorded, so re-costing a product later does not restate a closed period.
 * That is why the numbers here can differ from `quantity × today's unit cost`,
 * and why they should.
 */
const ScrapReport = () => {
  const { showToast } = useNotifications();
  const [summary, setSummary] = useState(null);
  const [log, setLog] = useState([]);
  const [loading, setLoading] = useState(true);
  const [groupBy, setGroupBy] = useState("month");
  const [range, setRange] = useState("90");
  const [logType, setLogType] = useState("Scrapped");

  const fetchReport = useCallback(async () => {
    try {
      setLoading(true);

      const days = RANGES.find((r) => r.key === range)?.days;
      const params = { groupBy };
      if (days) {
        params.from = new Date(Date.now() - days * 86_400_000).toISOString();
      }

      // Both reads share the window so the log always explains the totals
      // above it rather than covering a different period.
      const [summaryRes, logRes] = await Promise.all([
        API.get("/disposals/scrap-summary", { params }),
        API.get("/disposals", {
          params: { type: logType, ...(params.from && { from: params.from }) },
        }),
      ]);

      setSummary(summaryRes.data);
      setLog(logRes.data);
    } catch (error) {
      console.error("Error loading the scrap report:", error);
      showToast("Failed to load the scrap report", "error");
    } finally {
      setLoading(false);
    }
  }, [groupBy, range, logType, showToast]);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  const formatDate = (value) => {
    if (!value) return "—";
    const d = new Date(value);
    return (
      d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" }) +
      " " +
      d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    );
  };

  const peakValue = Math.max(1, ...(summary?.byPeriod || []).map((r) => r.value));

  return (
    <div className="space-y-6">
      {/* Header + controls */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 p-5 rounded-2xl glass-premium border border-slate-200">
        <div className="flex items-center gap-2">
          <TrendingDown className="h-5 w-5 text-rose-600" />
          <div>
            <h3 className="text-lg font-bold text-slate-900">Scrap &amp; Consumption</h3>
            <p className="text-xs text-slate-500">
              Value written off across the stores — the primary maintenance metric
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex bg-slate-100 p-1.5 rounded-xl border border-slate-200">
            {RANGES.map((option) => (
              <button
                key={option.key}
                onClick={() => setRange(option.key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                  range === option.key
                    ? "bg-brand-600 text-white shadow"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="flex bg-slate-100 p-1.5 rounded-xl border border-slate-200">
            {GROUPINGS.map((option) => (
              <button
                key={option.key}
                onClick={() => setGroupBy(option.key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                  groupBy === option.key
                    ? "bg-brand-600 text-white shadow"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="h-[40vh] flex items-center justify-center">
          <Loader2 className="h-7 w-7 text-brand-500 animate-spin" />
        </div>
      ) : (
        <>
          {/* Headline totals */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="glass-premium p-5 rounded-2xl border border-rose-500/20 bg-rose-50/40">
              <div className="flex items-center gap-2 text-rose-600 mb-1">
                <Trash2 className="h-4 w-4" />
                <span className="text-xs font-semibold uppercase tracking-wide">
                  Total scrap value
                </span>
              </div>
              <div className="text-3xl font-extrabold text-rose-700">
                {formatCurrency(summary?.total?.value || 0)}
              </div>
            </div>
            <div className="glass-premium p-5 rounded-2xl border border-slate-200">
              <div className="flex items-center gap-2 text-slate-500 mb-1">
                <Package className="h-4 w-4" />
                <span className="text-xs font-semibold uppercase tracking-wide">
                  Quantity scrapped
                </span>
              </div>
              <div className="text-3xl font-extrabold text-slate-900">
                {summary?.total?.quantity || 0}
              </div>
            </div>
            <div className="glass-premium p-5 rounded-2xl border border-slate-200">
              <div className="flex items-center gap-2 text-slate-500 mb-1">
                <Calendar className="h-4 w-4" />
                <span className="text-xs font-semibold uppercase tracking-wide">
                  Scrap events
                </span>
              </div>
              <div className="text-3xl font-extrabold text-slate-900">
                {summary?.total?.events || 0}
              </div>
            </div>
          </div>

          {/* By period — a bar per bucket, widths relative to the worst one. */}
          <div className="glass-premium rounded-2xl border border-slate-200 p-5">
            <h4 className="text-sm font-bold text-slate-900 mb-4 flex items-center gap-2">
              <Calendar className="h-4 w-4 text-brand-700" />
              Scrap value by period
            </h4>
            {(summary?.byPeriod || []).length === 0 ? (
              <p className="text-xs text-slate-500">Nothing scrapped in this window.</p>
            ) : (
              <div className="space-y-2.5">
                {summary.byPeriod.map((row) => (
                  <div key={row.period} className="flex items-center gap-3">
                    <span className="w-20 shrink-0 font-mono text-[11px] text-slate-600">
                      {row.period}
                    </span>
                    <div className="flex-1 h-6 bg-slate-100 rounded-lg overflow-hidden">
                      <div
                        className="h-full bg-rose-500/70 rounded-lg transition-all"
                        style={{ width: `${(row.value / peakValue) * 100}%` }}
                      />
                    </div>
                    <span className="w-28 shrink-0 text-right text-xs font-bold text-slate-900">
                      {formatCurrency(row.value)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* By item and by store room, side by side */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="glass-premium rounded-2xl border border-slate-200 p-5">
              <h4 className="text-sm font-bold text-slate-900 mb-4 flex items-center gap-2">
                <Package className="h-4 w-4 text-brand-700" />
                Worst items by value
              </h4>
              {(summary?.byItem || []).length === 0 ? (
                <p className="text-xs text-slate-500">Nothing scrapped in this window.</p>
              ) : (
                <div className="divide-y divide-slate-200">
                  {summary.byItem.slice(0, 10).map((row) => (
                    <div
                      key={row.productId}
                      className="py-2.5 flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-slate-900 truncate">
                          {row.name}
                        </div>
                        <div className="text-[10px] font-mono text-brand-700">
                          {row.code || "—"} • {row.quantity} pcs over {row.events}{" "}
                          {row.events === 1 ? "event" : "events"}
                        </div>
                      </div>
                      <span className="text-xs font-bold text-rose-700 shrink-0">
                        {formatCurrency(row.value)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="glass-premium rounded-2xl border border-slate-200 p-5">
              <h4 className="text-sm font-bold text-slate-900 mb-4 flex items-center gap-2">
                <Warehouse className="h-4 w-4 text-brand-700" />
                By company
              </h4>
              {(summary?.byStoreRoom || []).length === 0 ? (
                <p className="text-xs text-slate-500">Nothing scrapped in this window.</p>
              ) : (
                <div className="divide-y divide-slate-200">
                  {summary.byStoreRoom.map((row) => (
                    <div
                      key={row.storeRoom}
                      className="py-2.5 flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-slate-900 truncate">
                          {row.storeRoom}
                        </div>
                        <div className="text-[10px] text-slate-500">
                          {row.quantity} pcs over {row.events}{" "}
                          {row.events === 1 ? "event" : "events"}
                        </div>
                      </div>
                      <span className="text-xs font-bold text-rose-700 shrink-0">
                        {formatCurrency(row.value)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* The logs themselves. Retained for reporting and audit; nothing here
              is ever pruned or edited. */}
          <div className="glass-premium rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
            <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
              <h4 className="text-sm font-bold text-slate-900">
                {logType === "Scrapped" ? "Scrap log" : "Consumption log"}
              </h4>
              <div className="flex bg-slate-100 p-1.5 rounded-xl border border-slate-200">
                {["Scrapped", "Consumed"].map((type) => (
                  <button
                    key={type}
                    onClick={() => setLogType(type)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 ${
                      logType === type
                        ? "bg-brand-600 text-white shadow"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    {type === "Scrapped" ? (
                      <Trash2 className="h-3.5 w-3.5" />
                    ) : (
                      <Flame className="h-3.5 w-3.5" />
                    )}
                    {type}
                  </button>
                ))}
              </div>
            </div>

            {log.length === 0 ? (
              <div className="p-12 text-center flex flex-col items-center justify-center">
                <HelpCircle className="h-10 w-10 text-slate-400 mb-3" />
                <h3 className="text-base font-bold text-slate-900 mb-1">
                  Nothing {logType.toLowerCase()} in this window
                </h3>
                <p className="text-xs text-slate-500">
                  Entries appear here when a supervisor actions an issued item as{" "}
                  {logType.toLowerCase()}.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-medium text-xs uppercase tracking-wider">
                      <th className="py-4 px-6">Ref #</th>
                      <th className="py-4 px-6">Engineering Stock</th>
                      <th className="py-4 px-6 text-center">Qty</th>
                      <th className="py-4 px-6">Company</th>
                      <th className="py-4 px-6">Against</th>
                      <th className="py-4 px-6">Reason</th>
                      <th className="py-4 px-6">By</th>
                      <th className="py-4 px-6">Date</th>
                      <th className="py-4 px-6 text-right">Value</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 text-slate-700">
                    {log.map((row) => (
                      <tr key={row._id} className="hover:bg-slate-50 transition-colors">
                        <td className="py-3.5 px-6 font-mono text-xs text-rose-600 font-bold">
                          {row.disposalNumber}
                        </td>
                        <td className="py-3.5 px-6">
                          <div className="font-bold text-slate-900">{row.productName}</div>
                          <div className="text-[10px] font-mono text-brand-700">
                            {row.productCode || "—"}
                          </div>
                        </td>
                        <td className="py-3.5 px-6 text-center font-semibold">
                          {row.quantity} {row.unit}
                        </td>
                        <td className="py-3.5 px-6 text-xs">{row.storeRoom || "—"}</td>
                        <td className="py-3.5 px-6 font-mono text-[11px] text-slate-600">
                          {row.reference || "—"}
                          <span className="block text-[10px] text-slate-400">
                            from {row.source}
                          </span>
                        </td>
                        <td className="py-3.5 px-6 text-xs italic text-slate-600 max-w-[200px] truncate">
                          {row.reason || "—"}
                        </td>
                        <td className="py-3.5 px-6 text-xs">
                          {row.disposedBy?.name || "Unknown"}
                        </td>
                        <td className="py-3.5 px-6 text-xs text-slate-600">
                          {formatDate(row.disposedAt)}
                        </td>
                        <td className="py-3.5 px-6 text-right font-bold text-slate-900">
                          {row.unitCost > 0 ? formatCurrency(row.value) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default ScrapReport;
