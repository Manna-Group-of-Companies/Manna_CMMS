import { useCallback, useEffect, useState } from "react";
import { Activity, ChevronRight, History, Loader2 } from "lucide-react";

import API from "../../services/api";
import { outputLabel } from "../../utils/output";
import BreakdownDetail from "./BreakdownDetail";

/**
 * Everything this machine has done to itself.
 *
 * The register says what a machine is; this says what it keeps doing. The two
 * belong on the same page — somebody opening a press to check its gearbox
 * rating is usually the same person wondering why they are opening it again.
 *
 * Every figure comes from the same module the plant-wide report uses, so a
 * machine's availability here and its availability there cannot disagree.
 */

const STATE_STYLE = {
  Reported: "badge-rose",
  "Under Repair": "badge-amber",
  Repaired: "badge-emerald",
  Closed: "badge-slate",
};

const PRIORITY_STYLE = {
  Critical: "badge-rose",
  High: "badge-orange",
  Medium: "badge-amber",
  Low: "badge-slate",
};

/**
 * Loss is shown as production, never as money.
 *
 * A rupee figure per stoppage used to be printed against every breakdown,
 * worked out from a loss-per-hour rate nobody had agreed. It read as fact and
 * was closer to a guess. Machines now carry an output rate instead, so a
 * stoppage is reported as the product it cost — in the unit that machine is
 * counted in, which is what the plant already thinks in.
 */

const hours = (h) => {
  if (h === null || h === undefined) return "—";
  const n = Number(h);
  if (!Number.isFinite(n)) return "—";
  if (n < 1) return `${Math.round(n * 60)} min`;
  if (n < 72) return `${Math.round(n * 10) / 10} hr`;
  return `${Math.round(n / 24)} days`;
};

const when = (v) => {
  if (!v) return "—";
  const d = new Date(String(v).replace(" ", "T"));
  return Number.isNaN(d.getTime())
    ? String(v)
    : d.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
};

