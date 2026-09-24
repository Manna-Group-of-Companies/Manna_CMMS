import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Clock,
  Factory,
  Plus,
  RefreshCw,
  Wrench,
  X,
} from "lucide-react";

import API from "../../services/api";
import BreakdownDetail from "./BreakdownDetail";
import { useAuth, MANAGER, PRODUCTION_MANAGER } from "../../context/AuthContext";
import { useNotifications } from "../../context/NotificationContext";

/**
 * Breakdowns — Module 2's first screen.
 *
 * Reads ERPNext through the server rather than MongoDB, which is why this works
 * while the Module 1 screens are still waiting on the controller rewrite.
 *
 * Reporting is open to every role. Restricting who may report a breakdown is
 * the surest way to have breakdowns go unreported; what is restricted is
 * assessing and planning, and ERPNext's workflow decides that — so the buttons
 * below simply offer what the record allows and let ERPNext refuse the rest.
 */

/** Colour carries urgency: the untouched ones should catch the eye first. */
const STATE_STYLE = {
  Reported: "badge-rose",
  "Under Repair": "badge-amber",
  Repaired: "badge-emerald",
  Closed: "badge-slate",
  Cancelled: "badge-slate",
};

const PRIORITY_STYLE = {
  Critical: "badge-rose",
  High: "badge-orange",
  Medium: "badge-amber",
  Low: "badge-slate",
};

/**
 * What the row's button offers.
 *
 * It opens the record rather than applying the step. The step needs the stage
 * filled in first, and a button that advanced a breakdown without ever
 * asking what was done is how this became a status tracker instead of a
 * maintenance record.
 */
const NEXT_LABEL = {
  Reported: "Start repair",
  "Under Repair": "Machine running",
  Repaired: "Root cause",
};

/** Now, in the format a datetime-local input wants. */
const localNow = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};

