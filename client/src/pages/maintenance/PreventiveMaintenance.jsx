import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarCheck,
  ChevronRight,
  ListChecks,
  Loader2,
  Plus,
  Search,
  X,
} from "lucide-react";

import API from "../../services/api";
import ChecklistEditor from "./ChecklistEditor";
import { useAuth, MANAGER, MAINTENANCE_MANAGER } from "../../context/AuthContext";
import { useNotifications } from "../../context/NotificationContext";
import { useErpRefresh } from "../../hooks/useErpRefresh";

/**
 * Preventive maintenance — the inspections that stop a breakdown happening.
 *
 * One checklist per machine per frequency: what to look at daily, weekly,
 * monthly, and on down to yearly. Written here, printed for the floor.
 *
 * Read asset first. The screen opens on the asset list — every machine on the
 * register and every electrical system — and choosing one shows that asset's
 * checklists with the frequency of each. That is the way the question is asked
 * on the floor ("what do we check on the cracker mill?"), and an asset with no
 * checklist at all is visible in the list rather than missing from it, which a
 * list of the checklists that exist could never show.
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

const FREQUENCY_RANK = Object.fromEntries(FREQUENCIES.map((f, i) => [f, i]));

const byFrequency = (a, b) =>
  (FREQUENCY_RANK[a.frequency] ?? 99) - (FREQUENCY_RANK[b.frequency] ?? 99);

/** `machine:CODE` or `electrical:ID` — the kind travels with the code. */
const keyOf = (kind, code) => `${kind}:${code}`;

