import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Clock,
  Loader2,
  Printer,
  Repeat2,
  TrendingDown,
} from "lucide-react";

import API from "../../services/api";
import { outputOrDash, outputTotals } from "../../utils/output";

/**
 * The reliability report.
 *
 * Written for somebody who was not in the workshop: it opens with what the
 * month cost, then which machines caused it, then why. Every figure is derived
 * from the breakdown records on the way out, so running it twice on the same
 * window gives the same answer.
 *
 * The definitions are printed alongside the numbers on purpose. MTBF has three
 * or four defensible readings, and a report that does not say which one it used
 * is an argument waiting to happen.
 */

/**
 * Loss is reported as production, never as money.
 *
 * A rupee figure was printed against every machine, worked out from a
 * loss-per-hour rate nobody had agreed. It read as fact and was closer to a
 * guess, and a report the managing director reads has to be defensible line by
 * line. Machines now carry an output rate, so a stoppage is reported as the
 * product it cost.
 *
 * Group totals are given per unit — "1,240 Kg · 380 Nos" — and never summed
 * into one number. The mills are counted in kilos and the presses in pieces,
 * and a single total across them would be arithmetic with no meaning attached
 * to it, which is the same failure the rupee figure had.
 */

const hours = (h) => {
  if (h === null || h === undefined) return "—";
  const n = Number(h);
  if (!Number.isFinite(n)) return "—";
  if (n < 1) return `${Math.round(n * 60)} min`;
  if (n < 72) return `${Math.round(n * 10) / 10} hr`;
  return `${Math.round(n / 24)} days`;
};

const day = (value) => {
  if (!value) return "—";
  const d = new Date(String(value).replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString("en-IN", { dateStyle: "medium" });
};

const iso = (d) => d.toISOString().slice(0, 10);

const BreakdownReport = () => {
  const [report, setReport] = useState(null);
  const [plants, setPlants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [from, setFrom] = useState(() => iso(new Date(Date.now() - 30 * 86_400_000)));
  const [to, setTo] = useState(() => iso(new Date()));
  const [plant, setPlant] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await API.get("/breakdowns/report", { params: { from, to, plant } });
      setReport(data);
      setError("");
    } catch (err) {
      setError(err.response?.data?.message || "Could not build the report");
    } finally {
      setLoading(false);
    }
  }, [from, to, plant]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    API.get("/breakdowns/plants").then(({ data }) => setPlants(data)).catch(() => setPlants([]));
  }, []);

  return (
    <div className="space-y-5">
      <div className="panel print:hidden">
        <div className="flex items-center gap-3">
          <span className="panel-icon">
            <BarChart3 className="h-5 w-5" />
          </span>
          <div>
            <h2 className="panel-title">Breakdown report</h2>
            <p className="panel-sub">
              What breakdowns cost, which machines caused it, and how the time was spent.
            </p>
          </div>
        </div>
        <button className="btn btn-sm btn-neutral" onClick={() => window.print()}>
          <Printer className="h-4 w-4" />
          Print
        </button>
      </div>

      <div className="card p-3 print:hidden">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <div>
            <label className="field-label">From</label>
            <input type="date" className="field field-sm" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="field-label">To</label>
            <input type="date" className="field field-sm" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div>
            <label className="field-label">Plant</label>
            <select
              className="field field-sm cursor-pointer"
              value={plant}
              onChange={(e) => setPlant(e.target.value)}
            >
              <option value="">All plants</option>
              {plants.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {error && (
        <div className="note note-rose">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="h-40 grid place-items-center">
          <Loader2 className="h-6 w-6 animate-spin text-brand-500" />
        </div>
      ) : !report ? null : (
        <>
          <div className="card p-5">
            <p className="eyebrow">Period</p>
            <h3 className="text-lg font-bold tracking-tight text-slate-900">
              {day(report.window.from)} to {day(report.window.to)}
            </h3>
            <p className="text-xs text-slate-500">
              {report.window.days} days · {report.window.plant} ·{" "}
              {report.headline.machinesAffected} of {report.headline.machinesOnRegister} machines
              affected
            </p>
          </div>

          <Headline h={report.headline} />

          {report.headline.failures === 0 ? (
            <div className="table-card">
              <div className="empty">
                <Activity className="h-8 w-8 text-slate-300 mb-2" />
                <p className="empty-title">No breakdowns in this period</p>
                <p className="empty-sub">Nothing to report, which is the point.</p>
              </div>
            </div>
          ) : (
            <>
              {/* Before the machine table, not after it. Everything below
                  describes how bad the period was; this names the problems that
                  were not actually solved the last time they were repaired,
                  which is the only part of the report that is about the future. */}
              <Repeats
                rows={report.repeats || []}
                offenders={report.repeatOffenders || []}
                total={report.headline.failures}
              />
              <TimeSplit h={report.headline} />
              <PerMachine rows={report.perMachine} />
              <ByMode rows={report.byMode} unclassified={report.unclassified} total={report.headline.failures} />
              <Detail rows={report.breakdowns} />
              <Definitions />
            </>
          )}
        </>
      )}
    </div>
  );
};