const MachineHistory = ({ machineId }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [opened, setOpened] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: d } = await API.get(`/assets/${machineId}/history`);
      setData(d);
      setError("");
    } catch (err) {
      setError(err.response?.data?.message || "Could not load the history");
    } finally {
      setLoading(false);
    }
  }, [machineId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="card p-5">
        <h3 className="section-title mb-3">
          <History className="inline h-4 w-4 mr-1.5" />
          Breakdown history
        </h3>
        <div className="h-20 grid place-items-center">
          <Loader2 className="h-5 w-5 animate-spin text-brand-500" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card p-5">
        <h3 className="section-title mb-2">Breakdown history</h3>
        <div className="note note-rose">{error}</div>
      </div>
    );
  }

  const s = data.summary;

  return (
    <div className="card p-5">
      <div className="mb-3">
        <h3 className="section-title">
          <History className="inline h-4 w-4 mr-1.5" />
          Breakdown history
        </h3>
        <p className="panel-sub">
          The last {Math.round(data.window.days / 30)} months. Every breakdown reported against this
          machine.
        </p>
      </div>

      {s.failures === 0 ? (
        <div className="empty-inline">
          <Activity className="h-6 w-6 text-slate-300 mb-1" />
          <p className="empty-sub">
            No breakdowns recorded in this period. Either it has been reliable, or its stoppages are
            not being reported.
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            <Fig
              label="Breakdowns"
              value={s.failures}
              sub={s.stillOpen ? `${s.stillOpen} still open` : "all closed"}
              tone={s.stillOpen ? "amber" : ""}
            />
            <Fig
              label="Total downtime"
              value={hours(s.downtimeHours)}
              sub={s.repeats ? `${s.repeats} were repeats` : "stopped time"}
              tone={s.repeats ? "rose" : ""}
            />
            <Fig label="Labour" value={`${s.labourHours || 0} hrs`} sub="person-hours on repairs" />
            <Fig
              label="Availability"
              value={s.availability === null ? "—" : `${s.availability}%`}
              sub="of scheduled hours"
            />
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            <Fig label="MTBF" value={hours(s.mtbf?.hours)} sub={`${s.mtbf?.basis || ""} hours`} />
            <Fig label="MTTR" value={hours(s.mttrHours)} sub="stopped to running" />
            <Fig label="Mean response" value={hours(s.meanResponseHours)} sub="until work started" />
            <Fig label="Mean repair" value={hours(s.meanRepairHours)} sub="work to running" />
          </div>

          {data.byMode.length > 0 && (
            <div className="mb-4">
              <p className="kv-label mb-1.5">What kind of failures</p>
              <div className="flex flex-wrap gap-2">
                {data.byMode.map((m) => (
                  <span key={m.mode} className="badge badge-slate badge-soft">
                    {m.mode}: {m.failures} · {hours(m.downtimeHours)}
                  </span>
                ))}
                {data.unclassified > 0 && (
                  <span className="badge badge-amber badge-soft">
                    {data.unclassified} not classified
                  </span>
                )}
              </div>
            </div>
          )}

          <p className="kv-label mb-1.5">Every breakdown</p>
          <ul className="divide-y divide-slate-100">
            {data.breakdowns.map((b) => (
              <li key={b.id}>
                <button
                  onClick={() => setOpened(b.id)}
                  className="w-full text-left py-3 flex items-start gap-3 hover:bg-slate-50 -mx-2 px-2 rounded-lg cursor-pointer"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="mono text-xs text-slate-500">{b.id}</span>
                      <span className={`badge ${STATE_STYLE[b.state] || "badge-slate"}`}>{b.state}</span>
                      {b.priority && (
                        <span className={`badge ${PRIORITY_STYLE[b.priority] || "badge-slate"}`}>
                          {b.priority}
                        </span>
                      )}
                      {b.failureMode && (
                        <span className="badge badge-slate badge-soft">{b.failureMode}</span>
                      )}
                      {!b.finished && <span className="badge badge-amber">still down</span>}
                      {/* Flagged at closing. On the row because a machine whose
                          history is three repeats and two one-offs reads
                          completely differently from one with five one-offs,
                          and the count alone cannot show that. */}
                      {b.repeatFailure && <span className="badge badge-rose">repeat</span>}
                    </div>

                    <p className="mt-1 text-xs text-slate-500">
                      Stopped {when(b.stoppedAt)}
                      {b.finished ? ` · running again ${when(b.completedAt)}` : ""}
                    </p>

                    <p className="mt-0.5 text-xs text-slate-600 tabular-nums">
                      down {hours(b.downtimeHours)}
                      {outputLabel(b.outputLost, b.outputUom)
                        ? ` · ${outputLabel(b.outputLost, b.outputUom)} lost`
                        : ""}
                      {b.responseHours !== null ? ` · responded in ${hours(b.responseHours)}` : ""}
                      {b.repairHours !== null ? ` · repair ${hours(b.repairHours)}` : ""}
                    </p>

                    {/* What it turned out to be, on the row. The history reads
                        as a story this way rather than a list of dates. */}
                    {b.rootCause ? (
                      <p className="mt-1 text-xs text-slate-700">
                        <span className="font-semibold">Root cause:</span> {b.rootCause}
                      </p>
                    ) : b.likelyCause ? (
                      <p className="mt-1 text-xs text-slate-500 italic">
                        Thought to be: {b.likelyCause}
                      </p>
                    ) : null}
                  </div>
                  <ChevronRight className="h-4 w-4 text-slate-300 shrink-0 mt-1" />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {opened && (
        <BreakdownDetail id={opened} onClose={() => setOpened("")} onChanged={load} />
      )}
    </div>
  );
};

const Fig = ({ label, value, sub, tone = "" }) => (
  <div className="rounded-xl border border-slate-200 p-3">
    <p className="eyebrow">{label}</p>
    <p
      className={`mt-0.5 text-lg font-bold tracking-tight tabular-nums ${
        tone === "rose" ? "text-rose-600" : tone === "amber" ? "text-amber-600" : "text-slate-900"
      }`}
    >
      {value}
    </p>
    {sub && <p className="text-[11px] text-slate-500">{sub}</p>}
  </div>
);

export default MachineHistory;
