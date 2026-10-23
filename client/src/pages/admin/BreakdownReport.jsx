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
import { outputOrDash } from "../../utils/output";
import { useErpRefresh } from "../../hooks/useErpRefresh";

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

/** A date and a time, for the two stamps a response time is measured between. */
const stamp = (value) => {
  if (!value) return "—";
  const d = new Date(String(value).replace(" ", "T"));
  return Number.isNaN(d.getTime())
    ? String(value)
    : d.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
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

  // The top bar's Refresh: read ERPNext again without leaving the screen.
  useErpRefresh(() => load());

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
              How many breakdowns, the downtime, which machines caused it, and how fast each was answered.
            </p>
          </div>
        </div>
        <button className="btn btn-sm btn-neutral" onClick={() => window.print()}>
          <Printer className="h-4 w-4" />
          Print
        </button>
      </div>

      {/* From and To stay: they are how the dates are picked. The period they
          make is no longer printed back as its own card or line. */}
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
          <Headline h={report.headline} />

          {report.headline.failures === 0 ? (
            <div className="table-card">
              <div className="empty">
                <Activity className="h-8 w-8 text-slate-300 mb-2" />
                <p className="empty-title">No breakdowns between these dates</p>
                <p className="empty-sub">Nothing to report, which is the point.</p>
              </div>
            </div>
          ) : (
            <>
              {/* Before the machine table, not after it. Everything below
                  describes how bad those dates were; this names the problems that
                  were not actually solved the last time they were repaired,
                  which is the only part of the report that is about the future. */}
              <Repeats
                rows={report.repeats || []}
                offenders={report.repeatOffenders || []}
                total={report.headline.failures}
              />
              {/* "Where the time goes" and "What kind of failures" were here,
                  removed at the plant's request (Oct 2026). The response time
                  against every breakdown takes the first one's place. */}
              <ResponseTimes rows={report.breakdowns} />
              <PerMachine rows={report.perMachine} />
              <Detail rows={report.breakdowns} />
            </>
          )}
        </>
      )}
    </div>
  );
};

/**
 * Two figures only: how many breakdowns, and the downtime they cost.
 *
 * Production lost, machines affected and the "still open" and "still
 * accruing" notes were dropped at the plant's request (Oct 2026).
 */
const Headline = ({ h }) => (
  <div className="grid grid-cols-2 gap-3">
    <Big label="Breakdowns" value={h.failures} />
    <Big label="Downtime" value={hours(h.downtimeHours)} />
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
 * The response time against every breakdown.
 *
 * Reported (the record being made) until maintenance attended - the same two
 * stamps the list and the record use, measured by the server. One not yet
 * attended has no response time and shows a dash rather than a guess.
 */
const ResponseTimes = ({ rows }) => {
  const measured = rows.map((b) => b.responseHours).filter((h) => h !== null && h !== undefined);
  const average = measured.length ? measured.reduce((s, h) => s + h, 0) / measured.length : null;

  return (
    <div className="table-card">
      <div className="px-5 pt-5">
        <h3 className="section-title">
          <Clock className="inline h-4 w-4 mr-1.5" />
          Response time, every breakdown
        </h3>
        <p className="panel-sub mb-3">
          Reported until attended.
          {average !== null &&
            ` Average ${hours(average)} across the ${measured.length} attended${
              measured.length < rows.length ? `, ${rows.length - measured.length} not yet` : ""
            }.`}
        </p>
      </div>
      <div className="table-scroll">
        <table className="tbl tbl-compact">
          <thead>
            <tr>
              <th>Machine</th>
              <th>Breakdown</th>
              <th>Reported at</th>
              <th>Attended at</th>
              <th className="text-right">Response time</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((b) => (
              <tr key={b.id}>
                <td>
                  <span className="cell-title">{b.machineName}</span>
                  <div className="mono text-slate-500">{b.machine}</div>
                </td>
                <td>
                  <span className="mono text-xs">{b.id}</span>
                </td>
                <td className="text-slate-600">{stamp(b.reportedAt)}</td>
                <td className="text-slate-600">{stamp(b.attendedAt)}</td>
                <td className="text-right tabular-nums">{hours(b.responseHours)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
          None of the {total} failures between these dates were flagged as ones the machine had had
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
            worth a morning — the rest of this report is about how those dates went.
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
            {offenders.length === 1 ? "has" : "have"} more than one repeat between these dates. That is
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

const Detail = ({ rows }) => (
  <div className="table-card">
    <div className="px-5 pt-5">
      <h3 className="section-title">Every breakdown</h3>
    </div>
    <div className="table-scroll">
      <table className="tbl tbl-compact">
        <thead>
          <tr>
            <th>Breakdown</th>
            <th>Machine</th>
            <th>Mode</th>
            <th>Stopped</th>
            <th className="text-right">Response time</th>
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

export default BreakdownReport;
