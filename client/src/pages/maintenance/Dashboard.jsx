import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Clock,
  Hammer,
  Plus,
  Wrench,
  Zap,
} from "lucide-react";

import API from "../../services/api";
import BreakdownDetail from "./BreakdownDetail";
import MaintenanceRequestDetail from "./MaintenanceRequestDetail";
import { useAuth, MANAGER, PRODUCTION_MANAGER } from "../../context/AuthContext";
import { maySee, navFor } from "../../config/access";
import { WorkThumb } from "../../components/WorkUi";
import DowntimeChart from "../../components/charts/DowntimeChart";
import StatusDonut from "../../components/charts/StatusDonut";
import { formatHours } from "../../utils/formatHours";
import { useErpRefresh } from "../../hooks/useErpRefresh";

/**
 * Home for everybody who follows breakdowns or maintenance requests: the two
 * summed up in four figures, the most recent of both, and the way to the rest
 * of the menu.
 *
 * It reads the same two lists the Breakdowns and Maintenance Requests screens
 * do, so it can show nothing either of those would not - and a role allowed
 * only one of them is only asked for that one.
 */

/** The same colours the Breakdowns and Maintenance Requests screens use. */
const STATE_STYLE = {
  Reported: "badge-rose",
  Requested: "badge-amber",
  Attended: "badge-orange",
  "Under Repair": "badge-amber",
  "In Progress": "badge-cyan",
  Repaired: "badge-emerald",
  Completed: "badge-emerald",
  Closed: "badge-slate",
  Cancelled: "badge-slate",
};

const PRIORITY_STYLE = {
  Critical: "badge-rose",
  High: "badge-orange",
  Medium: "badge-amber",
  Low: "badge-slate",
};

const day = (value) =>
  value
    ? new Date(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
    : "";

/* ------------------------------------------------------------- Chart data */

const DAY_MS = 86_400_000;
const pad2 = (n) => String(n).padStart(2, "0");
/** Local yyyy-mm-dd; toISOString would give yesterday for the first hours of an Indian day. */
const iso = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const startOfDay = (d) => {
  const z = new Date(d);
  z.setHours(0, 0, 0, 0);
  return z;
};
const addDays = (d, n) => startOfDay(new Date(startOfDay(d).getTime() + n * DAY_MS + DAY_MS / 2));
const addMonths = (d, n) => new Date(d.getFullYear(), d.getMonth() + n, 1);
const parseAt = (v) => new Date(String(v || "").replace(" ", "T"));
const short = (d) => d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });

/**
 * The chart's three ranges: the window, how it is cut into points, and the
 * window of the same length just before it, which is the grey line.
 */
const RANGES = {
  week: {
    label: "Week",
    period: "Last 7 days",
    previous: "7 days before",
    window: (today) => {
      const start = addDays(today, -6);
      return { start, end: today, prevStart: addDays(start, -7), prevEnd: addDays(start, -1) };
    },
    buckets: (start) =>
      Array.from({ length: 7 }, (_, i) => {
        const d = addDays(start, i);
        return {
          label: d.toLocaleDateString("en-IN", { weekday: "short" }),
          detail: d.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "short" }),
        };
      }),
    indexOf: (date, start) => Math.floor((startOfDay(date) - start) / DAY_MS),
  },
  month: {
    label: "Month",
    period: "Last 4 weeks",
    previous: "4 weeks before",
    window: (today) => {
      const start = addDays(today, -27);
      return { start, end: today, prevStart: addDays(start, -28), prevEnd: addDays(start, -1) };
    },
    buckets: (start) =>
      Array.from({ length: 4 }, (_, i) => ({
        label: `W${i + 1}`,
        detail: `${short(addDays(start, i * 7))} – ${short(addDays(start, i * 7 + 6))}`,
      })),
    indexOf: (date, start) => Math.floor((startOfDay(date) - start) / (7 * DAY_MS)),
  },
  year: {
    label: "Year",
    period: "Last 12 months",
    previous: "12 months before",
    window: (today) => {
      const start = addMonths(today, -11);
      return { start, end: today, prevStart: addMonths(start, -12), prevEnd: addDays(start, -1) };
    },
    buckets: (start) =>
      Array.from({ length: 12 }, (_, i) => {
        const d = addMonths(start, i);
        return {
          label: d.toLocaleDateString("en-IN", { month: "short" }),
          detail: d.toLocaleDateString("en-IN", { month: "long", year: "numeric" }),
        };
      }),
    indexOf: (date, start) =>
      date.getFullYear() * 12 + date.getMonth() - (start.getFullYear() * 12 + start.getMonth()),
  },
};

