import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  ClipboardList,
  Hammer,
  Plus,
  RefreshCw,
  X,
} from "lucide-react";

import API from "../../services/api";
import MaintenanceRequestDetail from "./MaintenanceRequestDetail";
import { useAuth } from "../../context/AuthContext";
import { useNotifications } from "../../context/NotificationContext";

/**
 * Maintenance requests — the planned work.
 *
 * Everything the plant asks maintenance for that is not a machine standing
 * still: fabrication, a preventive job, a scheduled routine, an improvement.
 * Deliberately a different screen from Breakdowns rather than a filter on it.
 *
 * The two were one list, and it cost both of them. The reliability figures were
 * measuring fabrication jobs as though they were failures; the planned jobs
 * were being asked for a root cause they do not have. Splitting the screens is
 * the visible half of splitting the records.
 *
 * This list is a *queue*, not a log. It is read to answer "what should we pick
 * up next", so it is ordered by priority and then by how long something has
 * been waiting — which is why the server sorts it and this screen does not
 * offer a column to re-sort by date.
 */

const STATE_STYLE = {
  Requested: "badge-amber",
  "In Progress": "badge-cyan",
  Completed: "badge-emerald",
  Closed: "badge-slate",
  Cancelled: "badge-slate",
};

const PRIORITY_STYLE = {
  High: "badge-orange",
  Medium: "badge-amber",
  Low: "badge-slate",
};

/**
 * The kinds of work, in the order they are asked for.
 *
 * Kept in step with the Select on CMMS Maintenance Request. ERPNext refuses a
 * value that is not in its own list, so a type added here and not there is
 * refused on save — which is the right way round: the record is the authority.
 */
const TYPES = [
  "Fabrication",
  "Preventive Maintenance",
  "Scheduled Routine",
  "Improvement / Modification",
  "Installation",
  "Inspection",
  "Other",
];

/**
 * What the row's button offers.
 *
 * It opens the record rather than applying the step, for the same reason the
 * breakdown list does: the step needs the stage filled in first, and a button
 * that completed a job without asking what was done is how a queue becomes a
 * tick-list.
 */
const NEXT_LABEL = {
  Requested: "Start work",
  "In Progress": "Mark complete",
  Completed: "Close it",
};

