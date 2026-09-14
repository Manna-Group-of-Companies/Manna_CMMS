import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CalendarCheck,
  CheckCircle2,
  Grid3X3,
  ListChecks,
  Loader2,
  Plus,
  RefreshCw,
  X,
} from "lucide-react";

import API from "../../services/api";
import ChecklistEditor from "./ChecklistEditor";
import { useAuth, MANAGER, MAINTENANCE_MANAGER } from "../../context/AuthContext";
import { useNotifications } from "../../context/NotificationContext";

/**
 * Preventive maintenance — the inspections that stop a breakdown happening.
 *
 * One checklist per machine per frequency: what to look at daily, weekly,
 * monthly, and on down to yearly. Written here, printed for the floor.
 *
 * Two views, and the second is the one that changes anything. The list shows
 * the checklists that exist. The coverage grid shows the machines that have
 * none — which is the question somebody asks when they say "I want a checklist
 * for every machine", and the one a list of what exists can never answer.
 */

const FREQUENCIES = ["Daily", "Weekly", "Monthly", "Quarterly", "Half-Yearly", "Yearly"];

const FREQUENCY_STYLE = {
  Daily: "badge-rose",
  Weekly: "badge-orange",
  Monthly: "badge-amber",
  Quarterly: "badge-cyan",
  "Half-Yearly": "badge-indigo",
  Yearly: "badge-violet",
};

const TABS = [
  { key: "lists", label: "Checklists", icon: ListChecks },
  { key: "coverage", label: "Coverage", icon: Grid3X3 },
];