const Headline = ({ h }) => (
  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
    <Big label="Breakdowns" value={h.failures} sub={h.stillOpen ? `${h.stillOpen} still open` : "all closed"} />
    <Big
      label="Downtime"
      value={hours(h.downtimeHours)}
      sub={h.downtimeStillAccruing ? `${hours(h.downtimeStillAccruing)} still accruing` : ""}
      tone={h.downtimeStillAccruing ? "amber" : ""}
    />
    <Big
      label="Production lost"
      value={outputTotals(h.outputLost) || "—"}
      sub={
        outputTotals(h.outputLost)
          ? "downtime at each machine's own rate"
          : "no output rates recorded yet"
      }
    />
    <Big
      label="Machines affected"
      value={`${h.machinesAffected} of ${h.machinesOnRegister}`}
      sub="on the register"
    />
    <Big
      label="Mean time to repair"
      value={hours(h.mttrHours)}
      sub="stopped until running again"
    />
  </div>
);

const Big = ({ label, value, sub, tone = "" }) => (
  <div className="card p-4">
    <p className="eyebrow">{label}</p>
    <p
      className={`mt-1 text-2xl font-bold tracking-tight tabular-nums ${
        tone === "rose" ? "text-rose-600" : tone === "amber" ? "text-amber-600" : "text-slate-900"
      }`}
    >
      {value}
    </p>
    {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
  </div>
);

/**
 * Where the downtime actually went.
 *
 * Two intervals, since assessment and planning moved to the phone: the delay
 * before anybody started, and the repair itself. They have completely
 * different fixes — more fitters against the first, better spares or training
 * against the second.
 */
const TimeSplit = ({ h }) => {
  const parts = [
    { label: "Before work started", value: h.meanResponseHours, tone: "bg-amber-400" },
    { label: "Under repair", value: h.meanRepairHours, tone: "bg-emerald-400" },
  ];
  const known = parts.filter((p) => p.value !== null && p.value !== undefined);
  const total = known.reduce((s, p) => s + p.value, 0);

  return (
    <div className="card p-5">
      <h3 className="section-title">
        <Clock className="inline h-4 w-4 mr-1.5" />
        Where the time goes
      </h3>
      <p className="panel-sub mb-4">Average across every breakdown in the period.</p>

      {known.length === 0 ? (
        <p className="text-sm text-slate-500">
          Not enough recorded yet. These fill in as breakdowns are assessed and repaired with the
          new fields.
        </p>
      ) : (
        <>
          <div className="flex h-3 w-full overflow-hidden rounded-full bg-slate-100">
            {known.map((p) => (
              <div
                key={p.label}
                className={p.tone}
                style={{ width: `${total ? (p.value / total) * 100 : 0}%` }}
                title={`${p.label}: ${hours(p.value)}`}
              />
            ))}
          </div>
          <div className="mt-3 grid sm:grid-cols-2 gap-3">
            {parts.map((p) => (
              <div key={p.label}>
                <div className="flex items-center gap-2">
                  <span className={`h-2.5 w-2.5 rounded-full ${p.tone}`} />
                  <span className="text-xs text-slate-600">{p.label}</span>
                </div>
                <p className="mt-0.5 text-lg font-bold tabular-nums text-slate-900">
                  {hours(p.value)}
                </p>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

const PerMachine = ({ rows }) => (
  <div className="table-card">
    <div className="px-5 pt-5">
      <h3 className="section-title">
        <TrendingDown className="inline h-4 w-4 mr-1.5" />
        By machine
      </h3>
      <p className="panel-sub mb-3">Worst first, by downtime.</p>
    </div>
    <div className="table-scroll">
      <table className="tbl">
        <thead>
          <tr>
            <th>Machine</th>
            <th className="text-right">Failures</th>
            <th className="text-right">Repeats</th>
            <th className="text-right">Downtime</th>
            <th className="text-right">Production lost</th>
            <th className="text-right">MTBF</th>
            <th className="text-right">MTTR</th>
            <th className="text-right">Availability</th>
            <th className="text-right">Labour</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => (
            <tr key={m.machine}>
              <td>
                <span className="cell-title">{m.machineName}</span>
                <div className="mono text-slate-500">
                  {m.machine}
                  {m.criticality ? ` · ${m.criticality.replace(/^[ABC] - /, "")}` : ""}
                </div>
              </td>
              <td className="text-right tabular-nums">
                {m.failures}
                {m.stillDown > 0 && (
                  <span className="ml-1 badge badge-amber badge-soft">{m.stillDown} open</span>
                )}
              </td>
              <td className="text-right tabular-nums">
                {m.repeats > 0 ? (
                  <span className="badge badge-rose badge-soft">{m.repeats}</span>
                ) : (
                  <span className="text-slate-300">—</span>
                )}
              </td>
              <td className="text-right tabular-nums">{hours(m.downtimeHours)}</td>
              {/* One machine, so one unit — safe to print as a single figure. */}
              <td className="text-right tabular-nums">
                {outputOrDash(m.outputLost, m.outputUom)}
              </td>
              <td className="text-right tabular-nums">
                {hours(m.mtbf.hours)}
                {m.mtbf.basis === "calendar" && (
                  <div className="text-[10px] text-amber-600">calendar hours</div>
                )}
              </td>
              <td className="text-right tabular-nums">{hours(m.mttrHours)}</td>
              <td className="text-right tabular-nums">
                {m.availability === null ? "—" : `${m.availability}%`}
              </td>
              <td className="text-right tabular-nums">{m.labourHours ? `${m.labourHours} hr` : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
);

/**
 * The failures somebody has said out loud have happened before.
 *
 * Its own section rather than a column, because it is read differently from
 * everything else here. The rest of the report describes how bad the period
 * was; this names the machines whose problems were not actually solved.
 *
 * It counts only what was flagged at closing by the person doing the analysis —
 * never a guess made by matching text. That means it undercounts while people
 * get into the habit of ticking it, and undercounting is the right way for this
 * particular number to be wrong: a false repeat sends a manager to a machine
 * that is fine.
 */
const Repeats = ({ rows, offenders, total }) => {
  if (!rows.length) {
    return (
      <div className="card p-5">
        <h3 className="section-title">Repeat failures</h3>
        <p className="panel-sub">
          None of the {total} failures in this period were flagged as ones the machine had had
          before. Worth reading twice — it means either the fixes are holding, or nobody is ticking
          the box when they close a breakdown.
        </p>
      </div>
    );
  }

  return (
    <div className="card p-5 border-rose-300">
      <div className="flex items-start gap-2.5 mb-3">
        <span className="panel-icon bg-rose-100 text-rose-700">
          <Repeat2 className="h-4 w-4" />
        </span>
        <div>
          <h3 className="section-title">Repeat failures</h3>
          <p className="panel-sub">
            {rows.length} of {total} failures were the same problem coming back. These are the ones
            worth a morning — the rest of this report is about how the period went.
          </p>
        </div>
      </div>

      {offenders.length > 0 && (
        <div className="note note-rose mb-3">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>
            {offenders
              .map((m) => `${m.machineName} (${m.repeats} of ${m.failures})`)
              .join(", ")}{" "}
            {offenders.length === 1 ? "has" : "have"} more than one repeat in this period. That is
            not a machine that failed twice — it is a problem nobody has got to the bottom of.
          </span>
        </div>
      )}

      <div className="table-scroll">
        <table className="tbl tbl-compact">
          <thead>
            <tr>
              <th>Breakdown</th>
              <th>Machine</th>
              <th>Mode</th>
              <th>Stopped</th>
              <th className="text-right">Downtime</th>
              <th>Root cause</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((b) => (
              <tr key={b.id}>
                <td>
                  <span className="mono text-xs">{b.id}</span>
                  {/* The one it repeats, where somebody named it. Without this
                      the section is a list of dates; with it, it is a chain. */}
                  {b.repeatOf && (
                    <div className="text-[10px] text-slate-500">after {b.repeatOf}</div>
                  )}
                </td>
                <td>{b.machineName}</td>
                <td className="text-slate-600">{b.failureMode || "—"}</td>
                <td className="text-slate-600">{day(b.stoppedAt)}</td>
                <td className="text-right tabular-nums">{hours(b.downtimeHours)}</td>
                <td className="text-slate-600 max-w-xs">{b.rootCause || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const ByMode = ({ rows, unclassified, total }) => (
  <div className="card p-5">
    <h3 className="section-title">What kind of failures</h3>
    <p className="panel-sub mb-3">
      {unclassified > 0
        ? `${unclassified} of ${total} have no failure mode recorded — they were assessed before the field existed.`
        : "Every breakdown in the period is classified."}
    </p>

    {rows.length === 0 ? (
      <p className="text-sm text-slate-500">Nothing classified yet.</p>
    ) : (
      <div className="space-y-2">
        {rows.map((r) => {
          const widest = rows[0].downtimeHours || 1;
          return (
            <div key={r.mode} className="flex items-center gap-3">
              <span className="w-32 shrink-0 text-sm text-slate-700">{r.mode}</span>
              <div className="flex-1 h-6 rounded-lg bg-slate-100 overflow-hidden">
                <div
                  className="h-full bg-brand-500/70 rounded-lg"
                  style={{ width: `${(r.downtimeHours / widest) * 100}%` }}
                />
              </div>
              <span className="w-40 shrink-0 text-right text-xs text-slate-600 tabular-nums">
                {r.failures} · {hours(r.downtimeHours)}
                {outputTotals(r.outputLost) ? (
                  // A mode spans machines, so this can straddle units.
                  <div className="text-slate-500">{outputTotals(r.outputLost)}</div>
                ) : null}
              </span>
            </div>
          );
        })}
      </div>
    )}
  </div>
);

const Detail = ({ rows }) => (
  <div className="table-card">
    <div className="px-5 pt-5">
      <h3 className="section-title">Every breakdown in the period</h3>
    </div>
    <div className="table-scroll">
      <table className="tbl tbl-compact">
        <thead>
          <tr>
            <th>Breakdown</th>
            <th>Machine</th>
            <th>Mode</th>
            <th>Stopped</th>
            <th className="text-right">Before start</th>
            <th className="text-right">Repair</th>
            <th className="text-right">Downtime</th>
            <th className="text-right">Labour</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((b) => (
            <tr key={b.id} className={b.repeatFailure ? "bg-rose-50/60" : ""}>
              <td>
                <span className="mono text-xs">{b.id}</span>
                {!b.finished && <span className="ml-1 badge badge-amber badge-soft">open</span>}
                {b.repeatFailure && (
                  <span className="ml-1 badge badge-rose badge-soft">repeat</span>
                )}
              </td>
              <td>{b.machineName}</td>
              <td className="text-slate-600">{b.failureMode || "—"}</td>
              <td className="text-slate-600">{day(b.stoppedAt)}</td>
              <td className="text-right tabular-nums">{hours(b.responseHours)}</td>
              <td className="text-right tabular-nums">{hours(b.repairHours)}</td>
              <td className="text-right tabular-nums">{hours(b.downtimeHours)}</td>
              <td className="text-right tabular-nums">{b.labourHours || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
);

/**
 * Printed with the report, not tucked away.
 *
 * Every one of these has more than one defensible definition, and a number
 * whose definition is unstated is a number two people will read differently.
 */
const Definitions = () => (
  <div className="card p-5">
    <h3 className="section-title mb-3">How these are worked out</h3>
    <dl className="space-y-3 text-sm">
      {[
        [
          "MTBF — mean time between failures",
          "Operating hours the machine was fit to run, divided by the number of failures. Measured against the hours it was scheduled to run, not calendar hours: a press worked one shift a day has not failed every 24 hours because the clock ran overnight. Where a machine has no running hours on its record, calendar hours are used and the figure is marked.",
        ],
        [
          "MTTR — mean time to repair",
          "Stopped until running again, averaged. The whole stoppage, not the time with a spanner in hand — production does not care that the fitter was quick if the bearing took two days to arrive. The wrench-time-only figure is shown separately as “under repair”, and the gap before anybody started as “before work started”.",
        ],
        [
          "Availability",
          "The share of scheduled hours the machine was fit to run, over the same window.",
        ],
        [
          "Production lost",
          "Downtime multiplied by the machine's output-per-hour, in the unit that machine is counted in. It replaced a rupee figure that rested on a loss rate nobody had agreed. Totals across machines are given per unit and never added together, because the mills are counted in kilos and the presses in pieces. A machine with no output rate on its record contributes nothing and shows a dash — it is missing, not zero.",
        ],
        [
          "Still open",
          "A breakdown that has not run again yet counts its downtime up to now, and keeps accruing. Treating it as zero would report a machine that is down right now as fully available.",
        ],
        [
          "Cancelled reports",
          "Left out entirely. A report that turned out to be nothing was not a failure, and counting it would inflate the failure count and depress every mean that divides by it.",
        ],
      ].map(([term, meaning]) => (
        <div key={term}>
          <dt className="font-semibold text-slate-800">{term}</dt>
          <dd className="text-slate-600">{meaning}</dd>
        </div>
      ))}
    </dl>
  </div>
);

export default BreakdownReport;