/** Each breakdown's downtime, added to the point it stopped in. */
const bucketise = (range, breakdowns, start) => {
  const points = range.buckets(start).map((b) => ({ ...b, value: 0 }));
  for (const b of breakdowns || []) {
    const i = range.indexOf(parseAt(b.stoppedAt), start);
    if (i >= 0 && i < points.length) points[i].value += Number(b.downtimeHours || 0);
  }
  return points.map((p) => ({ ...p, value: Math.round(p.value * 10) / 10 }));
};

/**
 * Average availability across every machine on the register, the report's own
 * per-machine figure. A machine with no breakdown in the window was fit to run
 * for all of it, so it counts as 100% rather than being left out.
 */
const fleetUptime = (report) => {
  const h = report?.headline;
  if (!h?.machinesOnRegister) return null;
  const listed = report.perMachine || [];
  const known = listed.filter((m) => Number.isFinite(m.availability));
  const untouched = Math.max(0, h.machinesOnRegister - listed.length);
  const count = known.length + untouched;
  if (!count) return null;
  return (known.reduce((s, m) => s + m.availability, 0) + 100 * untouched) / count;
};

/** The same three groups the Breakdowns screen counts, in the status colours. */
const STATUS_GROUPS = [
  { key: "waiting", label: "Not started", states: ["Reported", "Attended"], color: "#e11d48" },
  { key: "repair", label: "Under repair", states: ["Under Repair"], color: "#d97706" },
  { key: "done", label: "Repaired or closed", states: ["Repaired", "Closed"], color: "#059669" },
];

const TILE_TONE = {
  rose: "bg-rose-50 text-rose-600",
  amber: "bg-amber-50 text-amber-600",
  orange: "bg-orange-50 text-orange-600",
  emerald: "bg-emerald-50 text-emerald-600",
  blue: "bg-blue-50 text-blue-600",
};

/**
 * A headline figure: label and icon, the number, and one line under it - a
 * change against a named period when there is one, coloured by whether that
 * change is good news.
 */
