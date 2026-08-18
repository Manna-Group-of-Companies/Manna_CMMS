import { useCallback, useEffect, useState } from "react";
import API from "../../services/api";
import { useNotifications } from "../../context/NotificationContext";
import { formatCurrency } from "../../utils/currency";
import AuditTrailModal from "../../components/AuditTrailModal";
import {
  AUDIT_STATUS_BADGES,
  currentPeriod,
  periodBefore,
  periodLabel,
  reasonTone,
  scoreTone,
  shortPeriodLabel,
} from "../../utils/audit";
import {
  Loader2,
  ClipboardCheck,
  Warehouse,
  Gauge,
  AlertTriangle,
  CheckCircle2,
  Calendar,
  RotateCcw,
  X,
  HelpCircle,
  ScrollText,
  TrendingUp,
} from "lucide-react";

/** How far back the report looks. Months, counted back from this one. */
const RANGES = [
  { key: "6", label: "Last 6 months", months: 5 },
  { key: "12", label: "Last year", months: 11 },
  { key: "all", label: "All time", months: null },
];

const STATUS_TABS = ["All", "In Progress", "Submitted", "Reviewed"];

/**
 * What every store room's monthly count found, and what it scored (ST-37,
 * ST-38).
 *
 * A score is matched lines over lines on the sheet, so a room that only counts
 * the easy half of its stock cannot score its way to the top of this page.
 * Rolled-up scores — a room across months, a month across rooms, the company
 * overall — are recomputed from the underlying line counts rather than
 * averaged from the percentages, so a nine-hundred-line room is not outweighed
 * by a twelve-line one.
 *
 * Nothing on this page changes stock. Where a count and the system disagree,
 * putting the balance right stays a deliberate correction on the stock room
 * screen — the audit records what was found and leaves it on the record.
 */
