import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Loader2,
  Package,
  Plus,
  Printer,
  Repeat2,
  Send,
  ShieldCheck,
  Trash2,
  Users,
  X,
  Ban,
} from "lucide-react";

import API from "../../services/api";
import { outputLabel } from "../../utils/output";
import { useNotifications } from "../../context/NotificationContext";
import { useAuth } from "../../context/AuthContext";

/**
 * One breakdown, in full.
 *
 * The list answers "what is broken"; this answers "what do we know about it",
 * which is the part a maintenance record exists for. Every stage that has
 * happened is shown as it was filled in, and the stage that is due is a form.
 *
 * The server decides what a stage requires — this fetches that contract rather
 * than keeping its own copy, so a field marked required here cannot drift from
 * the one actually enforced on save.
 */

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
 * The order a breakdown travels.
 *
 * Four stops, not six. Assessment and planning happen on the phone while
 * somebody walks to the machine, so a reported breakdown goes straight to work
 * and everything is written down once it is running again.
 */
const JOURNEY = ["Reported", "Under Repair", "Repaired", "Closed"];

const FAILURE_MODES = [
  "Mechanical",
  "Electrical",
  "Hydraulic",
  "Pneumatic",
  "Instrumentation",
  "Operational",
  "Other",
];

const PREVENTION_TYPES = [
  "Raise minimum stock",
  "Change inspection / checklist",
  "Revise operating instructions",
  "Technical upgrade",
  "Raise a project",
  "Other",
];

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
  if (h === null || h === undefined || h === "") return "—";
  const n = Number(h);
  if (!Number.isFinite(n)) return "—";
  if (n < 1) return `${Math.round(n * 60)} min`;
  if (n < 48) return `${n} hr`;
  return `${Math.round(n / 24)} days`;
};