const PreventiveMaintenance = () => {
  const { user } = useAuth();
  const { showToast } = useNotifications();

  // Writing is maintenance's: a checklist is the standard the plant is
  // inspected against, and a standard anybody can edit is not a standard.
  const canEdit = user?.role === MANAGER || user?.role === MAINTENANCE_MANAGER;

  const [tab, setTab] = useState("lists");
  const [rows, setRows] = useState([]);
  const [cover, setCover] = useState(null);
  const [machines, setMachines] = useState([]);
  // The electrical portfolio is inspected on a schedule too, and none of it is
  // a machine on the register — see preventiveDoctypes.js.
  const [systems, setSystems] = useState([]);
  const [plants, setPlants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [plant, setPlant] = useState("");
  const [frequency, setFrequency] = useState("");
  /**
   * Which asset's sheets to show, as `machine:CODE` or `electrical:ID`.
   *
   * One field rather than two, because they are one question — nobody wants to
   * filter by a machine *and* an electrical system at once, and two selects
   * offering that would only invite the combination that returns nothing.
   *
   * The kind travels in the value because the server takes them as separate
   * filters, and a bare code cannot say which of the two it is.
   */
  const [asset, setAsset] = useState("");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [opened, setOpened] = useState("");
  const [adding, setAdding] = useState(false);
  /**
   * Whether the asset lookup came back at all.
   *
   * The three lookups below used to swallow their own failures and set an empty
   * list, so a machine picker with nothing in it meant either "no machines" or
   * "the request failed" and the screen could not tell you which. It was the
   * second — every query naming `output_per_hour` was being refused by ERPNext
   * because the field had never been added — and the picker reported it as an
   * empty register. A lookup that fails has to say so.
   */
  const [lookupFailed, setLookupFailed] = useState(false);

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const [kind, code] = asset.split(":");
        const [lists, coverage] = await Promise.all([
          API.get("/preventive", {
            params: {
              plant,
              frequency,
              machine: kind === "machine" ? code : "",
              electricalSystem: kind === "electrical" ? code : "",
              includeInactive,
            },
          }),
          // Coverage is the whole plant on purpose: it is read to find the
          // machines with nothing, and narrowing it to one machine would answer
          // a question nobody is asking on that tab.
          API.get("/preventive/coverage", { params: { plant } }),
        ]);
        setRows(lists.data);
        setCover(coverage.data);
        setError("");
      } catch (err) {
        setError(
          err.response?.data?.message || `Cannot reach the server at ${API.defaults.baseURL}.`
        );
      } finally {
        setLoading(false);
      }
    },
    [plant, frequency, asset, includeInactive]
  );

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    API.get("/breakdowns/machines")
      .then(({ data }) => {
        setMachines(data);
        setLookupFailed(false);
      })
      .catch(() => {
        setMachines([]);
        setLookupFailed(true);
      });
    // The electrical portfolio and the plant list are not fatal to this screen:
    // without them the picker still lists machines and the plant filter falls
    // back to all plants, which is a narrower screen rather than a broken one.
    API.get("/electrical").then(({ data }) => setSystems(data)).catch(() => setSystems([]));
    API.get("/breakdowns/plants").then(({ data }) => setPlants(data)).catch(() => setPlants([]));
  }, []);

  // Only what stands in the chosen plant. Offering a machine from another site
  // is offering a filter that returns an empty list.
  const visibleMachines = machines.filter((m) => !plant || m.plant === plant);
  const visibleSystems = systems.filter((sys) => !plant || sys.plant === plant);

  /**
   * Choosing a plant, and what it does to the machine already picked.
   *
   * Kept only when it stands in the new plant. Otherwise the two filters
   * contradict each other and the page goes empty with both boxes still
   * reading as though they should be showing something — which looks like a
   * page that is broken rather than a pair of filters that cannot both be true.
   */
  const pickPlant = (next) => {
    setPlant(next);
    if (!asset || !next) return;

    const [kind, code] = asset.split(":");
    const stillThere =
      kind === "machine"
        ? machines.some((m) => m.code === code && m.plant === next)
        : systems.some((sys) => sys.id === code && sys.plant === next);

    if (!stillThere) setAsset("");
  };

  return (
    <div className="space-y-5">
      <div className="panel">
        <div className="flex items-center gap-3">
          <span className="panel-icon">
            <CalendarCheck className="h-5 w-5" />
          </span>
          <div>
            <h2 className="panel-title">Preventive maintenance</h2>
            <p className="panel-sub">
              The checks that stop a breakdown being reported. One checklist per machine per
              frequency — written here, printed for the floor.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn btn-sm btn-neutral" onClick={() => load()} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
          {canEdit && (
            <button className="btn btn-sm btn-primary" onClick={() => setAdding(true)}>
              <Plus className="h-4 w-4" />
              New checklist
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

      {cover && <Coverage totals={cover.totals} />}

      <div className="tabs">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`tab inline-flex items-center gap-1.5 ${tab === key ? "tab-active" : ""}`}
            aria-current={tab === key ? "page" : undefined}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      <div className="card p-3">
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
          {/*
            A picker, not a search box.
            Typing was the wrong shape for this list. A checklist is filed
            against one machine, so the only useful narrowing is "show me this
            machine's sheets" — and a text field answered that only if the
            person spelled the machine the way the register does. The register
            is the authority on those names, so it supplies the options.
          */}
          <div className="sm:col-span-2">
            <label className="field-label">
              {systems.length ? "Machine or system" : "Machine"}
            </label>
            <select
              className="field field-sm cursor-pointer"
              value={asset}
              onChange={(e) => setAsset(e.target.value)}
              disabled={tab === "coverage"}
            >
              <option value="">
                {systems.length ? "All machines and systems" : "All machines"}
              </option>
              {/* Narrowed to the chosen plant, so the list is what is in front
                  of the person rather than every machine in the group. */}
              {visibleMachines.length > 0 && (
                <optgroup label="Machines">
                  {visibleMachines.map((m) => (
                    <option key={m.code} value={`machine:${m.code}`}>
                      {m.name} — {m.code}
                    </option>
                  ))}
                </optgroup>
              )}
              {visibleSystems.length > 0 && (
                <optgroup label="Electrical systems">
                  {visibleSystems.map((sys) => (
                    <option key={sys.id} value={`electrical:${sys.id}`}>
                      {sys.name} — {sys.id}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
            {lookupFailed ? (
              <p className="mt-1 text-xs text-rose-600">
                The machine register did not load, so this list is empty — it does not mean there
                are no machines. Reload, and if it persists the server log will say why.
              </p>
            ) : tab === "coverage" ? (
              <p className="mt-1 text-xs text-slate-500">
                Coverage is read to find the machines with nothing on them, so it always shows the
                whole plant.
              </p>
            ) : (
              plant &&
              visibleMachines.length === 0 && (
                <p className="mt-1 text-xs text-slate-500">
                  No machines are on the register for {plant}.
                </p>
              )
            )}
          </div>
          <div>
            <label className="field-label">Plant</label>
            <select
              className="field field-sm cursor-pointer"
              value={plant}
              onChange={(e) => pickPlant(e.target.value)}
            >
              <option value="">All plants</option>
              {plants.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="field-label">Frequency</label>
            <select
              className="field field-sm cursor-pointer"
              value={frequency}
              onChange={(e) => setFrequency(e.target.value)}
              disabled={tab === "coverage"}
            >
              <option value="">All frequencies</option>
              {FREQUENCIES.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </div>
        </div>
        {tab === "lists" && (
          <label className="mt-2 flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 accent-brand-600"
              checked={includeInactive}
              onChange={(e) => setIncludeInactive(e.target.checked)}
            />
            <span className="text-xs text-slate-600">Include retired checklists</span>
          </label>
        )}
      </div>

      {loading ? (
        <div className="h-40 grid place-items-center">
          <Loader2 className="h-6 w-6 animate-spin text-brand-500" />
        </div>
      ) : tab === "lists" ? (
        <Lists rows={rows} onOpen={setOpened} />
      ) : (
        <CoverageGrid cover={cover} onOpen={setOpened} />
      )}

      {opened && (
        <ChecklistEditor
          id={opened}
          machines={machines}
          systems={systems}
          canEdit={canEdit}
          onClose={() => setOpened("")}
          onChanged={() => load(true)}
        />
      )}

      {adding && (
        <NewChecklist
          machines={machines}
          systems={systems}
          existing={rows}
          onClose={() => setAdding(false)}
          onDone={(created) => {
            setAdding(false);
            showToast(`${created.title} created`, "success");
            load(true);
            // Straight into the editor, because a checklist with no points on it
            // is not yet a checklist — and a screen that congratulates somebody
            // for creating an empty one invites them to leave it that way.
            setOpened(created.id);
          }}
        />
      )}
    </div>
  );
};

/** How much of the plant is covered at all. */
const Coverage = ({ totals }) => (
  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
    <Stat label="Checklists" value={totals.checklists} />
    <Stat label="Machines covered" value={`${totals.withAny} of ${totals.machines}`} />
    <Stat
      label="Machines with none"
      value={totals.withNone}
      tone={totals.withNone ? "amber" : ""}
      sub="no checklist at any frequency"
    />
    {/*
      The only line on this screen that names something to do today. A hand
      pump with nothing is a gap; a critical machine with nothing is a machine
      running on luck.
    */}
    <Stat
      label="Critical with none"
      value={totals.criticalWithNone}
      tone={totals.criticalWithNone ? "rose" : ""}
      sub="A-critical, uninspected"
    />
  </div>
);

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

const Lists = ({ rows, onOpen }) => (
  <div className="table-card">
    <div className="table-scroll">
      <table className="tbl">
        <thead>
          <tr>
            <th>Checklist</th>
            <th>Asset</th>
            <th>Frequency</th>
            <th>Done by</th>
            <th className="text-right">Takes</th>
            <th>Revision</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id} className="cursor-pointer hover:bg-slate-50" onClick={() => onOpen(c.id)}>
              <td>
                <span className="cell-title">{c.title}</span>
                <div className="mono text-xs text-slate-500">{c.id}</div>
              </td>
              <td>
                <span className="cell-title">{c.assetName}</span>
                <div className="mono text-slate-500">
                  {c.asset}
                  {/* Named rather than left to be inferred from the code: an
                      electrical sheet sits in the same list as the machines
                      and reads like one of them otherwise. */}
                  {c.assetKind === "electrical" && (
                    <span className="ml-1 badge badge-slate">electrical</span>
                  )}
                </div>
              </td>
              <td>
                <span className={`badge ${FREQUENCY_STYLE[c.frequency] || "badge-slate"}`}>
                  {c.frequency}
                </span>
                {!c.isActive && <span className="ml-1 badge badge-slate">retired</span>}
              </td>
              <td className="text-slate-600">{c.responsibility || "—"}</td>
              <td className="text-right tabular-nums">
                {c.estimatedMinutes ? `${c.estimatedMinutes} min` : "—"}
              </td>
              <td className="text-slate-500">Rev {c.revision}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>

    {rows.length === 0 && (
      <div className="empty">
        <ListChecks className="h-8 w-8 text-slate-300 mb-2" />
        <p className="empty-title">No checklists yet</p>
        <p className="empty-sub">
          Start with the machines that stop the plant. The Coverage tab shows which those are and
          which of them have nothing.
        </p>
      </div>
    )}
  </div>
);

/**
 * Machines down the side, frequencies across the top.
 *
 * The empty cells are the information. A list of the checklists that exist can
 * only ever say what is there; this says what is not, which is the whole
 * question behind "a checklist for every machine".
 */
const CoverageGrid = ({ cover, onOpen }) => {
  if (!cover) return null;

  return (
    <div className="table-card">
      <div className="px-5 pt-5">
        <h3 className="section-title">Coverage</h3>
        <p className="panel-sub mb-3">
          Every machine on the register against every frequency. A blank cell is a check nobody is
          doing — not every machine needs all six, but a critical one with a whole empty row is
          running on luck.
        </p>
      </div>
      <div className="table-scroll">
        <table className="tbl">
          <thead>
            <tr>
              <th>Machine</th>
              {cover.frequencies.map((f) => (
                <th key={f} className="text-center">
                  {f}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cover.machines.map((m) => {
              const critical = m.criticality?.startsWith("A");
              return (
                <tr key={m.machine} className={m.count === 0 && critical ? "bg-rose-50/60" : ""}>
                  <td>
                    <span className="cell-title">{m.machineName}</span>
                    <div className="mono text-slate-500">
                      {m.machine}
                      {m.criticality ? ` · ${m.criticality.replace(/^[ABC] - /, "")}` : ""}
                    </div>
                  </td>
                  {cover.frequencies.map((f) => {
                    const id = m.frequencies[f];
                    return (
                      <td key={f} className="text-center">
                        {id ? (
                          <button
                            className="inline-grid place-items-center h-7 w-7 rounded-lg text-emerald-600 hover:bg-emerald-50 cursor-pointer"
                            onClick={() => onOpen(id)}
                            aria-label={`Open the ${f.toLowerCase()} checklist for ${m.machineName}`}
                          >
                            <CheckCircle2 className="h-4 w-4" />
                          </button>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {cover.machines.length === 0 && (
        <div className="empty">
          <Grid3X3 className="h-8 w-8 text-slate-300 mb-2" />
          <p className="empty-title">No machines on the register</p>
          <p className="empty-sub">Add machines in Asset Management first.</p>
        </div>
      )}
    </div>
  );
};

/**
 * A new checklist.
 *
 * Machine and frequency are fixed at creation and cannot be edited afterwards.
 * Changing either turns it into a different list, and doing that by editing
 * hides the change from anybody holding a printed copy.
 */
const NewChecklist = ({ machines, systems, existing, onClose, onDone }) => {
  // Which kind of asset the sheet is for. Not derived from whichever picker
  // has a value, because switching between them has to clear the other — a
  // checklist belongs to a machine or an electrical system, never both, and
  // the server refuses one carrying two.
  const [kind, setKind] = useState("machine");
  const [form, setForm] = useState({
    machine: "",
    electricalSystem: "",
    frequency: "",
    title: "",
    responsibility: "",
    estimatedMinutes: "",
    safetyNote: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const chooseKind = (next) => {
    setKind(next);
    setForm((f) => ({ ...f, machine: "", electricalSystem: "" }));
  };

  const asset = kind === "machine" ? form.machine : form.electricalSystem;

  // Not refused, only pointed out. Two lists at the same frequency is sometimes
  // right — a mechanical daily round and an electrical one — and refusing it
  // would send somebody to cram both onto one sheet.
  const clash =
    asset &&
    form.frequency &&
    existing.find((c) => c.asset === asset && c.frequency === form.frequency);

  const submit = async (e) => {
    e.preventDefault();
    if (!asset || !form.frequency) {
      setError(
        kind === "machine"
          ? "Choose a machine and how often it is done"
          : "Choose an electrical system and how often it is done"
      );
      return;
    }
    setSaving(true);
    setError("");
    try {
      const { data } = await API.post("/preventive", {
        ...form,
        // Only the one that applies. Sending a blank alongside a real value is
        // what the server reads as "both", and it refuses that.
        machine: kind === "machine" ? form.machine : "",
        electricalSystem: kind === "electrical" ? form.electricalSystem : "",
        estimatedMinutes: Number(form.estimatedMinutes) || 0,
        title: form.title.trim() || `${form.frequency} check`,
      });
      onDone(data);
    } catch (err) {
      setError(err.response?.data?.message || "Could not create it");
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
              <ListChecks className="h-5 w-5 text-brand-600" />
              New checklist
            </h3>
            <p className="modal-sub">
              The asset and the frequency are fixed once it exists — changing either would make it
              a different sheet from the one people are holding.
            </p>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="modal-body space-y-4">
          {error && <div className="note note-rose">{error}</div>}

          <div>
            <label className="field-label">What is it for</label>
            <div className="flex gap-2">
              {[
                ["machine", "A machine"],
                ["electrical", "An electrical system"],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => chooseKind(value)}
                  className={`flex-1 rounded-xl border px-3 py-2 text-[13px] font-medium transition-colors cursor-pointer ${
                    kind === value
                      ? "border-brand-500 bg-brand-50 text-brand-700"
                      : "border-slate-200 text-slate-600 hover:border-slate-300"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {kind === "machine" ? (
            <div>
              <label className="field-label">Machine</label>
              <select className="field" value={form.machine} onChange={set("machine")} required>
                <option value="">Choose the machine…</option>
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
          ) : (
            <div>
              <label className="field-label">Electrical system</label>
              <select
                className="field"
                value={form.electricalSystem}
                onChange={set("electricalSystem")}
                required
              >
                <option value="">Choose the system…</option>
                {systems.map((sys) => (
                  <option key={sys.id} value={sys.id}>
                    {/* Name first, the way the machine picker and the filter
                        above both read. The same system listed two ways on one
                        screen looks like two systems. */}
                    {sys.name} — {sys.id}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="field-label">How often</label>
              <select className="field" value={form.frequency} onChange={set("frequency")} required>
                <option value="">Choose…</option>
                {FREQUENCIES.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label">Done by</label>
              <select className="field" value={form.responsibility} onChange={set("responsibility")}>
                <option value="">Not decided</option>
                {["Operator", "Fitter", "Electrician", "Maintenance Team", "Contractor"].map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {clash && (
            <div className="note note-amber">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>
                There is already a {form.frequency.toLowerCase()} checklist on this machine —{" "}
                {clash.title}. A second one is fine if it is a different trade; otherwise add the
                points to that one.
              </span>
            </div>
          )}

          <div>
            <label className="field-label">Title</label>
            <input
              className="field"
              value={form.title}
              onChange={set("title")}
              placeholder={form.frequency ? `${form.frequency} check` : "Daily check"}
            />
            <p className="mt-1 text-xs text-slate-500">
              Optional. Worth naming where a machine has two at the same frequency — "Daily
              mechanical", "Daily electrical".
            </p>
          </div>

          <div>
            <label className="field-label">Before you start</label>
            <textarea
              className="field field-area"
              rows={2}
              value={form.safetyNote}
              onChange={set("safetyNote")}
              placeholder="Isolation, lock-off, permits — printed in a box at the top of the sheet."
            />
          </div>
        </div>

        <div className="modal-foot">
          <button type="button" className="btn btn-neutral" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? "Creating…" : "Create and add points"}
          </button>
        </div>
      </form>
    </div>
  );
};

export default PreventiveMaintenance;