const AuditReport = () => {
  const { showToast } = useNotifications();
  const period = currentPeriod();

  const [board, setBoard] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState("12");
  const [statusFilter, setStatusFilter] = useState("All");
  const [openId, setOpenId] = useState(null);

  const fetchReport = useCallback(async () => {
    try {
      setLoading(true);

      const months = RANGES.find((option) => option.key === range)?.months;
      const params = months === null || months === undefined ? {} : { from: periodBefore(period, months) };

      // Both reads share the window, so the list underneath always explains
      // the scores above it rather than covering a different stretch.
      const [boardRes, historyRes] = await Promise.all([
        API.get("/audits/scoreboard", { params }),
        API.get("/audits", { params }),
      ]);

      setBoard(boardRes.data);
      setHistory(historyRes.data);
    } catch (error) {
      console.error("Error loading the audit report:", error);
      showToast("Failed to load the audit report", "error");
    } finally {
      setLoading(false);
    }
  }, [range, period, showToast]);

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

  const visibleHistory =
    statusFilter === "All" ? history : history.filter((row) => row.status === statusFilter);

  const overall = board?.overall;
  const overallTone = scoreTone(overall?.score || 0);
  const peakVariance = Math.max(1, ...(board?.byPeriod || []).map((row) => row.varianceValue));

  return (
    <div className="space-y-6">
      {/* Header + range */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 p-5 rounded-2xl glass-premium border border-slate-200">
        <div className="flex items-center gap-2">
          <ClipboardCheck className="h-5 w-5 text-brand-600" />
          <div>
            <h3 className="text-lg font-bold text-slate-900">Stock audit scores</h3>
            <p className="text-xs text-slate-500">
              How well each store room's shelves matched the system, month by month
            </p>
          </div>
        </div>

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
      </div>

      {loading ? (
        <div className="h-[40vh] flex items-center justify-center">
          <Loader2 className="h-7 w-7 text-brand-500 animate-spin" />
        </div>
      ) : (
        <>
          {/* Headline figures */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className={`glass-premium p-5 rounded-2xl border ${overallTone.ring}`}>
              <div className="flex items-center gap-2 text-slate-500 mb-1">
                <Gauge className="h-4 w-4" />
                <span className="text-xs font-semibold uppercase tracking-wide">
                  Overall score
                </span>
              </div>
              <div className={`text-3xl font-extrabold ${overallTone.text}`}>
                {overall?.score || 0}%
              </div>
              <div className="mt-2 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                <div
                  className={`h-full ${overallTone.bar} rounded-full transition-all`}
                  style={{ width: `${overall?.score || 0}%` }}
                />
              </div>
              <p className="mt-2 text-[10px] text-slate-500">
                {overall?.linesMatched || 0} matched of {overall?.linesTotal || 0} lines audited
              </p>
            </div>

            <div className="glass-premium p-5 rounded-2xl border border-slate-200">
              <div className="flex items-center gap-2 text-slate-500 mb-1">
                <AlertTriangle className="h-4 w-4" />
                <span className="text-xs font-semibold uppercase tracking-wide">
                  Discrepancies
                </span>
              </div>
              <div className="text-3xl font-extrabold text-slate-900">
                {(overall?.linesShort || 0) + (overall?.linesOver || 0)}
              </div>
              <p className="mt-2 text-[10px] text-slate-500">
                {overall?.linesShort || 0} short • {overall?.linesOver || 0} over
              </p>
            </div>

            <div className="glass-premium p-5 rounded-2xl border border-slate-200">
              <div className="flex items-center gap-2 text-slate-500 mb-1">
                <TrendingUp className="h-4 w-4" />
                <span className="text-xs font-semibold uppercase tracking-wide">
                  Variance value
                </span>
              </div>
              <div className="text-3xl font-extrabold text-slate-900">
                {formatCurrency(overall?.varianceValue || 0)}
              </div>
              <p className="mt-2 text-[10px] text-slate-500">
                {overall?.varianceQuantity || 0} units out, at last known cost
              </p>
            </div>

            <div className="glass-premium p-5 rounded-2xl border border-slate-200">
              <div className="flex items-center gap-2 text-slate-500 mb-1">
                <Calendar className="h-4 w-4" />
                <span className="text-xs font-semibold uppercase tracking-wide">
                  {periodLabel(board?.period)}
                </span>
              </div>
              {(board?.outstanding || []).length === 0 ? (
                <>
                  <div className="text-3xl font-extrabold text-emerald-600">All counted</div>
                  <p className="mt-2 text-[10px] text-slate-500">
                    Every store room has a count open or closed for this month
                  </p>
                </>
              ) : (
                <>
                  <div className="text-3xl font-extrabold text-amber-600">
                    {board.outstanding.length} to go
                  </div>
                  <p className="mt-2 text-[10px] text-slate-500 truncate">
                    {board.outstanding.map((room) => room.stockRoom).join(", ")}
                  </p>
                </>
              )}
            </div>
          </div>

          {/* Per-room scores */}
          <div className="glass-premium rounded-2xl border border-slate-200 p-5">
            <h4 className="text-sm font-bold text-slate-900 mb-4 flex items-center gap-2">
              <Warehouse className="h-4 w-4 text-brand-700" />
              Score by store room
            </h4>

            {(board?.byStoreRoom || []).length === 0 ? (
              <p className="text-xs text-slate-500">
                No count has been submitted in this window yet.
              </p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {board.byStoreRoom.map((room) => {
                  const tone = scoreTone(room.score);
                  const peak = Math.max(1, ...room.history.map((point) => point.score));
                  return (
                    <div
                      key={room.stockRoomId}
                      className={`p-4 rounded-2xl border ${tone.ring}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-bold text-slate-900 truncate">
                            {room.stockRoom}
                          </div>
                          <div className="text-[10px] text-slate-500">
                            {room.audits} {room.audits === 1 ? "count" : "counts"} •{" "}
                            {room.linesTotal} lines
                          </div>
                        </div>
                        <div className={`text-2xl font-extrabold shrink-0 ${tone.text}`}>
                          {room.score}%
                        </div>
                      </div>

                      {/* One bar per month audited, oldest on the left. */}
                      <div className="mt-3 flex items-end gap-1 h-12">
                        {room.history.map((point) => {
                          const pointTone = scoreTone(point.score);
                          return (
                            <div
                              key={point.period}
                              title={`${shortPeriodLabel(point.period)} — ${point.score}%`}
                              className="flex-1 bg-slate-200/70 rounded-t-md flex items-end overflow-hidden"
                            >
                              <div
                                className={`w-full ${pointTone.bar} rounded-t-md`}
                                style={{
                                  height: `${Math.max(4, (point.score / peak) * 100)}%`,
                                }}
                              />
                            </div>
                          );
                        })}
                      </div>
                      <div className="mt-1 flex justify-between text-[9px] text-slate-400">
                        <span>{shortPeriodLabel(room.history[0]?.period)}</span>
                        <span>
                          {shortPeriodLabel(room.history[room.history.length - 1]?.period)}
                        </span>
                      </div>

                      <div className="mt-3 pt-3 border-t border-slate-200/70 grid grid-cols-2 gap-2 text-[10px]">
                        <div>
                          <div className="text-slate-500">Latest</div>
                          <div className="font-semibold text-slate-900">
                            {periodLabel(room.latest?.period)} • {room.latest?.score}%
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-slate-500">Variance</div>
                          <div className="font-semibold text-slate-900">
                            {formatCurrency(room.varianceValue)}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Month by month */}
          <div className="glass-premium rounded-2xl border border-slate-200 p-5">
            <h4 className="text-sm font-bold text-slate-900 mb-4 flex items-center gap-2">
              <Calendar className="h-4 w-4 text-brand-700" />
              Score and variance by month
            </h4>
            {(board?.byPeriod || []).length === 0 ? (
              <p className="text-xs text-slate-500">Nothing audited in this window.</p>
            ) : (
              <div className="space-y-2.5">
                {board.byPeriod.map((row) => {
                  const tone = scoreTone(row.score);
                  return (
                    <div key={row.period} className="flex items-center gap-3">
                      <span className="w-20 shrink-0 font-mono text-[11px] text-slate-600">
                        {row.period}
                      </span>
                      <div className="flex-1 h-6 bg-slate-100 rounded-lg overflow-hidden relative">
                        <div
                          className={`h-full ${tone.bar} rounded-lg transition-all`}
                          style={{ width: `${row.score}%` }}
                        />
                        {/* Variance rides on the same row so a good score bought
                            at the cost of a big write-off cannot hide. */}
                        <div
                          className="absolute inset-y-0 right-0 h-full bg-slate-900/10 rounded-r-lg"
                          style={{ width: `${(row.varianceValue / peakVariance) * 30}%` }}
                        />
                      </div>
                      <span className={`w-14 shrink-0 text-right text-xs font-bold ${tone.text}`}>
                        {row.score}%
                      </span>
                      <span className="w-28 shrink-0 text-right text-[11px] text-slate-600">
                        {formatCurrency(row.varianceValue)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Audit history */}
          <div className="glass-premium rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
            <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
              <h4 className="text-sm font-bold text-slate-900">Audit history</h4>
              <div className="flex bg-slate-100 p-1.5 rounded-xl border border-slate-200">
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

            {visibleHistory.length === 0 ? (
              <div className="p-12 text-center flex flex-col items-center justify-center">
                <HelpCircle className="h-10 w-10 text-slate-400 mb-3" />
                <h3 className="text-base font-bold text-slate-900 mb-1">No audits here yet</h3>
                <p className="text-xs text-slate-500">
                  A count appears the moment a supervisor opens one for a store room.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-medium text-xs uppercase tracking-wider">
                      <th className="py-4 px-6">Audit #</th>
                      <th className="py-4 px-6">Month</th>
                      <th className="py-4 px-6">Store room</th>
                      <th className="py-4 px-6 text-center">Counted</th>
                      <th className="py-4 px-6 text-center">Discrepancies</th>
                      <th className="py-4 px-6 text-right">Variance</th>
                      <th className="py-4 px-6 text-center">Score</th>
                      <th className="py-4 px-6">By</th>
                      <th className="py-4 px-6">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 text-slate-700">
                    {visibleHistory.map((row) => {
                      const tone = scoreTone(row.score);
                      return (
                        <tr
                          key={row._id}
                          onClick={() => setOpenId(row._id)}
                          className="hover:bg-slate-50 transition-colors cursor-pointer"
                        >
                          <td className="py-3.5 px-6 font-mono text-xs text-brand-700 font-bold">
                            {row.auditNumber}
                          </td>
                          <td className="py-3.5 px-6 text-xs">{periodLabel(row.period)}</td>
                          <td className="py-3.5 px-6 text-xs font-semibold text-slate-900">
                            {row.stockRoomName}
                          </td>
                          <td className="py-3.5 px-6 text-center text-xs">
                            {row.linesCounted}/{row.linesTotal}
                            <span className="block text-[10px] text-slate-400">
                              {row.coverage}%
                            </span>
                          </td>
                          <td className="py-3.5 px-6 text-center text-xs">
                            {row.linesShort + row.linesOver === 0 ? (
                              <span className="text-emerald-600 font-semibold">None</span>
                            ) : (
                              <>
                                <span className="text-rose-600 font-semibold">
                                  {row.linesShort} short
                                </span>
                                <span className="block text-[10px] text-indigo-600">
                                  {row.linesOver} over
                                </span>
                              </>
                            )}
                          </td>
                          <td className="py-3.5 px-6 text-right text-xs font-semibold">
                            {row.varianceValue > 0 ? formatCurrency(row.varianceValue) : "—"}
                          </td>
                          <td className={`py-3.5 px-6 text-center font-extrabold ${tone.text}`}>
                            {row.score}%
                          </td>
                          <td className="py-3.5 px-6 text-xs">
                            {row.submittedBy?.name || row.openedBy?.name || "—"}
                            <span className="block text-[10px] text-slate-400">
                              {formatDate(row.submittedAt || row.openedAt)}
                            </span>
                          </td>
                          <td className="py-3.5 px-6">
                            <span
                              className={`px-2 py-1 rounded-md text-[10px] font-semibold ${
                                AUDIT_STATUS_BADGES[row.status]
                              }`}
                            >
                              {row.status}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {openId && (
        <AuditSheetModal
          auditId={openId}
          onClose={() => setOpenId(null)}
          onChanged={fetchReport}
        />
      )}
    </div>
  );
};

/**
 * One count sheet in full, and the Admin's two decisions on it: sign it off,
 * or hand it back to be finished.
 *
 * Discrepancies float to the top of the sheet. An audit is read to find out
 * what disagreed, and on a five-hundred-line room the eight lines that matter
 * would otherwise be scattered through pages of matches.
 */
const AuditSheetModal = ({ auditId, onClose, onChanged }) => {
  const { showToast } = useNotifications();
  const [audit, setAudit] = useState(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [note, setNote] = useState("");
  const [onlyVariance, setOnlyVariance] = useState(true);
  /** The line whose ledger history the Admin is reading, if any. */
  const [trailLineId, setTrailLineId] = useState(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const { data } = await API.get(`/audits/${auditId}`);
      setAudit(data);
    } catch (error) {
      console.error("Error loading the audit:", error);
      showToast("Failed to load the audit", "error");
    } finally {
      setLoading(false);
    }
  }, [auditId, showToast]);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (path, body) => {
    try {
      setWorking(true);
      const { data } = await API.post(`/audits/${auditId}/${path}`, body);
      showToast(data.message, "success");
      setAudit((prev) => ({ ...prev, ...data.audit }));
      onChanged();
    } catch (error) {
      console.error(`Error on audit ${path}:`, error);
      showToast(error.response?.data?.message || `Could not ${path} the audit`, "error");
    } finally {
      setWorking(false);
    }
  };

  const lines = (audit?.lines || []).filter((line) => {
    if (!onlyVariance) return true;
    const counted = line.countedQuantity !== null && line.countedQuantity !== undefined;
    return !counted || line.countedQuantity !== line.systemQuantity;
  });

  const tone = scoreTone(audit?.score || 0);

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-5xl max-h-[90vh] rounded-2xl bg-white border border-slate-200 shadow-xl flex flex-col overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              {audit?.stockRoomName || "Audit"} — {periodLabel(audit?.period)}
              {audit && (
                <span
                  className={`px-2 py-0.5 rounded-md text-[10px] font-semibold ${
                    AUDIT_STATUS_BADGES[audit.status]
                  }`}
                >
                  {audit.status}
                </span>
              )}
            </h4>
            <p className="text-[11px] font-mono text-brand-700">{audit?.auditNumber}</p>
            {audit && (
              <p className="text-[10px] text-slate-500">
                {audit.scope === "Full"
                  ? "Full count — every item the room held"
                  : `Scheduled count${
                      audit.linesSkipped
                        ? ` — ${audit.linesSkipped} item${
                            audit.linesSkipped === 1 ? " was" : "s were"
                          } not due and left off the sheet`
                        : ""
                    }`}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 cursor-pointer"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {loading || !audit ? (
          <div className="h-64 flex items-center justify-center">
            <Loader2 className="h-6 w-6 text-brand-500 animate-spin" />
          </div>
        ) : (
          <>
            <div className="px-5 py-4 border-b border-slate-200 grid grid-cols-2 lg:grid-cols-5 gap-3 text-xs">
              <div>
                <div className="text-slate-500">Score</div>
                <div className={`text-xl font-extrabold ${tone.text}`}>{audit.score}%</div>
              </div>
              <div>
                <div className="text-slate-500">Counted</div>
                <div className="text-xl font-extrabold text-slate-900">
                  {audit.linesCounted}/{audit.linesTotal}
                </div>
              </div>
              <div>
                <div className="text-slate-500">Accuracy of counted</div>
                <div className="text-xl font-extrabold text-slate-900">{audit.accuracy}%</div>
              </div>
              <div>
                <div className="text-slate-500">Units out</div>
                <div className="text-xl font-extrabold text-slate-900">
                  {audit.varianceQuantity}
                </div>
              </div>
              <div>
                <div className="text-slate-500">Variance value</div>
                <div className="text-xl font-extrabold text-slate-900">
                  {formatCurrency(audit.varianceValue)}
                </div>
              </div>
            </div>

            {(audit.note || audit.reviewNote) && (
              <div className="px-5 py-3 border-b border-slate-200 space-y-1 text-[11px]">
                {audit.note && (
                  <p className="text-slate-600">
                    <span className="font-semibold text-slate-900">Counter's note:</span>{" "}
                    {audit.note}
                  </p>
                )}
                {audit.reviewNote && (
                  <p className="text-slate-600">
                    <span className="font-semibold text-slate-900">Review:</span>{" "}
                    {audit.reviewNote}
                  </p>
                )}
              </div>
            )}

            {/* What the store said about its own discrepancies. Grouped
                rather than left line by line, because the shape of the answers
                is the finding: a month of "explained by movement" is a store
                keeping up, and a month of "unexplained" is one that is not. */}
            {audit.varianceByReason?.length > 0 && (
              <div className="px-5 py-4 border-b border-slate-200 bg-slate-50">
                <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500 mb-2.5">
                  What the discrepancies were put down to
                </div>
                <div className="flex flex-wrap gap-2">
                  {audit.varianceByReason.map((bucket) => (
                    <div
                      key={bucket.reason || "none"}
                      className={`px-3 py-2 rounded-xl ${reasonTone(bucket.reason)}`}
                    >
                      <div className="text-xs font-bold">
                        {bucket.reason || "No reason recorded"}
                      </div>
                      <div className="text-[10px] opacity-90">
                        {bucket.lines} {bucket.lines === 1 ? "line" : "lines"} •{" "}
                        {bucket.quantity} units • {formatCurrency(bucket.value)}
                      </div>
                    </div>
                  ))}
                </div>
                {audit.linesUnexplained > 0 && (
                  <p className="mt-3 text-[11px] text-amber-700">
                    {audit.linesUnexplained}{" "}
                    {audit.linesUnexplained === 1 ? "line" : "lines"} the store could not
                    account for at the shelf. Open the ledger beside one to see whether a
                    recorded movement explains it after all.
                  </p>
                )}
              </div>
            )}

            <div className="px-5 py-2.5 border-b border-slate-200 flex items-center justify-between gap-3">
              <span className="text-[11px] text-slate-500">
                Opened by {audit.openedBy?.name || "—"}
                {audit.submittedBy ? ` • submitted by ${audit.submittedBy.name}` : ""}
                {audit.reviewedBy ? ` • reviewed by ${audit.reviewedBy.name}` : ""}
              </span>
              <label className="flex items-center gap-2 text-[11px] font-semibold text-slate-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={onlyVariance}
                  onChange={(event) => setOnlyVariance(event.target.checked)}
                  className="rounded border-slate-300 cursor-pointer"
                />
                Only lines that did not match
              </label>
            </div>

            <div className="flex-1 overflow-y-auto">
              <table className="w-full text-left text-sm border-collapse">
                <thead className="sticky top-0 bg-slate-50">
                  <tr className="border-b border-slate-200 text-slate-600 font-medium text-xs uppercase tracking-wider">
                    <th className="py-3 px-5">Engineering Stock</th>
                    <th className="py-3 px-5">Rack</th>
                    <th className="py-3 px-5 text-center">System</th>
                    <th className="py-3 px-5 text-center">Counted</th>
                    <th className="py-3 px-5 text-center">Variance</th>
                    <th className="py-3 px-5 text-right">Value</th>
                    <th className="py-3 px-5">Reason given</th>
                    <th className="py-3 px-5">Note</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-slate-700">
                  {lines.map((line) => {
                    const counted =
                      line.countedQuantity !== null && line.countedQuantity !== undefined;
                    const variance = counted ? line.countedQuantity - line.systemQuantity : null;
                    return (
                      <tr key={line._id} className="hover:bg-slate-50">
                        <td className="py-2.5 px-5">
                          <div className="font-semibold text-slate-900 flex items-center gap-2">
                            {line.productName}
                            {line.addedDuringCount && (
                              <span className="px-1.5 py-0.5 rounded-md text-[10px] bg-amber-500/10 text-amber-600 border border-amber-500/20">
                                Found
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] font-mono text-brand-700">
                            {line.productCode || "—"}
                          </div>
                        </td>
                        <td className="py-2.5 px-5 text-xs font-mono text-slate-600">
                          {line.rackNumber || "—"}
                        </td>
                        <td className="py-2.5 px-5 text-center text-xs font-semibold">
                          {/* Withheld by the API on an uncounted line while the
                              count is still open, so the sheet stays blind. */}
                          {line.systemQuantity === null ? (
                            <span className="text-slate-400">Not shown yet</span>
                          ) : (
                            `${line.systemQuantity} ${line.unit}`
                          )}
                        </td>
                        <td className="py-2.5 px-5 text-center text-xs font-semibold">
                          {counted ? line.countedQuantity : <span className="text-slate-400">Not counted</span>}
                        </td>
                        <td className="py-2.5 px-5 text-center text-xs font-bold">
                          {variance === null ? (
                            <span className="text-amber-600">—</span>
                          ) : variance === 0 ? (
                            <span className="inline-flex items-center gap-1 text-emerald-600">
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              Match
                            </span>
                          ) : (
                            <span className={variance > 0 ? "text-indigo-600" : "text-rose-600"}>
                              {variance > 0 ? `+${variance}` : variance}
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-5 text-right text-xs font-semibold">
                          {variance ? formatCurrency(Math.abs(variance) * line.unitCost) : "—"}
                        </td>
                        <td className="py-2.5 px-5">
                          <div className="flex items-center gap-1.5">
                            {variance ? (
                              <span
                                className={`px-2 py-0.5 rounded-md text-[10px] font-semibold whitespace-nowrap ${reasonTone(
                                  line.varianceReason
                                )}`}
                              >
                                {line.varianceReason || "No reason recorded"}
                              </span>
                            ) : (
                              <span className="text-xs text-slate-400">—</span>
                            )}
                            {counted && (
                              <button
                                onClick={() => setTrailLineId(line._id)}
                                title="Reconcile this line against the movement ledger"
                                className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-500 hover:border-brand-300 hover:text-brand-600 cursor-pointer"
                              >
                                <ScrollText className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                        <td className="py-2.5 px-5 text-[11px] italic text-slate-600 max-w-[200px] truncate">
                          {line.note || "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {lines.length === 0 && (
                <div className="p-10 text-center">
                  <CheckCircle2 className="h-8 w-8 text-emerald-500 mx-auto mb-2" />
                  <p className="text-xs text-slate-500">
                    Every counted line matched the system.
                  </p>
                </div>
              )}
            </div>

            {trailLineId && (
              <AuditTrailModal
                auditId={auditId}
                lineId={trailLineId}
                onClose={() => setTrailLineId(null)}
              />
            )}

            <div className="px-5 py-4 border-t border-slate-200 flex flex-wrap items-center justify-end gap-2">
              {audit.status === "Submitted" && (
                <>
                  <input
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    placeholder="Note for the record (optional)"
                    className="flex-1 min-w-[200px] px-3 py-2 rounded-xl border border-slate-200 text-xs focus:outline-none focus:ring-2 focus:ring-brand-500/30"
                  />
                  <button
                    onClick={() => act("reopen")}
                    disabled={working}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60 cursor-pointer"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Send back
                  </button>
                  <button
                    onClick={() => act("review", { note })}
                    disabled={working}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-brand-600 text-white text-xs font-semibold shadow hover:bg-brand-700 disabled:opacity-60 cursor-pointer"
                  >
                    {working ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <CheckCircle2 className="h-3.5 w-3.5" />
                    )}
                    Mark reviewed
                  </button>
                </>
              )}
              {audit.status !== "Submitted" && (
                <button
                  onClick={onClose}
                  className="px-3.5 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer"
                >
                  Close
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default AuditReport;