const when = (value) => {
  if (!value) return "—";
  const d = new Date(String(value).replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
};

const day = (value) => {
  if (!value) return "—";
  const d = new Date(String(value).replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString("en-IN", { dateStyle: "medium" });
};

/** Now, in the format a datetime-local input wants. */
const localNow = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};

const toErpDateTime = (value) => (value ? `${value.replace("T", " ")}:00` : "");

const BreakdownDetail = ({ id, onClose, onChanged }) => {
  const { showToast } = useNotifications();
  const { user } = useAuth();

  const [record, setRecord] = useState(null);
  const [stages, setStages] = useState({});
  const [lookups, setLookups] = useState({ people: [], suppliers: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const { data } = await API.get(`/breakdowns/${id}`);
      setRecord(data);
      setError("");
    } catch (err) {
      setError(err.response?.data?.message || "Could not load that breakdown");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    API.get("/breakdowns/stages").then(({ data }) => setStages(data)).catch(() => {});
    API.get("/breakdowns/lookups").then(({ data }) => setLookups(data)).catch(() => {});
  }, []);

  /**
   * The next step, but only for somebody allowed to take it.
   *
   * The server has always refused the wrong role - `allowedRoles` in
   * breakdownStages.js - and sends that same list here with each stage. This
   * screen was not reading it, so a plant head was shown "Save and mark under
   * repair" on their own plant's breakdown and got a refusal when they pressed
   * it. Reporting a breakdown is theirs; moving it on is maintenance's.
   *
   * Read from the stage rather than checked against a role name here, so the
   * two cannot drift: the server decides, and this only decides what to draw.
   */
  const nextStage = record?.nextAction ? stages[record.nextAction] : null;
  const mayTakeStage =
    !!nextStage && (nextStage.allowedRoles || []).includes(user?.role);
  const stage = mayTakeStage ? nextStage : null;

  const reached = useMemo(() => {
    if (!record) return -1;
    if (record.state === "Cancelled") return JOURNEY.indexOf("Reported");
    return JOURNEY.indexOf(record.state);
  }, [record]);

  const done = async (updated) => {
    setRecord(updated);
    showToast(`${updated.id} is now ${updated.state}`, "success");
    onChanged?.();
    await load();
  };

  return (
    <div className="modal-backdrop items-stretch justify-end p-0" onClick={onClose}>
      <div
        className="bg-white w-full max-w-3xl h-full overflow-y-auto shadow-2xl print:max-w-none print:shadow-none"
        onClick={(e) => e.stopPropagation()}
      >
        {loading ? (
          <div className="h-full grid place-items-center">
            <Loader2 className="h-7 w-7 animate-spin text-brand-500" />
          </div>
        ) : error ? (
          <div className="p-6">
            <div className="note note-rose">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
            <button className="btn btn-neutral mt-4" onClick={onClose}>
              Close
            </button>
          </div>
        ) : (
          <>
            <Header record={record} onClose={onClose} />

            <div className="px-6 pb-10 space-y-6">
              <Rail record={record} reached={reached} />

              {stage ? (
                <StageForm
                  key={record.nextAction}
                  action={record.nextAction}
                  stage={stage}
                  record={record}
                  lookups={lookups}
                  onDone={done}
                />
              ) : (
                nextStage && (
                  // Not a blank space: without this the record simply stops
                  // after the timeline and reads as though nothing is due.
                  <p className="note note-slate">
                    Waiting on maintenance to {nextStage.title.toLowerCase()}.
                  </p>
                )
              )}

              <CancelReport record={record} stages={stages} user={user} onDone={done} />

              <Report record={record} user={user} onChanged={load} />
            </div>
          </>
        )}

      </div>
    </div>
  );
};

const Header = ({ record, onClose }) => (
  <div className="sticky top-0 z-10 bg-white border-b border-slate-200 px-6 py-4 print:static">
    <div className="flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="mono text-sm font-semibold text-slate-900">{record.id}</span>
          <span className={`badge ${STATE_STYLE[record.state] || "badge-slate"}`}>
            {record.state}
          </span>
          {record.priority && (
            <span className={`badge ${PRIORITY_STYLE[record.priority] || "badge-slate"}`}>
              {record.priority}
            </span>
          )}
          {record.productionStopped && (
            <span className="badge badge-rose badge-soft">Production stopped</span>
          )}
          {record.repeatFailure && (
            <span className="badge badge-rose">
              <Repeat2 className="inline h-3 w-3 mr-1" />
              Repeat failure
            </span>
          )}
        </div>
        <h2 className="mt-1 text-lg font-bold tracking-tight text-slate-900 text-balance">
          {record.machineName}
        </h2>
        <p className="text-xs text-slate-500">
          {record.plant} · stopped {when(record.stoppedAt)}
        </p>
      </div>
      <div className="flex items-center gap-1 print:hidden">
        <button className="btn btn-sm btn-neutral" onClick={() => window.print()}>
          <Printer className="h-4 w-4" />
          Print
        </button>
        <button className="modal-close" onClick={onClose} aria-label="Close">
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  </div>
);

/**
 * The stages, and which one it is sitting on.
 *
 * Worth the space: the single most common question about a breakdown is not
 * what state it is in but how long it has been waiting in it.
 */
const Rail = ({ record, reached }) => {
  if (record.state === "Cancelled") {
    return (
      <div className="note note-slate">
        <span>Cancelled. It was reported {when(record.stoppedAt)} and turned out to be nothing.</span>
      </div>
    );
  }

  const at = {
    Reported: record.stoppedAt,
    "Under Repair": record.repairStartedAt,
    Repaired: record.completedAt,
    Closed: record.closedAt,
  };

  return (
    <div className="card p-4">
      <ol className="flex flex-wrap items-center gap-x-1 gap-y-2">
        {JOURNEY.map((state, i) => {
          const passed = i <= reached;
          return (
            <li key={state} className="flex items-center gap-1">
              <div className="flex items-center gap-1.5">
                {passed ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                ) : (
                  <Circle className="h-4 w-4 text-slate-300 shrink-0" />
                )}
                <div className="leading-tight">
                  <span
                    className={`text-xs font-semibold ${
                      i === reached ? "text-brand-700" : passed ? "text-slate-700" : "text-slate-400"
                    }`}
                  >
                    {state}
                  </span>
                  {at[state] && passed && (
                    <span className="block text-[10px] text-slate-400">{day(at[state])}</span>
                  )}
                </div>
              </div>
              {i < JOURNEY.length - 1 && (
                <ChevronRight className="h-3.5 w-3.5 text-slate-300 shrink-0" />
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
};

/* ------------------------------------------------------------------ forms */

/**
 * The stage that is due, as a form.
 *
 * One submit does both halves — saves the detail and moves the record on —
 * because the server will not accept them apart. A stage with nothing to
 * collect still gets a button, so "Start Repair" is a deliberate act rather
 * than something that happens silently.
 */
/**
 * Withdrawing a breakdown that should not have been raised.
 *
 * The server has always allowed this - the Cancel stage names Production
 * Manager among its roles - but nothing in the application ever drew it, so a
 * plant head who reported the wrong machine had no way back and the record sat
 * open forever. The maintenance request screen has had the equivalent all
 * along; this is the missing half.
 *
 * Only while the breakdown is still Reported. Once maintenance has started
 * work there is something real to account for, and it is closed rather than
 * made to disappear.
 */
const CancelReport = ({ record, stages, user, onDone }) => {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState("");

  const stage = stages?.Cancel;
  if (!user || !stage) return null;
  if (record.state !== stage.from) return null;
  if (!(stage.allowedRoles || []).includes(user.role)) return null;

  const submit = async () => {
    setSaving(true);
    setProblem("");
    try {
      const { data } = await API.post(`/breakdowns/${record.id}/action`, {
        action: "Cancel",
        fields: {},
      });
      onDone(data);
    } catch (err) {
      setProblem(err.response?.data?.message || "That step was refused");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="print:hidden">
      {!open ? (
        <button className="btn btn-sm btn-neutral" onClick={() => setOpen(true)}>
          <Ban className="h-3.5 w-3.5" />
          {stage.title}
        </button>
      ) : (
        <div className="note note-amber flex-col items-start gap-2">
          <p>{stage.blurb}</p>
          {problem && <p className="text-rose-600">{problem}</p>}
          <div className="flex gap-2">
            <button className="btn btn-sm btn-neutral" onClick={() => setOpen(false)} disabled={saving}>
              Keep it
            </button>
            <button className="btn btn-sm btn-primary" onClick={submit} disabled={saving}>
              {saving ? "Cancelling…" : stage.title}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

const StageForm = ({ action, stage, record, lookups, onDone }) => {
  const has = (field) => stage.fields.includes(field);

  const [form, setForm] = useState(() => ({
    priority: record.priority || "",
    failure_mode: record.failureMode || "",
    likely_cause: record.likelyCause || "",
    estimated_repair_hours: record.estimatedRepairHours || "",
    assigned_to: record.assignedTo || "",
    target_completion: record.targetCompletion
      ? String(record.targetCompletion).replace(" ", "T").slice(0, 16)
      : "",
    supplier: record.supplier || "",
    supplier_confirmed_date: record.supplierPromised || "",
    actions_performed: record.actionsPerformed || "",
    completed_at: localNow(),
    repair_started_at: record.repairStartedAt
      ? String(record.repairStartedAt).replace(" ", "T").slice(0, 16)
      : localNow(),
    root_cause: record.rootCause || "",
    repeat_failure: Boolean(record.repeatFailure),
    repeat_of: record.repeatOf || "",
  }));

  // Only spares picked from the store come back into the form; free-text ones
  // from before 10 Oct 2026 cannot be issued in SAP.
  const [spares, setSpares] = useState(() =>
    (record.spares || [])
      .filter((s) => s.itemCode)
      .map((s) => ({
        item_code: s.itemCode,
        description: s.description,
        qty_required: s.qtyRequired,
      }))
  );
  // The plant's store: { company, companyName, items: [{ code, name, available, ... }] }.
  const [spareStore, setSpareStore] = useState(null);
  const [spareStoreError, setSpareStoreError] = useState("");
  const asksSpares = has("spares_required");
  useEffect(() => {
    if (!asksSpares) return;
    API.get(`/breakdowns/${record.id}/spares`)
      .then(({ data }) => setSpareStore(data))
      .catch((err) =>
        setSpareStoreError(err.response?.data?.message || "Could not load the store's spares.")
      );
  }, [asksSpares, record.id]);
  const [crew, setCrew] = useState(() =>
    (record.repairedBy || []).map((w) => ({ ...w }))
  );
  const [actions, setActions] = useState(() =>
    (record.preventionActions || []).map((a) => ({
      action_type: a.actionType,
      description: a.description,
      owner_user: a.owner,
      target_date: a.targetDate || "",
    }))
  );

  const [saving, setSaving] = useState(false);
  const [missing, setMissing] = useState([]);
  const [problem, setProblem] = useState("");

  const set = (field) => (e) =>
    setForm((f) => ({
      ...f,
      [field]: e.target.type === "checkbox" ? e.target.checked : e.target.value,
    }));
  const isMissing = (field) => missing.some((m) => m.field === field);

  const submit = async (e) => {
    e.preventDefault();
    setProblem("");
    setMissing([]);

    // The same check the server makes, before the round trip: every spare
    // needs a quantity, and no more than the store has available.
    if (asksSpares && spares.length) {
      const byCode = new Map((spareStore?.items || []).map((i) => [i.code, i]));
      const bad = spares.find((s) => {
        const qty = Number(s.qty_required);
        const item = byCode.get(s.item_code);
        return !(qty > 0) || qty > (item?.available ?? 0) || (item?.whole && !Number.isInteger(qty));
      });
      if (bad) {
        const item = byCode.get(bad.item_code);
        setProblem(
          `${bad.description}: enter a ${item?.whole ? "whole number" : "quantity"} above zero and no more than the ${
            item?.available ?? 0
          } available.`
        );
        return;
      }
    }
    setSaving(true);

    const fields = {};
    for (const field of stage.fields) {
      if (field === "spares_required") {
        fields.spares_required = spares.map((s) => ({
          item_code: s.item_code,
          qty_required: Number(s.qty_required),
        }));
      } else if (field === "prevention_actions") {
        fields.prevention_actions = actions.filter((a) => a.description?.trim());
      } else if (field === "repaired_by") {
        fields.repaired_by = crew.filter((w) => w.name?.trim());
      } else if (["target_completion", "completed_at", "repair_started_at"].includes(field)) {
        fields[field] = toErpDateTime(form[field]);
      } else {
        fields[field] = form[field];
      }
    }

    try {
      const { data } = await API.post(`/breakdowns/${record.id}/action`, { action, fields });
      onDone(data);
    } catch (err) {
      const body = err.response?.data;
      // 422 means the stage is incomplete, and the server says which fields —
      // marking them beats a sentence the reader has to map back to the form.
      if (err.response?.status === 422 && body?.missing) setMissing(body.missing);
      setProblem(body?.message || "That step was refused");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="card p-5 border-brand-500/30 print:hidden" onSubmit={submit}>
      <div className="flex items-center gap-2.5 mb-1">
        <span className="panel-icon">
          <ChevronRight className="h-4 w-4" />
        </span>
        <div>
          <h3 className="section-title">{stage.title}</h3>
          <p className="panel-sub">{stage.blurb}</p>
        </div>
      </div>

      {problem && (
        <div className="note note-rose mt-3">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{problem}</span>
        </div>
      )}

      <div className="mt-4 space-y-4">
        {has("repair_started_at") && (
          <Field
            label="Work started at"
            required
            invalid={isMissing("repair_started_at")}
            hint="When somebody actually began. Both halves of the downtime split hang off this."
          >
            <div className="flex gap-2">
              <input
                type="datetime-local"
                className="field"
                value={form.repair_started_at}
                onChange={set("repair_started_at")}
              />
              <button
                type="button"
                className="btn btn-neutral shrink-0"
                onClick={() => setForm((f) => ({ ...f, repair_started_at: localNow() }))}
              >
                Now
              </button>
            </div>
          </Field>
        )}

        {has("failure_mode") && (
          <Field
            label="Failure mode"
            required
            invalid={isMissing("failure_mode")}
            hint="What kind of failure. This is what lets the report say which machines keep failing, and how."
          >
            <select className="field" value={form.failure_mode} onChange={set("failure_mode")}>
              <option value="">Choose…</option>
              {FAILURE_MODES.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </Field>
        )}

        {asksSpares && (
          <Spares
            rows={spares}
            onChange={setSpares}
            store={spareStore}
            loadError={spareStoreError}
          />
        )}

        {has("repaired_by") && <Crew rows={crew} onChange={setCrew} people={lookups.people} />}

        {has("actions_performed") && (
          <>
            <Field label="What was done" required invalid={isMissing("actions_performed")}>
              <textarea
                className="field field-area"
                rows={3}
                value={form.actions_performed}
                onChange={set("actions_performed")}
                placeholder="The work carried out, in the words the fitter would use."
              />
            </Field>
            <div className="grid sm:grid-cols-2 gap-4">
              {/*
                The hand-over, not the last turn of the spanner.

                Those are two different moments and only one of them ends the
                stoppage: a machine can be mechanically finished and still be
                waiting on a trial run, a mould change or an operator. Downtime
                is measured to the moment production got the machine back,
                because a figure measured to anything else understates every
                stoppage on the site.
              */}
              <Field
                label="Hand over time"
                required
                invalid={isMissing("completed_at")}
                hint="When production got the machine back — not when the fitter finished."
              >
                <input
                  type="datetime-local"
                  className="field"
                  value={form.completed_at}
                  onChange={set("completed_at")}
                />
              </Field>
              <Field label="Downtime" hint="Worked out from when it stopped to the hand-over.">
                <input className="field bg-slate-50" value={liveDowntime(record, form)} readOnly />
              </Field>
            </div>
          </>
        )}

        {has("root_cause") && (
          <Field
            label="Root cause"
            required
            invalid={isMissing("root_cause")}
            hint="Why it actually failed — not what broke, but why it broke."
          >
            <textarea
              className="field field-area"
              rows={3}
              value={form.root_cause}
              onChange={set("root_cause")}
              placeholder="The bearing ran dry because the oil level was never checked after the seal change."
            />
          </Field>
        )}

        {has("repeat_failure") && (
          <Repeat
            checked={form.repeat_failure}
            repeatOf={form.repeat_of}
            prior={record.priorFailures || []}
            onToggle={set("repeat_failure")}
            onPick={set("repeat_of")}
          />
        )}

        {has("prevention_actions") && (
          <Prevention
            rows={actions}
            onChange={setActions}
            people={lookups.people}
            invalid={isMissing("prevention_actions")}
          />
        )}

        {stage.fields.length === 0 && (
          <p className="text-sm text-slate-500">
            Nothing to fill in. The plan is already recorded.
          </p>
        )}
      </div>

      <div className="mt-5 flex justify-end">
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? "Saving…" : `Save and mark ${stage.to}`}
        </button>
      </div>
    </form>
  );
};

/**
 * The stoppage split into its parts, the same way the report does it.
 *
 * Kept here rather than sent from the server because it is arithmetic on
 * timestamps the record already carries, and a second copy on the wire would
 * be one more thing that could disagree.
 */
const splitOf = (r) => {
  const gap = (from, to) => {
    if (!from || !to) return null;
    const a = new Date(String(from).replace(" ", "T"));
    const b = new Date(String(to).replace(" ", "T"));
    if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
    const h = Math.round(((b - a) / 3_600_000) * 100) / 100;
    return h < 0 ? null : h;
  };
  return {
    // Stopped until work started, then work until it ran again. There is no
    // third interval any more: nothing sits between the report and the repair.
    response: gap(r.stoppedAt, r.repairStartedAt),
    repair: gap(r.repairStartedAt, r.completedAt),
  };
};

/** Downtime as it stands, so the cost of the stoppage is visible while typing. */
const liveDowntime = (record, form) => {
  if (!record.stoppedAt || !form.completed_at) return "—";
  const from = new Date(String(record.stoppedAt).replace(" ", "T"));
  const to = new Date(form.completed_at);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return "—";
  const h = Math.round(((to - from) / 3600_000) * 10) / 10;
  if (h < 0) return "the machine cannot run before it stopped";
  return hours(h);
};

const Field = ({ label, hint, required, invalid, children }) => (
  <div>
    <label className="field-label">
      {label}
      {required && <span className="text-rose-600 ml-0.5">*</span>}
    </label>
    <div className={invalid ? "ring-2 ring-rose-400 rounded-xl" : ""}>{children}</div>
    {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
  </div>
);

/** The dropdown lists this many at most; typing narrows it. */
const MAX_SPARES_SHOWN = 100;

/**
 * Spares used on the repair, picked from the plant's store (10 Oct 2026).
 *
 * They were free text while the catalog was being renamed and recounted. The
 * catalog now mirrors SAP and saving the repair issues the spares in SAP, so
 * each one is an item of the breakdown's company and its quantity cannot go
 * above what is available there - the shelf, less what other breakdowns have
 * taken that SAP has not posted yet. The server checks the same on save.
 */
const Spares = ({ rows, onChange, store, loadError }) => {
  const [term, setTerm] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const items = store?.items || null;
  const byCode = useMemo(() => new Map((items || []).map((i) => [i.code, i])), [items]);
  const picked = useMemo(() => new Set(rows.map((r) => r.item_code)), [rows]);
  // Not picked already, and matching what is typed (name, code or SAP code).
  const matches = useMemo(() => {
    const q = term.trim().toLowerCase();
    return (items || []).filter(
      (i) =>
        !picked.has(i.code) &&
        (!q || [i.name, i.code, i.sapCode].some((v) => String(v || "").toLowerCase().includes(q)))
    );
  }, [items, term, picked]);
  const shown = matches.slice(0, MAX_SPARES_SHOWN);

  useEffect(() => {
    if (open) document.getElementById(`spare-opt-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const set = (i, key, value) =>
    onChange(rows.map((r, n) => (n === i ? { ...r, [key]: value } : r)));

  const add = (item) => {
    if (!(item.available > 0)) return;
    onChange([...rows, { item_code: item.code, description: item.name, qty_required: "" }]);
    setTerm("");
    setActive(0);
    setOpen(false);
  };

  const onKey = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) setOpen(true);
      else setActive((i) => Math.min(i + 1, Math.max(shown.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && open) {
      // Picks the highlighted spare; never submits the stage from here.
      e.preventDefault();
      if (shown[active]) add(shown[active]);
    } else if (e.key === "Escape" && open) {
      e.stopPropagation();
      setOpen(false);
    }
  };

  return (
    <div>
      <label className="field-label" htmlFor="spare-search">
        <Package className="inline h-3 w-3 mr-1" />
        Spares used
      </label>
      <p className="mb-2 text-xs text-slate-500">
        From {store?.companyName ? `${store.companyName}'s` : "the plant's"} store. Saving issues
        them in SAP against this breakdown.
      </p>

      {loadError ? (
        <div className="note note-rose text-sm">{loadError}</div>
      ) : !items ? (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading the store…
        </div>
      ) : (
        <>
          <div className="relative">
            <input
              id="spare-search"
              type="text"
              role="combobox"
              aria-expanded={open}
              aria-controls="spare-items"
              aria-autocomplete="list"
              value={term}
              onChange={(e) => {
                setTerm(e.target.value);
                setActive(0);
                setOpen(true);
              }}
              onFocus={() => setOpen(true)}
              onClick={() => setOpen(true)}
              onBlur={() => setOpen(false)}
              onKeyDown={onKey}
              placeholder="Pick a spare from the list, or type a code or name…"
              className="field field-sm pr-9"
              autoComplete="off"
            />
            <button
              type="button"
              tabIndex={-1}
              // mousedown, not click, so the input keeps its focus.
              onMouseDown={(e) => {
                e.preventDefault();
                setOpen((o) => !o);
                document.getElementById("spare-search")?.focus();
              }}
              className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600"
              aria-label={open ? "Hide spares" : "Show spares"}
            >
              <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
            </button>
          </div>
          {open && (
            <ul
              id="spare-items"
              role="listbox"
              className="mt-1 max-h-60 overflow-y-auto divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white"
            >
              {shown.length === 0 ? (
                <li className="px-3 py-2 text-[13px] text-slate-500">
                  {items.length === 0
                    ? "This store has no items with a SAP code."
                    : term.trim()
                      ? "No item of this store matches."
                      : "Every item of this store is on the list already."}
                </li>
              ) : (
                shown.map((item, i) => {
                  const none = !(item.available > 0);
                  return (
                    <li key={item.code} id={`spare-opt-${i}`} role="option" aria-selected={i === active} aria-disabled={none}>
                      <button
                        type="button"
                        tabIndex={-1}
                        disabled={none}
                        onMouseDown={(e) => e.preventDefault()}
                        onMouseEnter={() => setActive(i)}
                        onClick={() => add(item)}
                        className={`flex w-full items-baseline justify-between gap-3 px-3 py-2 text-left text-[13px] disabled:cursor-not-allowed disabled:opacity-50 ${
                          i === active && !none ? "bg-slate-100" : "hover:bg-slate-50"
                        }`}
                      >
                        <span className="min-w-0">
                          <span className="text-slate-800">{item.name}</span>{" "}
                          <span className="mono text-[11px] text-slate-500">SAP {item.sapCode}</span>
                        </span>
                        <span className="whitespace-nowrap text-[12px] text-slate-500">
                          {none ? "none available" : `${item.available} ${item.unit} available`}
                        </span>
                      </button>
                    </li>
                  );
                })
              )}
              {matches.length > shown.length && (
                <li className="px-3 py-2 text-[12px] text-slate-500">
                  Showing {shown.length} of {matches.length}. Type to narrow the list.
                </li>
              )}
            </ul>
          )}
        </>
      )}

      {rows.length === 0 ? (
        <p className="mt-2 text-xs text-slate-500">None used.</p>
      ) : (
        <div className="mt-2 space-y-2">
          {rows.map((row, i) => {
            const item = byCode.get(row.item_code);
            const available = item?.available ?? 0;
            const over = Number(row.qty_required) > available;
            return (
              <div key={row.item_code} className="grid grid-cols-12 gap-2 items-start">
                <div className="col-span-7 min-w-0">
                  <div className="text-sm text-slate-800 break-words leading-snug">{row.description}</div>
                  <div className="mono text-[11px] text-slate-500">
                    {item ? `SAP ${item.sapCode} · ${available} ${item.unit} available` : row.item_code}
                  </div>
                </div>
                <div className="col-span-4">
                  <input
                    type="number"
                    min="0"
                    max={available}
                    step={item?.whole ? 1 : "any"}
                    inputMode={item?.whole ? "numeric" : "decimal"}
                    className={`field field-sm ${over ? "ring-2 ring-rose-400" : ""}`}
                    placeholder="qty"
                    value={row.qty_required}
                    onChange={(e) => set(i, "qty_required", e.target.value)}
                    aria-label={`Quantity of ${row.description}`}
                  />
                  {over && (
                    <p className="mt-0.5 text-[11px] text-rose-600">Only {available} available</p>
                  )}
                </div>
                <button
                  type="button"
                  className="icon-btn icon-btn-danger col-span-1"
                  onClick={() => onChange(rows.filter((_, n) => n !== i))}
                  aria-label={`Remove ${row.description}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

/**
 * Who was on the job.
 *
 * A list rather than one name: a repair is rarely one person, and recording
 * only the manager — who is usually just the one with a login — makes the
 * question "who actually did this" unanswerable a year later.
 *
 * The name is free text with the ERPNext users offered as suggestions, because
 * four of the six on the team are fitters with no account. Demanding a login
 * would have quietly excluded most of the people doing the work.
 */
const Crew = ({ rows, onChange, people }) => {
  const set = (i, key, value) =>
    onChange(rows.map((r, n) => (n === i ? { ...r, [key]: value } : r)));

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="field-label mb-0">
          <Users className="inline h-3 w-3 mr-1" />
          Repaired by
        </label>
        <button
          type="button"
          className="btn btn-sm btn-neutral"
          onClick={() => onChange([...rows, { name: "", user: "", role: "Fitter", hours: "" }])}
        >
          <Plus className="h-3.5 w-3.5" />
          Add
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="text-xs text-slate-500">
          Nobody named yet. Add everyone who worked on it, not just whoever signed it off.
        </p>
      ) : (
        <div className="space-y-2">
          {rows.map((row, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-start">
              <input
                className="field field-sm col-span-5"
                placeholder="Name"
                list="cmms-people"
                value={row.name}
                onChange={(e) => {
                  const typed = e.target.value;
                  // Matching a real account links it, so the record can still be
                  // traced to a user where one exists.
                  const match = people.find((p) => p.name === typed);
                  set(i, "name", typed);
                  if (match) set(i, "user", match.email);
                }}
              />
              <select
                className="field field-sm col-span-4"
                value={row.role}
                onChange={(e) => set(i, "role", e.target.value)}
              >
                {["Fitter", "Electrician", "Helper", "Supervisor", "Contractor"].map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
              <input
                type="number"
                min="0"
                step="0.5"
                className="field field-sm col-span-2"
                placeholder="hrs"
                value={row.hours}
                onChange={(e) => set(i, "hours", e.target.value)}
              />
              <button
                type="button"
                className="icon-btn icon-btn-danger col-span-1"
                onClick={() => onChange(rows.filter((_, n) => n !== i))}
                aria-label="Remove"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          <datalist id="cmms-people">
            {people.map((p) => (
              <option key={p.email} value={p.name} />
            ))}
          </datalist>
        </div>
      )}
    </div>
  );
};

/**
 * Has this happened before?
 *
 * Asked at closing and nowhere else. At the moment a machine stops nobody has
 * the history in front of them, and a guess made then is a guess recorded as
 * fact. Here the machine's earlier failures are on screen, so the question can
 * be answered by looking rather than by remembering — otherwise the flag ends
 * up measuring who has a good memory rather than which machines keep failing.
 *
 * Not required. Forcing an answer would get a tick from whoever wanted the form
 * closed, and a false repeat is worse than a missing one: the report highlights
 * on it.
 *
 * The earlier breakdown is optional even when the box is ticked. The crew often
 * know a failure has happened before while the earlier one predates the system,
 * and refusing the flag without a link would lose the more valuable half.
 */
const Repeat = ({ checked, repeatOf, prior, onToggle, onPick }) => (
  <div className={`rounded-xl border p-3 ${checked ? "border-rose-300 bg-rose-50/50" : "border-slate-200"}`}>
    <label className="flex items-start gap-2.5 cursor-pointer">
      <input
        type="checkbox"
        className="mt-0.5 h-4 w-4 accent-rose-600"
        checked={checked}
        onChange={onToggle}
      />
      <span>
        <span className="text-sm font-medium text-slate-800">
          <Repeat2 className="inline h-3.5 w-3.5 mr-1 -mt-0.5" />
          This machine has failed this way before
        </span>
        <span className="block text-xs text-slate-500">
          Tick it and the breakdown report highlights it. Four ordinary repairs and one unsolved
          problem look identical until somebody says which it was.
        </span>
      </span>
    </label>

    {checked && (
      <div className="mt-3 pl-7">
        <label className="field-label">Which earlier one</label>
        {prior.length === 0 ? (
          <p className="text-xs text-slate-500">
            Nothing earlier on this machine is in the system. Leave it — the flag is worth having on
            its own.
          </p>
        ) : (
          <>
            <select className="field field-sm" value={repeatOf || ""} onChange={onPick}>
              <option value="">Not one of these / before the system</option>
              {prior.map((p) => (
                <option key={p.id} value={p.id}>
                  {day(p.stoppedAt)} — {p.failureMode || "unclassified"} —{" "}
                  {(p.rootCause || p.whatHappened || "").slice(0, 70)}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-slate-500">
              Optional. Naming it lets the machine's history read as one chain rather than three
              unrelated dates.
            </p>
          </>
        )}
      </div>
    )}
  </div>
);

/**
 * What changes so this does not happen again.
 *
 * Discrete actions with an owner and a date rather than a paragraph of intent,
 * because a paragraph cannot be chased and an action can.
 */
const Prevention = ({ rows, onChange, people, invalid }) => {
  const set = (i, key, value) =>
    onChange(rows.map((r, n) => (n === i ? { ...r, [key]: value } : r)));

  return (
    <div className={invalid ? "ring-2 ring-rose-400 rounded-xl p-2 -m-2" : ""}>
      <div className="flex items-center justify-between mb-2">
        <label className="field-label mb-0">
          <ShieldCheck className="inline h-3 w-3 mr-1" />
          Prevention actions<span className="text-rose-600 ml-0.5">*</span>
        </label>
        <button
          type="button"
          className="btn btn-sm btn-neutral"
          onClick={() =>
            onChange([
              ...rows,
              { action_type: "Raise minimum stock", description: "", owner_user: "", target_date: "" },
            ])
          }
        >
          <Plus className="h-3.5 w-3.5" />
          Add
        </button>
      </div>

      {rows.length === 0 && (
        <p className="text-xs text-slate-500 mb-2">
          At least one. This is the step the whole record exists for — a breakdown
          closed with nothing recorded is one that will be reported again.
        </p>
      )}

      <div className="space-y-3">
        {rows.map((row, i) => (
          <div key={i} className="rounded-xl border border-slate-200 p-3 space-y-2">
            <div className="flex gap-2">
              <select
                className="field field-sm flex-1"
                value={row.action_type}
                onChange={(e) => set(i, "action_type", e.target.value)}
              >
                {PREVENTION_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="icon-btn icon-btn-danger"
                onClick={() => onChange(rows.filter((_, n) => n !== i))}
                aria-label="Remove"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
            <input
              className="field field-sm"
              placeholder="What exactly — the change, not the intention"
              value={row.description}
              onChange={(e) => set(i, "description", e.target.value)}
            />
            <div className="grid grid-cols-2 gap-2">
              <select
                className="field field-sm"
                value={row.owner_user}
                onChange={(e) => set(i, "owner_user", e.target.value)}
              >
                <option value="">Owner…</option>
                {people.map((p) => (
                  <option key={p.email} value={p.email}>
                    {p.name}
                  </option>
                ))}
              </select>
              <input
                type="date"
                className="field field-sm"
                value={row.target_date || ""}
                onChange={(e) => set(i, "target_date", e.target.value)}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

/* ----------------------------------------------------------------- report */

/**
 * Everything recorded so far, in stage order.
 *
 * This is the part that prints. A stage nobody has reached is left out rather
 * than shown empty — a report full of dashes reads as a form that was ignored
 * instead of a repair that has not got there yet.
 */
const Report = ({ record, user, onChanged }) => {
  const reached = (state) => JOURNEY.indexOf(record.state) >= JOURNEY.indexOf(state);

  return (
    <div className="space-y-5">
      <Block title="Reported">
        <KV label="Machine" value={`${record.machineName} (${record.machine})`} />
        <KV label="Plant" value={record.plant} />
        <KV label="Stopped at" value={when(record.stoppedAt)} />
        <KV label="Production stopped" value={record.productionStopped ? "Yes" : "No"} />
        <KV label="Reported by" value={record.reportedBy} />
        <KV label="What happened" value={record.whatHappened} wide />
      </Block>

      {reached("Repaired") && (
        <Block title="The repair">
          <KV label="Failure mode" value={record.failureMode} />
          <KV label="Repaired by" value={record.assignedTo} />
          <KV label="Hand over time" value={when(record.completedAt)} />
          <KV label="Actual downtime" value={hours(record.actualDowntimeHours)} />
          {/* Worked out at hand-over from the downtime and the machine's rate,
              never typed. Absent when the machine has no rate recorded yet. */}
          <KV
            label="Production lost"
            value={outputLabel(
              record.recordedOutputLost || record.outputLost,
              record.outputUom
            )}
          />
          <KV label="Labour" value={record.labourHours ? `${record.labourHours} person-hours` : ""} />
          {/* Two intervals, not three: nothing sits between the report and the
              start of work any more. */}
          <KV label="Time before work started" value={hours(splitOf(record).response)} />
          <KV label="Time under repair" value={hours(splitOf(record).repair)} />
          <KV label="What was done" value={record.actionsPerformed} wide />
          {record.spares?.length > 0 && (
            <SpareList key={record.sparesIssue?.status} record={record} user={user} onChanged={onChanged} />
          )}
        </Block>
      )}

      {reached("Closed") && (
        <Block title="Root cause analysis">
          <KV label="Root cause" value={record.rootCause} wide />
          <KV label="Closed at" value={when(record.closedAt)} />
          {record.repeatFailure && (
            <div className="sm:col-span-2">
              <p className="kv-label">Repeat failure</p>
              <p className="kv-value text-rose-700">
                This machine has failed this way before
                {record.repeatOf ? ` — see ${record.repeatOf}` : ", though the earlier one is not on record here"}.
              </p>
            </div>
          )}
        </Block>
      )}

      {record.preventionActions?.length > 0 && (
        <Block title="Prevention">
          <div className="col-span-2 space-y-2">
            {record.preventionActions.map((a, i) => (
              <div key={i} className="flex items-start gap-2 text-sm">
                <ShieldCheck className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                <div>
                  <span className="font-medium text-slate-800">{a.actionType}</span>
                  <span className="text-slate-600"> — {a.description}</span>
                  <div className="text-xs text-slate-500">
                    {a.owner || "no owner"} · by {day(a.targetDate)}
                    {a.completed ? " · done" : ""}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Block>
      )}
    </div>
  );
};

const Block = ({ title, children }) => (
  <div className="card p-5">
    <h3 className="section-title mb-3">{title}</h3>
    <div className="grid sm:grid-cols-2 gap-x-6 gap-y-3">{children}</div>
  </div>
);

const KV = ({ label, value, wide }) =>
  value ? (
    <div className={wide ? "sm:col-span-2" : ""}>
      <p className="kv-label">{label}</p>
      <p className="kv-value whitespace-pre-wrap">{value}</p>
    </div>
  ) : null;

/** Where the spares' goods issue stands in SAP. */
const ISSUE_STATE = {
  Draft: { label: "Not sent to SAP", style: "badge-slate" },
  Queued: { label: "Waiting for SAP", style: "badge-amber" },
  Posted: { label: "Issued in SAP", style: "badge-emerald" },
  Failed: { label: "SAP issue failed", style: "badge-rose" },
};

/** Who records the repair, and so may send its spares issue again (breakdownRoutes.js). */
const REPAIR_ROLES = ["Manager", "Maintenance Manager"];

const SpareList = ({ record, user, onChanged }) => {
  const { showToast } = useNotifications();
  const [issue, setIssue] = useState(record.sparesIssue);
  const [sending, setSending] = useState(false);
  const state = issue ? ISSUE_STATE[issue.status] || { label: issue.status, style: "badge-slate" } : null;
  const canResend =
    issue && ["Draft", "Failed"].includes(issue.status) && REPAIR_ROLES.includes(user?.role);

  const resend = async () => {
    setSending(true);
    try {
      const { data } = await API.post(`/breakdowns/${record.id}/spares-issue/resend`);
      setIssue(data);
      showToast(`${data.id} sent to SAP`, "success");
      onChanged?.();
    } catch (err) {
      showToast(err.response?.data?.message || "That step was refused", "error");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="sm:col-span-2">
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <p className="kv-label mb-0">Spares used</p>
        {state && <span className={`badge badge-soft ${state.style}`}>{state.label}</span>}
      </div>
      <ul className="text-sm text-slate-700 space-y-0.5">
        {record.spares.map((s, i) => (
          <li key={i}>
            {s.qtyRequired} &times; {s.description}
            {s.itemCode ? ` (${s.itemCode})` : ""}
          </li>
        ))}
      </ul>
      {issue && (
        <div className="mt-1.5 text-xs text-slate-500">
          {issue.id}
          {issue.sapDocNumber && ` · SAP Goods Issue ${issue.sapDocNumber}`}
          {issue.erpStockEntry && ` · ERPNext ${issue.erpStockEntry}`}
          {issue.status === "Failed" && issue.error && (
            <p className="mt-0.5 text-rose-700">SAP said: {issue.error}</p>
          )}
        </div>
      )}
      {canResend && (
        <button className="btn btn-sm btn-primary mt-2 print:hidden" onClick={resend} disabled={sending}>
          {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          {issue.status === "Draft" ? "Send to SAP" : "Send again"}
        </button>
      )}
    </div>
  );
};

export default BreakdownDetail;