const day = (value) => {
  if (!value) return "—";
  const d = new Date(String(value).replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString("en-IN", { dateStyle: "medium" });
};

const ageLabel = (days) => {
  if (days === null || days === undefined) return "—";
  if (days === 0) return "today";
  if (days === 1) return "1 day";
  if (days < 60) return `${days} days`;
  return `${Math.round(days / 30)} months`;
};

const MaintenanceRequests = () => {
  const { user } = useAuth();
  const { showToast } = useNotifications();

  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [machines, setMachines] = useState([]);
  const [plants, setPlants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [showOpen, setShowOpen] = useState(true);
  const [type, setType] = useState("");
  const [mine, setMine] = useState(false);
  const [opened, setOpened] = useState("");
  const [raising, setRaising] = useState(false);

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const { data } = await API.get("/maintenance-requests", {
          params: { open: showOpen, type, mine },
        });
        setRows(data.rows || []);
        setSummary(data.summary || null);
        setError("");
      } catch (err) {
        setError(
          err.response?.data?.message || `Cannot reach the server at ${API.defaults.baseURL}.`
        );
      } finally {
        setLoading(false);
      }
    },
    [showOpen, type, mine]
  );

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    API.get("/breakdowns/machines").then(({ data }) => setMachines(data)).catch(() => setMachines([]));
    API.get("/breakdowns/plants").then(({ data }) => setPlants(data)).catch(() => setPlants([]));
  }, []);

  return (
    <div className="space-y-5">
      <div className="panel">
        <div className="flex items-center gap-3">
          <span className="panel-icon">
            <ClipboardList className="h-5 w-5" />
          </span>
          <div>
            <h2 className="panel-title">Maintenance requests</h2>
            <p className="panel-sub">
              Fabrication, preventive work, routines and improvements — everything that is not a
              breakdown. Picked up between the emergencies, most urgent first.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn btn-sm btn-neutral" onClick={() => setShowOpen((v) => !v)}>
            {showOpen ? "Showing open" : "Showing all"}
          </button>
          <button
            className={`btn btn-sm ${mine ? "btn-primary" : "btn-neutral"}`}
            onClick={() => setMine((v) => !v)}
          >
            {mine ? "Mine only" : "Everyone's"}
          </button>
          <select
            className="field field-sm w-auto cursor-pointer"
            value={type}
            onChange={(e) => setType(e.target.value)}
          >
            <option value="">All types</option>
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <button className="btn btn-sm btn-neutral" onClick={() => load()} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
          <button className="btn btn-sm btn-primary" onClick={() => setRaising(true)}>
            <Plus className="h-4 w-4" />
            Raise a request
          </button>
        </div>
      </div>

      {error && (
        <div className="note note-rose">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {summary && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Stat label="Open" value={summary.open} />
          <Stat
            label="Not started"
            value={summary.notStarted}
            tone={summary.notStarted ? "amber" : ""}
          />
          {/* The two halves of a backlog. One is maintenance's to clear and the
              other is the requesters' — and a single "open" figure hides which
              of the two anybody should be chased about. */}
          <Stat label="Being worked on" value={summary.inProgress} />
          <Stat
            label="Waiting to be closed"
            value={summary.awaitingClosure}
            sub="done, unsigned"
            tone={summary.awaitingClosure ? "amber" : ""}
          />
        </div>
      )}

      <div className="table-card">
        <div className="table-scroll">
          <table className="tbl">
            <thead>
              <tr>
                <th>Request</th>
                <th>Type</th>
                <th>For</th>
                <th>Status</th>
                <th>Waiting on</th>
                <th>Priority</th>
                <th>Waiting</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const next = NEXT_LABEL[r.state];
                const late =
                  r.neededBy &&
                  !["Closed", "Cancelled", "Completed"].includes(r.state) &&
                  r.neededBy < new Date().toISOString().slice(0, 10);

                return (
                  <tr
                    key={r.id}
                    className="cursor-pointer hover:bg-slate-50"
                    onClick={() => setOpened(r.id)}
                  >
                    <td>
                      <span className="cell-title">{r.title}</span>
                      <div className="mono text-xs text-slate-500">{r.id}</div>
                    </td>
                    <td className="text-slate-600">{r.requestType || "—"}</td>
                    <td>
                      {r.machine ? (
                        <>
                          <span className="cell-title">{r.machineName}</span>
                          <div className="mono text-slate-500">{r.machine}</div>
                        </>
                      ) : (
                        <span className="text-slate-500">{r.plant}</span>
                      )}
                    </td>
                    <td>
                      <span className={`badge ${STATE_STYLE[r.state] || "badge-slate"}`}>
                        {r.state}
                      </span>
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
                    <td>
                      <span className="tabular-nums">{ageLabel(r.ageDays)}</span>
                      {late && (
                        <div className="text-[11px] text-rose-600">
                          wanted by {day(r.neededBy)}
                        </div>
                      )}
                    </td>
                    <td className="text-right">
                      {next && (
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
            <Hammer className="h-8 w-8 text-slate-300 mb-2" />
            <p className="empty-title">Nothing in the queue</p>
            <p className="empty-sub">
              {showOpen
                ? "No open requests. Anything the plant wants built, improved or serviced on a schedule goes here."
                : "No requests have been raised yet."}
            </p>
          </div>
        )}
      </div>

      {opened && (
        <MaintenanceRequestDetail
          id={opened}
          onClose={() => setOpened("")}
          onChanged={() => load(true)}
        />
      )}

      {raising && (
        <RaiseModal
          machines={machines}
          plants={plants}
          requester={user?.name}
          onClose={() => setRaising(false)}
          onDone={(created) => {
            setRaising(false);
            showToast(`${created.id} raised`, "success");
            load(true);
          }}
        />
      )}
    </div>
  );
};

const Stat = ({ label, value, sub, tone = "" }) => (
  <div className="card p-4">
    <p className="eyebrow">{label}</p>
    <p
      className={`mt-1 text-2xl font-bold tracking-tight ${
        tone === "rose" ? "text-rose-600" : tone === "amber" ? "text-amber-600" : "text-slate-900"
      }`}
    >
      {value}
    </p>
    {sub && <p className="text-[11px] text-slate-500">{sub}</p>}
  </div>
);

/**
 * Raising a request.
 *
 * More is asked here than when reporting a breakdown, and deliberately so. A
 * breakdown is reported by somebody standing in front of a stopped machine who
 * does not yet know anything. A request is written at a desk by somebody who
 * has already decided what they want — so the type, the reason and the date it
 * is wanted by are all knowable, and they are exactly what lets the work be
 * scheduled rather than just queued.
 */
const RaiseModal = ({ machines, plants, requester, onClose, onDone }) => {
  const [form, setForm] = useState({
    title: "",
    requestType: "",
    machine: "",
    plant: "",
    area: "",
    whatIsNeeded: "",
    whyNeeded: "",
    priority: "Medium",
    neededBy: "",
    productionAffected: false,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const set = (field) => (e) =>
    setForm((f) => ({
      ...f,
      [field]: e.target.type === "checkbox" ? e.target.checked : e.target.value,
    }));

  /**
   * Choosing a machine fills the plant in.
   *
   * The plant is what the record is filed under and is always required, but
   * asking for it separately when a machine has been picked is asking a
   * question the system already knows the answer to — and it is the sort of
   * question that gets answered wrong on a busy afternoon.
   */
  const pickMachine = (code) => {
    const machine = machines.find((m) => m.code === code);
    setForm((f) => ({
      ...f,
      machine: code,
      plant: machine?.plant || f.plant,
      area: machine?.area || f.area,
    }));
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!form.title.trim() || !form.requestType || !form.whatIsNeeded.trim() || !form.plant) {
      setError("A title, a type of work, a plant and what is needed");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const { data } = await API.post("/maintenance-requests", form);
      onDone(data);
    } catch (err) {
      setError(err.response?.data?.message || "Could not raise it");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal max-w-lg" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="modal-head">
          <div>
            <h3 className="modal-title">
              <ClipboardList className="h-5 w-5 text-brand-600" />
              Raise a maintenance request
            </h3>
            <p className="modal-sub">
              For work that is not a breakdown. If a machine has stopped, report a breakdown
              instead — it moves faster and is measured differently.
            </p>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="modal-body space-y-4">
          {error && <div className="note note-rose">{error}</div>}

          <div>
            <label className="field-label">What do you want done?</label>
            <input
              className="field"
              value={form.title}
              onChange={set("title")}
              placeholder="Guard for the kneader drive coupling"
              required
            />
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="field-label">Type of work</label>
              <select className="field" value={form.requestType} onChange={set("requestType")} required>
                <option value="">Choose…</option>
                {TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label">How urgent</label>
              <select className="field" value={form.priority} onChange={set("priority")}>
                {["High", "Medium", "Low"].map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
              {/* Said plainly rather than left for somebody to discover by not
                  finding Critical in the list. */}
              <p className="mt-1 text-xs text-slate-500">
                Nothing here is critical. A machine that has stopped is a breakdown.
              </p>
            </div>
          </div>

          <div>
            <label className="field-label">Which machine (if any)</label>
            <select className="field" value={form.machine} onChange={(e) => pickMachine(e.target.value)}>
              <option value="">Not about one machine</option>
              {machines.map((m) => (
                <option key={m.code} value={m.code}>
                  {/* Named the way the asset register names it: the machine
                      first, its code after. The area used to trail in brackets
                      and made every option read as a different machine from the
                      one on the register. */}
                  {m.name} — {m.code}
                </option>
              ))}
            </select>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="field-label">Plant</label>
              <select className="field" value={form.plant} onChange={set("plant")} required>
                <option value="">Choose…</option>
                {plants.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label">Area / section</label>
              <input
                className="field"
                value={form.area}
                onChange={set("area")}
                placeholder="Mixing, Curing, Utilities"
              />
            </div>
          </div>

          <div>
            <label className="field-label">What is needed</label>
            <textarea
              className="field field-area"
              rows={3}
              value={form.whatIsNeeded}
              onChange={set("whatIsNeeded")}
              placeholder="Sizes, materials, where it goes — whatever a fitter would need to start."
              required
            />
          </div>

          <div>
            <label className="field-label">Why</label>
            <textarea
              className="field field-area"
              rows={2}
              value={form.whyNeeded}
              onChange={set("whyNeeded")}
              placeholder="What it fixes or improves. This is what decides where it sits in the queue."
            />
          </div>

          <div>
            <label className="field-label">Wanted by</label>
            <input type="date" className="field" value={form.neededBy} onChange={set("neededBy")} />
            <p className="mt-1 text-xs text-slate-500">
              Optional. A date makes it chaseable; leaving it blank means whenever there is room.
            </p>
          </div>

          <label className="flex items-center gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              className="h-4 w-4 accent-brand-600"
              checked={form.productionAffected}
              onChange={set("productionAffected")}
            />
            <span className="text-sm text-slate-700">Production is affected while this waits</span>
          </label>

          <p className="text-xs text-slate-500">
            Raised as {requester}. You will be the one who closes it when the work is done.
          </p>
        </div>

        <div className="modal-foot">
          <button type="button" className="btn btn-neutral" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? "Raising…" : "Raise it"}
          </button>
        </div>
      </form>
    </div>
  );
};

export default MaintenanceRequests;