const hoursLabel = (h) => {
  if (h === null || h === undefined) return "—";
  if (h < 1) return `${Math.round(h * 60)} min`;
  if (h < 48) return `${h} hr`;
  return `${Math.round(h / 24)} days`;
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
const Breakdowns = () => {
  const { user } = useAuth();
  // A production manager raises breakdowns for their own plant and follows
  // them. Moving one on is maintenance's, so the row offers no action.
  const canAdvance = user?.role !== PRODUCTION_MANAGER;
  /**
   * Who may report one in the first place.
   *
   * Reporting was open to everyone this screen is shown to, which put the
   * Maintenance Manager - the person who fixes a breakdown - in a position to
   * also raise one. Reporting is the plant's own job: they are standing at the
   * machine. Mirrors the server's guard on POST /breakdowns; a button the
   * server would refuse is worse than no button.
   */
  const canReport = user?.role === MANAGER || user?.role === PRODUCTION_MANAGER;
  const { showToast } = useNotifications();

  const [rows, setRows] = useState([]);
  const [machines, setMachines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showOpen, setShowOpen] = useState(true);
  const [reporting, setReporting] = useState(false);
  const [opened, setOpened] = useState("");

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const { data } = await API.get("/breakdowns", { params: { open: showOpen } });
        setRows(data);
        setError("");
      } catch (err) {
        const message =
          err.response?.data?.message ||
          `Cannot reach the server at ${API.defaults.baseURL}.`;
        setError(message);
      } finally {
        setLoading(false);
      }
    },
    [showOpen]
  );

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    API.get("/breakdowns/machines")
      .then(({ data }) => setMachines(data))
      .catch(() => setMachines([]));
  }, []);

  const stats = useMemo(() => {
    const open = rows.filter((r) => !["Closed", "Cancelled"].includes(r.state));

    /**
     * Machines that are down *now*.
     *
     * Not the same as open. A breakdown stays open after the repair while the
     * root cause is written up, but the machine is running again the moment it
     * reaches Repaired - so counting it in "downtime so far" reported a plant
     * as still losing hours to a machine that was back in production. Reported
     * and Under Repair are the only states where the machine is actually
     * stopped.
     */
    const down = rows.filter((r) => ["Reported", "Under Repair"].includes(r.state));

    return {
      open: open.length,
      notStarted: rows.filter((r) => r.state === "Reported").length,
      downtime: down.reduce((sum, r) => sum + (r.stoppedForHours || 0), 0),
    };
  }, [rows]);

  return (
    <div className="space-y-5">
      <div className="panel">
        <div className="flex items-center gap-3">
          <span className="panel-icon">
            <Wrench className="h-5 w-5" />
          </span>
          <div>
            <h2 className="panel-title">Breakdowns</h2>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn btn-sm btn-neutral" onClick={() => setShowOpen((v) => !v)}>
            {showOpen ? "Showing open" : "Showing all"}
          </button>
          <button className="btn btn-sm btn-neutral" onClick={() => load()} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
          {canReport && (
            <button className="btn btn-sm btn-primary" onClick={() => setReporting(true)}>
              <Plus className="h-4 w-4" />
              Report a breakdown
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="note note-rose">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* "Production stopped" was here and is gone: every breakdown is a stopped
          machine, so the tile always read the same as Open. */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Stat label="Open" value={stats.open} />
        <Stat label="Work not started" value={stats.notStarted} tone={stats.notStarted ? "rose" : ""} />
        <Stat label="Downtime so far" value={hoursLabel(Math.round(stats.downtime * 10) / 10)} />
      </div>

      <div className="table-card">
        <div className="table-scroll">
          <table className="tbl">
            <thead>
              <tr>
                <th>Breakdown</th>
                <th>Machine</th>
                <th>Status</th>
                <th>Waiting on</th>
                <th>Priority</th>
                <th>Stopped for</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const next = NEXT_LABEL[r.state];
                return (
                  <tr
                    key={r.id}
                    className="cursor-pointer hover:bg-slate-50"
                    onClick={() => setOpened(r.id)}
                  >
                    <td>
                      <span className="cell-title">{r.id}</span>
                      <div className="text-xs text-slate-500 max-w-xs truncate">{r.whatHappened}</div>
                    </td>
                    <td>
                      <span className="cell-title">{r.machineName}</span>
                      <div className="mono text-slate-500">{r.machine}</div>
                    </td>
                    <td>
                      <span className={`badge ${STATE_STYLE[r.state] || "badge-slate"}`}>{r.state}</span>
                      {/* Flagged at closing by whoever did the analysis. Shown
                          on the row because a repeat is the one thing about a
                          breakdown that changes what somebody should do about
                          it, and it was only visible a click deep. */}
                      {r.repeatFailure && (
                        <span className="ml-1 badge badge-rose badge-soft">repeat</span>
                      )}
                    </td>
                    <td className="text-slate-500">{r.waitingOn || "—"}</td>
                    <td>
                      {r.priority ? (
                        <span className={`badge ${PRIORITY_STYLE[r.priority] || "badge-slate"}`}>
                          {r.priority}
                        </span>
                      ) : (
                        <span className="text-slate-400">not set</span>
                      )}
                    </td>
                    {/* Hours only. The output-lost figure under this was worked
                        out from a per-machine rate that has not been measured,
                        so it read as fact while resting on an estimate. */}
                    <td>{hoursLabel(r.stoppedForHours)}</td>
                    <td className="text-right">
                      {next && canAdvance && (
                        <button className="btn btn-sm btn-primary" onClick={() => setOpened(r.id)}>
                          {next}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {!loading && rows.length === 0 && !error && (
          <div className="empty">
            <Factory className="h-8 w-8 text-slate-300 mb-2" />
            <p className="empty-title">Nothing broken down</p>
            <p className="empty-sub">
              {showOpen ? "No open breakdowns." : "No breakdowns have been reported yet."}
            </p>
          </div>
        )}
      </div>

      {opened && (
        <BreakdownDetail
          id={opened}
          onClose={() => setOpened("")}
          onChanged={() => load(true)}
        />
      )}

      {reporting && (
        <ReportModal
          machines={machines}
          onClose={() => setReporting(false)}
          onDone={(created) => {
            setReporting(false);
            showToast(`${created.id} reported`, "success");
            load(true);
          }}
          reporter={user?.name}
        />
      )}
    </div>
  );
};

const Stat = ({ label, value, tone = "" }) => (
  <div className="card p-4">
    <p className="eyebrow">{label}</p>
    <p
      className={`mt-1 text-2xl font-bold tracking-tight ${
        tone === "rose" ? "text-rose-600" : tone === "amber" ? "text-amber-600" : "text-slate-900"
      }`}
    >
      {value}
    </p>
  </div>
);

/**
 * Five fields, and no more.
 *
 * At the moment a machine has just stopped, anything beyond this is a guess,
 * and a guess recorded as fact is worse than a blank. Priority, cause and
 * spares are added by maintenance once somebody has actually looked.
 */
const ReportModal = ({ machines, onClose, onDone, reporter }) => {
  const [machine, setMachine] = useState("");
  const [stoppedAt, setStoppedAt] = useState(localNow);
  const [whatHappened, setWhatHappened] = useState("");
  /**
   * Always true, and no longer asked.
   *
   * A breakdown is a machine that has stopped - that is what separates it from
   * a maintenance request - so the box was a question with one honest answer,
   * and every reporter had to tick past it. The field is still written, because
   * the record and the report both read it.
   */
  const productionStopped = true;

  /** The companies represented in the machines this person may report against. */
  const [plantFilter, setPlantFilter] = useState("");
  const plantsOnOffer = [...new Set(machines.map((m) => m.plant).filter(Boolean))].sort();
  const shown = plantFilter ? machines.filter((m) => m.plant === plantFilter) : machines;
  const [priority, setPriority] = useState("High");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    if (!machine || !whatHappened.trim()) {
      setError("Choose a machine and say what happened");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const { data } = await API.post("/breakdowns", {
        machine,
        stoppedAt: stoppedAt.replace("T", " ") + ":00",
        whatHappened,
        productionStopped,
        priority,
      });
      onDone(data);
    } catch (err) {
      setError(err.response?.data?.message || "Could not report it");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form
        className="modal max-w-lg"
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
      >
        <div className="modal-head">
          <div>
            <h3 className="modal-title">
              <AlertTriangle className="h-5 w-5 text-brand-600" />
              Report a breakdown
            </h3>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="modal-body space-y-4">
          {error && <div className="note note-rose">{error}</div>}

          {/*
            Narrow to one company first.

            The maintenance manager covers every site, so the machine list is
            every machine in the group in one dropdown - and once the other
            plants were filled in that is long enough to scroll past the one you
            want. A plant head is served only their own machines, so they get no
            filter: one company is not a choice.
          */}
          {plantsOnOffer.length > 1 && (
            <div>
              <label className="field-label">Company</label>
              <select
                className="field"
                value={plantFilter}
                onChange={(e) => {
                  setPlantFilter(e.target.value);
                  // The machine already picked may not be in the new company.
                  setMachine("");
                }}
              >
                <option value="">All companies</option>
                {plantsOnOffer.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="field-label">Machine</label>
            <select
              className="field"
              value={machine}
              onChange={(e) => setMachine(e.target.value)}
              required
            >
              <option value="">Choose the machine…</option>
              {shown.map((m) => (
                <option key={m.code} value={m.code}>
                  {/* Named the way the asset register names it: the machine
                      first, its code after. */}
                  {m.name} — {m.code}
                </option>
              ))}
            </select>
            {shown.length === 0 && (
              <p className="mt-1.5 text-xs text-slate-500">
                No machines are registered yet.
              </p>
            )}
          </div>

          <div>
            <label className="field-label">
              <Clock className="inline h-3 w-3 mr-1" />
              When did it stop?
            </label>
            <div className="flex gap-2">
              <input
                type="datetime-local"
                className="field"
                value={stoppedAt}
                onChange={(e) => setStoppedAt(e.target.value)}
                required
              />
              <button
                type="button"
                className="btn btn-neutral shrink-0"
                onClick={() => setStoppedAt(localNow())}
              >
                Now
              </button>
            </div>
          </div>

          <div>
            <label className="field-label">What happened?</label>
            <textarea
              className="field field-area"
              rows={3}
              value={whatHappened}
              onChange={(e) => setWhatHappened(e.target.value)}
              required
            />
          </div>

          <div>
            <label className="field-label">How urgent</label>
            <select
              className="field"
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              required
            >
              {["Critical", "High", "Medium", "Low"].map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>

          <p className="text-xs text-slate-500">
            Reported as {reporter}. Maintenance starts work from here.
          </p>
        </div>

        <div className="modal-foot">
          <button type="button" className="btn btn-neutral" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? "Reporting…" : "Report it"}
          </button>
        </div>
      </form>
    </div>
  );
};

export default Breakdowns;