const PreventiveMaintenance = () => {
  const { user } = useAuth();
  const { showToast } = useNotifications();

  // Writing is maintenance's: a checklist is the standard the plant is
  // inspected against, and a standard anybody can edit is not a standard.
  const canEdit = user?.role === MANAGER || user?.role === MAINTENANCE_MANAGER;

  const [rows, setRows] = useState([]);
  const [machines, setMachines] = useState([]);
  // The electrical portfolio is inspected on a schedule too, and none of it is
  // a machine on the register — see preventiveDoctypes.js.
  const [systems, setSystems] = useState([]);
  const [plants, setPlants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [plant, setPlant] = useState("");
  const [search, setSearch] = useState("");
  // "" every asset, "with" only those with a checklist, "without" the gaps.
  const [show, setShow] = useState("");
  const [selected, setSelected] = useState("");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [opened, setOpened] = useState("");
  const [adding, setAdding] = useState(false);
  /**
   * Whether the asset lookup came back at all.
   *
   * A list with nothing in it has to say whether that is "no machines" or "the
   * request failed" — the second once reported itself as an empty register.
   */
  const [lookupFailed, setLookupFailed] = useState(false);

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        // Every checklist, once. The asset list counts them per asset and the
        // detail filters them, so neither needs a request of its own.
        const { data } = await API.get("/preventive", { params: { includeInactive } });
        setRows(data);
        setError("");
      } catch (err) {
        setError(
          err.response?.data?.message || `Cannot reach the server at ${API.defaults.baseURL}.`
        );
      } finally {
        setLoading(false);
      }
    },
    [includeInactive]
  );

  useEffect(() => {
    load();
  }, [load]);

  // The top bar's Refresh: read ERPNext again without leaving the screen.
  useErpRefresh(() => load(true));

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
    // Not fatal: without them the list still shows machines, and the plant
    // filter falls back to all plants.
    API.get("/electrical").then(({ data }) => setSystems(data)).catch(() => setSystems([]));
    API.get("/breakdowns/plants").then(({ data }) => setPlants(data)).catch(() => setPlants([]));
  }, []);

  /** The checklists of each asset, keyed the way the list is. */
  const byAsset = useMemo(() => {
    const map = new Map();
    for (const c of rows) {
      const key = keyOf(c.assetKind, c.asset);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(c);
    }
    for (const list of map.values()) list.sort(byFrequency);
    return map;
  }, [rows]);

  /**
   * Every asset, machines first and then the electrical systems.
   *
   * A retired machine stays only while something is still filed against it —
   * it needs no inspection, but a sheet on it must still be findable.
   */
  const assets = useMemo(() => {
    const list = [
      ...machines.map((m) => ({
        key: keyOf("machine", m.code),
        kind: "machine",
        code: m.code,
        name: m.name || m.code,
        plant: m.plant || "",
        criticality: m.criticality || "",
        retired: m.status === "Retired",
      })),
      ...systems.map((sys) => ({
        key: keyOf("electrical", sys.id),
        kind: "electrical",
        code: sys.id,
        name: sys.name || sys.id,
        plant: sys.plant || "",
        criticality: "",
        retired: false,
      })),
    ];
    return list
      .map((a) => ({ ...a, checklists: byAsset.get(a.key) || [] }))
      .filter((a) => !a.retired || a.checklists.length);
  }, [machines, systems, byAsset]);

  const term = search.trim().toLowerCase();
  const visible = assets.filter((a) => {
    if (plant && a.plant !== plant) return false;
    if (show === "with" && a.checklists.length === 0) return false;
    if (show === "without" && a.checklists.length > 0) return false;
    if (!term) return true;
    return [a.name, a.code].some((v) => String(v).toLowerCase().includes(term));
  });

  const active = assets.filter((a) => !a.retired);
  const totals = {
    checklists: rows.filter((c) => c.isActive).length,
    assets: active.length,
    withAny: active.filter((a) => a.checklists.some((c) => c.isActive)).length,
    criticalWithNone: active.filter(
      (a) => a.criticality.startsWith("A") && !a.checklists.some((c) => c.isActive)
    ).length,
  };

  const current = assets.find((a) => a.key === selected) || null;

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
              Choose an asset to see its checklists and how often each is done — written here,
              printed for the floor.
            </p>
          </div>
        </div>
        {/* No "New checklist" here (26 Oct 2026): a checklist is added from its asset, with the
            asset's own Add checklist button. */}
      </div>

      {error && (
        <div className="note note-rose">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {!loading && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Stat label="Checklists" value={totals.checklists} />
          <Stat label="Assets covered" value={`${totals.withAny} of ${totals.assets}`} />
          <Stat
            label="Assets with none"
            value={totals.assets - totals.withAny}
            tone={totals.assets - totals.withAny ? "amber" : ""}
            sub="no checklist at any frequency"
          />
          <Stat
            label="Critical with none"
            value={totals.criticalWithNone}
            tone={totals.criticalWithNone ? "rose" : ""}
            sub="A-critical, uninspected"
          />
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] items-start">
        {/* --- the asset list --------------------------------------------- */}
        <div className="table-card">
          <div className="p-3 space-y-2 border-b border-slate-100">
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                <Search className="h-4 w-4" />
              </span>
              <input
                className="field field-search"
                placeholder="Machine or system, name or code…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Search the assets"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <select
                className="field field-sm cursor-pointer"
                value={plant}
                onChange={(e) => setPlant(e.target.value)}
                aria-label="Filter by plant"
              >
                <option value="">All plants</option>
                {plants.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.name}
                  </option>
                ))}
              </select>
              <select
                className="field field-sm cursor-pointer"
                value={show}
                onChange={(e) => setShow(e.target.value)}
                aria-label="Filter by checklists"
              >
                <option value="">All assets</option>
                <option value="with">With checklists</option>
                <option value="without">Without checklists</option>
              </select>
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                className="h-3.5 w-3.5 accent-brand-600"
                checked={includeInactive}
                onChange={(e) => setIncludeInactive(e.target.checked)}
              />
              <span className="text-xs text-slate-600">Include retired checklists</span>
            </label>
            {lookupFailed && (
              <p className="text-xs text-rose-600">
                The machine register did not load, so this list is empty — it does not mean there
                are no machines. Reload, and if it persists the server log will say why.
              </p>
            )}
          </div>

          {loading ? (
            <div className="h-40 grid place-items-center">
              <Loader2 className="h-6 w-6 animate-spin text-brand-500" />
            </div>
          ) : visible.length === 0 ? (
            <div className="empty">
              <ListChecks className="h-8 w-8 text-slate-300 mb-2" />
              <p className="empty-title">No assets match</p>
              <p className="empty-sub">Clear the search or choose another plant.</p>
            </div>
          ) : (
            <ul className="divide-y divide-slate-100 max-h-[70vh] overflow-y-auto">
              {visible.map((a) => (
                <AssetRow
                  key={a.key}
                  asset={a}
                  selected={a.key === selected}
                  onSelect={() => setSelected(a.key)}
                />
              ))}
            </ul>
          )}
        </div>

        {/* --- the chosen asset's checklists ------------------------------- */}
        {current ? (
          <AssetChecklists
            asset={current}
            canEdit={canEdit}
            onOpen={setOpened}
            onAdd={() => setAdding(true)}
          />
        ) : (
          <div className="card">
            <div className="empty">
              <ListChecks className="h-8 w-8 text-slate-300 mb-2" />
              <p className="empty-title">Choose an asset</p>
              <p className="empty-sub">
                Its checklists, and how often each is done, show here
                {canEdit ? " - and Add checklist adds one to it" : ""}.
              </p>
            </div>
          </div>
        )}
      </div>

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
          preset={current}
          onClose={() => setAdding(false)}
          onDone={(created) => {
            setAdding(false);
            showToast(`${created.title} created`, "success");
            load(true);
            setSelected(keyOf(created.assetKind, created.asset));
            // Straight into the editor, because a checklist with no points on it
            // is not yet a checklist.
            setOpened(created.id);
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

/** One asset in the list, with the frequencies it is already inspected at. */
const AssetRow = ({ asset: a, selected, onSelect }) => {
  const critical = a.criticality.startsWith("A");
  const frequencies = [...new Set(a.checklists.filter((c) => c.isActive).map((c) => c.frequency))];

  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? "true" : undefined}
        className={`w-full flex items-center gap-3 px-4 py-3 text-left cursor-pointer transition-colors ${
          selected ? "bg-brand-50" : "hover:bg-slate-50"
        }`}
      >
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-slate-800 truncate">{a.name}</p>
          <p className="mono text-xs text-slate-500 truncate">
            {a.code}
            {a.plant ? ` · ${a.plant}` : ""}
            {a.kind === "electrical" && <span className="ml-1 badge badge-slate">electrical</span>}
            {critical && <span className="ml-1 badge badge-rose badge-soft">critical</span>}
          </p>
          <div className="mt-1 flex flex-wrap gap-1">
            {frequencies.length ? (
              frequencies.map((f) => (
                <span key={f} className={`badge ${FREQUENCY_STYLE[f] || "badge-slate"}`}>
                  {f}
                </span>
              ))
            ) : (
              <span className="text-xs text-amber-700">No checklist</span>
            )}
          </div>
        </div>
        <ChevronRight
          className={`h-4 w-4 shrink-0 ${selected ? "text-brand-600" : "text-slate-300"}`}
        />
      </button>
    </li>
  );
};

