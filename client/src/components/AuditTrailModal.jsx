import { useCallback, useEffect, useState } from "react";
import API from "../services/api";
import { useNotifications } from "../context/NotificationContext";
import { reasonTone } from "../utils/audit";
import {
  Loader2,
  X,
  ArrowDownLeft,
  ArrowUpRight,
  Minus,
  AlertTriangle,
  HelpCircle,
  ScrollText,
} from "lucide-react";

/**
 * What the ledger says happened to one audit line since it was last counted.
 *
 * A variance says the shelf and the system disagree; it does not say which is
 * wrong. This does the reconciliation in the open — last count, plus every
 * movement since, equals what should be there — so the Admin can tell stock
 * that walked out unrecorded from a balance that has drifted from its own
 * ledger. The two need opposite responses, and a screen that showed them the
 * same way would send somebody to search a shelf for a bug in the software.
 */
const AuditTrailModal = ({ auditId, lineId, onClose }) => {
  const { showToast } = useNotifications();
  const [trail, setTrail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const { data } = await API.get(`/audits/${auditId}/lines/${lineId}/trail`);
      setTrail(data);
      setError("");
    } catch (requestError) {
      const message =
        requestError.response?.data?.message || "Could not read the movement history";
      setError(message);
      showToast(message, "error");
    } finally {
      setLoading(false);
    }
  }, [auditId, lineId, showToast]);

  useEffect(() => {
    load();
  }, [load]);

  const stamp = (value) =>
    value
      ? new Date(value).toLocaleString([], {
          day: "2-digit",
          month: "short",
          year: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        })
      : "—";

  const signed = (value) =>
    value === null || value === undefined ? "—" : value > 0 ? `+${value}` : String(value);

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col">
        <div className="px-6 py-4 border-b border-slate-200 flex items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <ScrollText className="h-4 w-4 text-brand-600" />
              {trail?.line?.productName || "Movement history"}
            </h3>
            <p className="text-[11px] text-slate-500">
              {trail
                ? `${trail.stockRoom} • ${trail.auditNumber} • since ${
                    trail.previousCount
                      ? `the ${trail.previousCount.period} count`
                      : "the ledger begins"
                  }`
                : "Reading the ledger…"}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {loading ? (
          <div className="p-16 flex items-center justify-center">
            <Loader2 className="h-6 w-6 text-brand-500 animate-spin" />
          </div>
        ) : error ? (
          <div className="p-12 text-center">
            <AlertTriangle className="h-8 w-8 text-slate-400 mx-auto mb-2" />
            <p className="text-xs text-slate-600">{error}</p>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto">
            {/* The reconciliation, spelled out rather than asserted. */}
            <div className="px-6 py-5 bg-slate-50 border-b border-slate-200">
              {trail.previousCount ? (
                <>
                  <div className="flex flex-wrap items-end gap-x-3 gap-y-2 text-sm">
                    <Figure
                      label={`Counted ${trail.previousCount.period}`}
                      value={trail.previousCount.countedQuantity}
                    />
                    <span className="pb-2 text-slate-400 font-bold">+</span>
                    <Figure label="Ledger since" value={signed(trail.netMovement)} />
                    <span className="pb-2 text-slate-400 font-bold">=</span>
                    <Figure label="Should be on the shelf" value={trail.expectedQuantity} strong />
                    <span className="pb-2 text-slate-400 font-bold">vs</span>
                    <Figure label="Counted now" value={trail.line.countedQuantity} strong />
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <Verdict
                      tone={trail.unrecordedMovement ? "rose" : "emerald"}
                      heading={
                        trail.unrecordedMovement
                          ? `${Math.abs(trail.unrecordedMovement)} ${trail.line.unit || "units"} moved with nothing written down`
                          : "Every unit is accounted for by the ledger"
                      }
                      body={
                        trail.unrecordedMovement
                          ? "The shelf disagrees with the last count plus everything recorded since. This is stock that left or arrived without a movement behind it."
                          : "The count matches the last count adjusted by recorded movements — the store and the ledger tell the same story."
                      }
                    />
                    <Verdict
                      tone={trail.systemDrift ? "amber" : "slate"}
                      heading={
                        trail.systemDrift
                          ? `The balance is ${signed(trail.systemDrift)} away from its own ledger`
                          : "The balance agrees with its own ledger"
                      }
                      body={
                        trail.systemDrift
                          ? "The system quantity does not follow from the movements recorded against it. That is a question for the software, not for the shelf."
                          : "The system quantity is exactly what the recorded movements add up to."
                      }
                    />
                  </div>
                </>
              ) : (
                <div className="flex items-start gap-2 text-xs text-slate-600">
                  <HelpCircle className="h-4 w-4 text-slate-400 shrink-0 mt-0.5" />
                  <p>
                    This item has never been counted in {trail.stockRoom} before, so there is no
                    baseline to reconcile against. The movements below are its recent history —
                    this month's count becomes the baseline the next one is measured from.
                  </p>
                </div>
              )}

              {trail.partial && (
                <div className="mt-4 flex items-start gap-2 px-3 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-800">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  <p>
                    {trail.unattributed} of these movements were recorded without naming a store
                    room, so they could not be placed on this shelf either way. The sum above is
                    as close as the ledger allows, not a proof.
                  </p>
                </div>
              )}
            </div>

            <div className="px-6 py-4 flex flex-wrap items-center gap-2 text-[11px] text-slate-600 border-b border-slate-200">
              <span className="font-semibold text-slate-700">This month:</span>
              <span>
                counted {trail.line.countedQuantity ?? "—"}, system {trail.line.systemQuantity},
                variance {signed(trail.line.variance)}
              </span>
              {trail.line.varianceReason !== undefined && trail.line.variance !== 0 && (
                <span
                  className={`px-2 py-0.5 rounded-md text-[10px] font-semibold ${reasonTone(
                    trail.line.varianceReason
                  )}`}
                >
                  {trail.line.varianceReason || "No reason recorded"}
                </span>
              )}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-medium text-[11px] uppercase tracking-wider">
                    <th className="py-3 px-6">When</th>
                    <th className="py-3 px-6">Movement</th>
                    <th className="py-3 px-6">Rooms</th>
                    <th className="py-3 px-6">Reference</th>
                    <th className="py-3 px-6 text-center">Qty</th>
                    <th className="py-3 px-6 text-center">This shelf</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-slate-700">
                  {trail.movements.map((movement) => (
                    <tr
                      key={movement._id}
                      className={movement.attributed ? "" : "bg-amber-50/40"}
                    >
                      <td className="py-3 px-6 text-[11px] text-slate-500 whitespace-nowrap">
                        {stamp(movement.createdAt)}
                      </td>
                      <td className="py-3 px-6">
                        <div className="text-xs font-semibold text-slate-900">
                          {movement.type.replaceAll("_", " ").toLowerCase()}
                        </div>
                        <div className="text-[10px] text-slate-500">
                          {movement.performedBy?.name || "—"}
                        </div>
                      </td>
                      <td className="py-3 px-6 text-[11px] text-slate-600">
                        {movement.fromRoom || movement.toRoom
                          ? `${movement.fromRoom || "—"} → ${movement.toRoom || "—"}`
                          : "not recorded"}
                      </td>
                      <td className="py-3 px-6 text-[11px] font-mono text-brand-700">
                        {movement.reference || "—"}
                      </td>
                      <td className="py-3 px-6 text-center text-xs font-semibold">
                        {movement.quantity}
                      </td>
                      <td className="py-3 px-6 text-center text-xs font-bold">
                        {movement.roomEffect === null ? (
                          <span className="inline-flex items-center gap-1 text-amber-600">
                            <HelpCircle className="h-3.5 w-3.5" />
                            unknown
                          </span>
                        ) : movement.roomEffect > 0 ? (
                          <span className="inline-flex items-center gap-1 text-emerald-600">
                            <ArrowDownLeft className="h-3.5 w-3.5" />+{movement.roomEffect}
                          </span>
                        ) : movement.roomEffect < 0 ? (
                          <span className="inline-flex items-center gap-1 text-rose-600">
                            <ArrowUpRight className="h-3.5 w-3.5" />
                            {movement.roomEffect}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-slate-400">
                            <Minus className="h-3.5 w-3.5" />
                            other room
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {trail.movements.length === 0 && (
                <div className="p-12 text-center">
                  <ScrollText className="h-8 w-8 text-slate-400 mx-auto mb-2" />
                  <p className="text-xs text-slate-500">
                    Nothing has moved against this item in the window. A variance here was on the
                    shelf before the last count closed, or happened without the ledger seeing it.
                  </p>
                </div>
              )}

              {trail.truncated && (
                <div className="px-6 py-3 text-[11px] text-slate-500 border-t border-slate-200">
                  Only the first 200 movements are shown; the totals above cover the same 200.
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

/** One number in the reconciliation line, with what it is underneath it. */
const Figure = ({ label, value, strong = false }) => (
  <div>
    <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-0.5">{label}</div>
    <div
      className={`px-3 py-1.5 rounded-xl border text-center font-bold ${
        strong
          ? "bg-white border-slate-300 text-slate-900"
          : "bg-white/60 border-slate-200 text-slate-700"
      }`}
    >
      {value === null || value === undefined ? "—" : value}
    </div>
  </div>
);

const VERDICT_TONES = {
  rose: "bg-rose-500/10 border-rose-500/20 text-rose-700",
  amber: "bg-amber-500/10 border-amber-500/20 text-amber-800",
  emerald: "bg-emerald-500/10 border-emerald-500/20 text-emerald-700",
  slate: "bg-white border-slate-200 text-slate-600",
};

/** What one side of the reconciliation means, said in words rather than signs. */
const Verdict = ({ tone, heading, body }) => (
  <div className={`px-3.5 py-3 rounded-xl border ${VERDICT_TONES[tone]}`}>
    <div className="text-xs font-bold mb-1">{heading}</div>
    <p className="text-[11px] leading-relaxed opacity-90">{body}</p>
  </div>
);

export default AuditTrailModal;