const KpiTile = ({ icon: Icon, label, value, delta, rest, tone = "blue", loading }) => (
  <div className="card p-4 sm:p-5">
    <div className="flex items-start justify-between gap-3">
      <p className="text-[13px] font-medium text-slate-600 sm:text-sm">{label}</p>
      <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl sm:h-10 sm:w-10 ${TILE_TONE[tone]}`}>
        <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
      </span>
    </div>
    <p className="mt-1.5 text-[28px] font-bold leading-none tracking-tight text-slate-900 sm:text-[32px]">
      {loading ? <span className="inline-block h-8 w-16 animate-pulse rounded-md bg-slate-100" /> : value}
    </p>
    <p className="mt-2 text-[12px] text-slate-500 sm:text-[13px]">
      {delta && (
        <span
          className={`mr-1.5 font-semibold ${
            delta.good === true ? "text-emerald-700" : delta.good === false ? "text-rose-700" : "text-slate-700"
          }`}
        >
          {delta.text}
        </span>
      )}
      {rest}
    </p>
  </div>
);

const reportFor = (from, to) =>
  API.get("/breakdowns/report", { params: { from: iso(from), to: iso(to) } }).then(({ data }) => data);

/** "+0.4 h" / "−1.2%": the sign spelled out, the size in the figure's own unit. */
const signed = (diff, format) => `${diff > 0 ? "+" : diff < 0 ? "−" : "±"}${format(Math.abs(diff))}`;

const Dashboard = () => {
  const { user } = useAuth();
  const role = user?.role;
  const seesBreakdowns = maySee(role, "breakdowns");
  const seesRequests = maySee(role, "maintenanceRequests");

  const [work, setWork] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [opened, setOpened] = useState(null);

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const [breakdowns, requests] = await Promise.all([
          seesBreakdowns
            ? API.get("/breakdowns", { params: { open: false } }).then(({ data }) => data)
            : [],
          seesRequests
            ? API.get("/maintenance-requests", { params: { open: false } }).then(
                ({ data }) => data.rows || []
              )
            : [],
        ]);

        const rows = [
          ...breakdowns.map((b) => ({
            kind: "breakdown",
            id: b.id,
            title: b.machineName || b.machine,
            state: b.state,
            priority: b.priority,
            at: b.stoppedAt || b.reportedAt || "",
            notStarted: ["Reported", "Attended"].includes(b.state),
          })),
          ...requests.map((r) => ({
            kind: "request",
            id: r.id,
            title: r.title,
            state: r.state,
            priority: r.priority,
            at: r.requestedAt || "",
            notStarted: ["Requested", "Attended"].includes(r.state),
          })),
        ].map((w) => ({ ...w, open: !["Closed", "Cancelled"].includes(w.state) }));

        rows.sort((a, b) => String(b.at).localeCompare(String(a.at)));
        setWork(rows);
        setError("");
      } catch (err) {
        setError(err.response?.data?.message || `Cannot reach the server at ${API.defaults.baseURL}.`);
      } finally {
        setLoading(false);
      }
    },
    [seesBreakdowns, seesRequests]
  );

  useEffect(() => {
    load();
  }, [load]);

  /*
   * The figures that need the reliability report: response time, uptime, the
   * downtime chart and the status ring. That report is the Breakdown Report's,
   * so only the roles allowed that screen are asked for it.
   */
  const seesReport = maySee(role, "breakdownReport");
  const [month, setMonth] = useState(null); // { current, previous }: the last 30 days and the 30 before
  const [range, setRange] = useState("month");
  const [series, setSeries] = useState(null); // { points, previous } for `range`
  const [chartLoading, setChartLoading] = useState(seesReport);

  const loadMonth = useCallback(async () => {
    if (!seesReport) return;
    const today = startOfDay(new Date());
    try {
      const [current, previous] = await Promise.all([
        reportFor(addDays(today, -29), today),
        reportFor(addDays(today, -59), addDays(today, -30)),
      ]);
      setMonth({ current, previous });
    } catch {
      setMonth(null);
    }
  }, [seesReport]);

  const loadSeries = useCallback(async () => {
    if (!seesReport) return;
    const r = RANGES[range];
    const w = r.window(startOfDay(new Date()));
    setChartLoading(true);
    try {
      const [current, previous] = await Promise.all([reportFor(w.start, w.end), reportFor(w.prevStart, w.prevEnd)]);
      setSeries({
        points: bucketise(r, current.breakdowns, w.start),
        previous: bucketise(r, previous.breakdowns, w.prevStart),
      });
    } catch {
      setSeries(null);
    } finally {
      setChartLoading(false);
    }
  }, [seesReport, range]);

  useEffect(() => {
    loadMonth();
  }, [loadMonth]);

  useEffect(() => {
    loadSeries();
  }, [loadSeries]);

  // The top bar's Refresh: read ERPNext again without leaving the screen.
  useErpRefresh(() => {
    load(true);
    loadMonth();
    loadSeries();
  });

  const stats = useMemo(
    () => ({
      open: work.filter((w) => w.open).length,
      notStarted: work.filter((w) => w.open && w.notStarted).length,
      inProgress: work.filter((w) => w.open && !w.notStarted).length,
      done: work.filter((w) => !w.open).length,
    }),
    [work]
  );

  // Every other screen this role has, as shortcuts.
  const shortcuts = navFor(role).filter((link) => !link.to.endsWith("/dashboard"));
  const pathTo = (suffix) => navFor(role).find((link) => link.to.endsWith(suffix))?.to;

  const openBreakdowns = work.filter((w) => w.kind === "breakdown" && w.open);
  const openRequests = work.filter((w) => w.kind === "request" && w.open);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const firstName = (user?.name || "").split(/\s+/)[0];
  const today = new Date().toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  /** One card of open work: breakdowns, or maintenance requests. */
  const WorkCard = ({ title, rows, empty, icon, to, toLabel }) => (
    <section className="card overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <h2 className="section-title">
          {title}
          <span className="badge badge-slate">{rows.length}</span>
        </h2>
        {to && (
          <Link to={to} className="flex items-center text-[13px] font-semibold text-brand-700 hover:text-brand-600">
            {toLabel} <ChevronRight className="h-4 w-4" />
          </Link>
        )}
      </div>
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="h-7 w-7 animate-spin rounded-full border-b-2 border-t-2 border-brand-500" />
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-5 py-10 text-center">
          <CheckCircle2 className="h-7 w-7 text-emerald-500" />
          <p className="text-sm font-semibold text-slate-700">{empty}</p>
        </div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {rows.slice(0, 6).map((w) => (
            <li key={`${w.kind}-${w.id}`}>
              <button
                onClick={() => setOpened(w)}
                className="flex w-full cursor-pointer items-center gap-3 px-5 py-3.5 text-left transition-colors hover:bg-brand-50/40"
              >
                <WorkThumb icon={icon} priority={w.priority} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-900">{w.title}</p>
                  <p className="mono mt-0.5 text-slate-500">
                    {w.id}
                    {w.at && ` · ${day(w.at)}`}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-2">
                  {w.priority && (
                    <span className={`badge ${PRIORITY_STYLE[w.priority] || "badge-slate"}`}>{w.priority}</span>
                  )}
                  <span className={`badge ${STATE_STYLE[w.state] || "badge-slate"} max-sm:hidden`}>{w.state}</span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );

  /* --------------------------------------------------------------- Figures */

  const newSinceYesterday = openBreakdowns.filter((w) => w.at && parseAt(w.at).getTime() >= Date.now() - DAY_MS).length;
  const requestsNotStarted = openRequests.filter((w) => w.notStarted).length;
  const response = month?.current?.headline?.meanResponseHours;
  const responseBefore = month?.previous?.headline?.meanResponseHours;
  const uptime = fleetUptime(month?.current);
  const uptimeBefore = fleetUptime(month?.previous);
  const reportLoading = seesReport && !month;

  const tiles = [
    seesBreakdowns && {
      key: "breakdowns",
      icon: AlertTriangle,
      tone: "rose",
      label: "Open breakdowns",
      value: openBreakdowns.length,
      loading,
      delta: newSinceYesterday ? { text: `+${newSinceYesterday}`, good: false } : null,
      rest: newSinceYesterday ? "since yesterday" : "none new since yesterday",
    },
    seesRequests && {
      key: "requests",
      icon: Clock,
      tone: "amber",
      label: "Requests waiting",
      value: openRequests.length,
      loading,
      rest: `${requestsNotStarted} not started yet`,
    },
    seesReport && {
      key: "response",
      icon: Wrench,
      tone: "orange",
      label: "Response time",
      value: formatHours(response),
      loading: reportLoading,
      delta:
        Number.isFinite(response) && Number.isFinite(responseBefore)
          ? { text: signed(response - responseBefore, formatHours), good: response <= responseBefore }
          : null,
      rest: Number.isFinite(response)
        ? Number.isFinite(responseBefore)
          ? "vs the 30 days before"
          : "average, last 30 days"
        : "nothing attended in 30 days",
    },
    seesReport && {
      key: "uptime",
      icon: CheckCircle2,
      tone: "emerald",
      label: "Machine uptime",
      value: uptime === null ? "—" : `${uptime.toFixed(1)}%`,
      loading: reportLoading,
      delta:
        uptime !== null && uptimeBefore !== null
          ? { text: signed(uptime - uptimeBefore, (n) => `${n.toFixed(1)}%`), good: uptime >= uptimeBefore }
          : null,
      rest: "last 30 days",
    },
    // Roles without the reliability report still get four figures.
    !seesReport && {
      key: "progress",
      icon: Wrench,
      tone: "blue",
      label: "In progress",
      value: stats.inProgress,
      loading,
      rest: "being worked on",
    },
    !seesReport && {
      key: "done",
      icon: CheckCircle2,
      tone: "emerald",
      label: "Completed",
      value: stats.done,
      loading,
      rest: "closed or cancelled",
    },
  ].filter(Boolean);

  const statusSegments = STATUS_GROUPS.map((g) => ({
    ...g,
    value: (month?.current?.breakdowns || []).filter((b) => g.states.includes(b.state)).length,
  }));
  const periodDowntime = (series?.points || []).reduce((s, p) => s + p.value, 0);
  const breakdownsPath = pathTo("/breakdowns");
  const canReport = role === MANAGER || role === PRODUCTION_MANAGER;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-[28px]">
            {greeting}
            {firstName && `, ${firstName}`}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {today} &middot; Here is what needs maintenance today
          </p>
        </div>
        {canReport && breakdownsPath && (
          <Link to={`${breakdownsPath}?report=1`} className="btn btn-primary max-sm:w-full">
            <Plus className="h-4 w-4" aria-hidden="true" />
            Report breakdown
          </Link>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {tiles.map(({ key, ...tile }) => (
          <KpiTile key={key} {...tile} />
        ))}
      </div>

      {seesReport && (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <section className="card p-5">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold tracking-tight text-slate-900">Downtime</h2>
                <p className="mt-0.5 text-[13px] text-slate-500">
                  {chartLoading && !series
                    ? "Loading…"
                    : `${formatHours(periodDowntime)} in total · ${RANGES[range].period.toLowerCase()}`}
                </p>
              </div>
              <div className="inline-flex rounded-xl bg-slate-100 p-1" role="group" aria-label="Period">
                {Object.entries(RANGES).map(([key, r]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setRange(key)}
                    aria-pressed={range === key}
                    className={`h-8 cursor-pointer rounded-lg px-3.5 text-[13px] font-semibold transition-colors ${
                      range === key ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"
                    }`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>
            {series ? (
              <div className={chartLoading ? "opacity-50 transition-opacity" : "transition-opacity"}>
                <DowntimeChart
                  points={series.points}
                  previous={series.previous}
                  periodLabel={RANGES[range].period}
                  previousLabel={RANGES[range].previous}
                />
              </div>
            ) : chartLoading ? (
              <div className="h-[262px] animate-pulse rounded-xl bg-slate-50" />
            ) : (
              <p className="py-16 text-center text-sm text-slate-500">The downtime figures could not be loaded.</p>
            )}
          </section>

          <section className="card p-5">
            <div className="mb-5">
              <h2 className="text-base font-semibold tracking-tight text-slate-900">Breakdowns by status</h2>
              <p className="mt-0.5 text-[13px] text-slate-500">Reported in the last 30 days</p>
            </div>
            {month ? (
              <StatusDonut segments={statusSegments} caption="last 30 days" />
            ) : (
              <div className="mx-auto h-[168px] w-[168px] animate-pulse rounded-full bg-slate-50" />
            )}
          </section>
        </div>
      )}

      {error && (
        <div className="note note-rose">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-2">
        {seesBreakdowns && (
          <WorkCard
            title="Machines down"
            rows={openBreakdowns}
            empty="No open breakdowns - every machine is running."
            icon={Wrench}
            to={pathTo("/breakdowns")}
            toLabel="All breakdowns"
          />
        )}
        {seesRequests && (
          <WorkCard
            title="Requests waiting"
            rows={openRequests}
            empty="No open maintenance requests."
            icon={Hammer}
            to={pathTo("/maintenance-requests")}
            toLabel="All requests"
          />
        )}
      </div>

      {shortcuts.length > 0 && (
        <section>
          <h2 className="section-title mb-3">
            <Zap className="h-[18px] w-[18px] text-brand-600" />
            Go to
          </h2>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
            {shortcuts.map((link) => {
              const Icon = link.icon;
              return (
                <Link
                  key={link.to}
                  to={link.to}
                  className="card flex min-h-14 items-center gap-3 px-3.5 py-3 transition-colors hover:border-brand-300 hover:bg-brand-50/40"
                >
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-500/10 text-brand-700">
                    <Icon className="h-[18px] w-[18px]" />
                  </span>
                  <span className="text-[13px] font-semibold leading-tight text-slate-800">{link.label}</span>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {opened?.kind === "breakdown" && (
        <BreakdownDetail id={opened.id} onClose={() => setOpened(null)} onChanged={() => load(true)} />
      )}
      {opened?.kind === "request" && (
        <MaintenanceRequestDetail
          id={opened.id}
          onClose={() => setOpened(null)}
          onChanged={() => load(true)}
        />
      )}
    </div>
  );
};

export default Dashboard;