/** The chosen asset's checklists, each with its frequency. */
const AssetChecklists = ({ asset, canEdit, onOpen, onAdd }) => (
  <div className="table-card">
    <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3">
      <div className="min-w-0">
        <h3 className="section-title">{asset.name}</h3>
        <p className="panel-sub">
          <span className="mono">{asset.code}</span>
          {asset.plant ? ` · ${asset.plant}` : ""}
          {asset.kind === "electrical" ? " · electrical system" : ""}
        </p>
      </div>
      {canEdit && (
        <button className="btn btn-sm btn-primary shrink-0" onClick={onAdd}>
          <Plus className="h-4 w-4" />
          Add checklist
        </button>
      )}
    </div>

    {asset.checklists.length === 0 ? (
      <div className="empty">
        <ListChecks className="h-8 w-8 text-slate-300 mb-2" />
        <p className="empty-title">No checklists for this asset</p>
        <p className="empty-sub">
          Nothing is inspected on a schedule, so every failure on it will be found by it stopping.
        </p>
      </div>
    ) : (
      <div className="table-scroll">
        <table className="tbl">
          <thead>
            <tr>
              <th>Frequency</th>
              <th>Checklist</th>
              <th>Revision</th>
            </tr>
          </thead>
          <tbody>
            {asset.checklists.map((c) => (
              <tr
                key={c.id}
                className="cursor-pointer hover:bg-slate-50"
                onClick={() => onOpen(c.id)}
              >
                <td>
                  <span className={`badge ${FREQUENCY_STYLE[c.frequency] || "badge-slate"}`}>
                    {c.frequency}
                  </span>
                  {!c.isActive && <span className="ml-1 badge badge-slate">retired</span>}
                </td>
                <td>
                  <span className="cell-title">{c.title}</span>
                  <div className="mono text-xs text-slate-500">{c.id}</div>
                </td>
                <td className="text-slate-500">Rev {c.revision}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
  </div>
);

/**
 * A new checklist.
 *
 * Machine and frequency are fixed at creation and cannot be edited afterwards.
 * Changing either turns it into a different list, and doing that by editing
 * hides the change from anybody holding a printed copy.
 *
 * Opened from an asset, it starts on that asset.
 */
const NewChecklist = ({ machines, systems, existing, preset, onClose, onDone }) => {
  // Which kind of asset the sheet is for. Switching between them clears the
  // other — a checklist belongs to a machine or an electrical system, never
  // both, and the server refuses one carrying two.
  const [kind, setKind] = useState(preset?.kind || "machine");
  const [form, setForm] = useState({
    machine: preset?.kind === "machine" ? preset.code : "",
    electricalSystem: preset?.kind === "electrical" ? preset.code : "",
    frequency: "",
    title: "",
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
  // right — a mechanical daily round and an electrical one.
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
        // Only the one that applies. Sending a blank alongside a real value is
        // what the server reads as "both", and it refuses that.
        machine: kind === "machine" ? form.machine : "",
        electricalSystem: kind === "electrical" ? form.electricalSystem : "",
        frequency: form.frequency,
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
                    {sys.name} — {sys.id}
                  </option>
                ))}
              </select>
            </div>
          )}

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

          {clash && (
            <div className="note note-amber">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>
                There is already a {form.frequency.toLowerCase()} checklist on this asset —{" "}
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
              Optional. Worth naming where an asset has two at the same frequency — "Daily
              mechanical", "Daily electrical".
            </p>
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
