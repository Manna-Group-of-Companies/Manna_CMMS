import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  ChevronRight,
  Circle,
  Loader2,
  Package,
  Plus,
  Printer,
  Trash2,
  Users,
  X,
} from "lucide-react";

import API from "../../services/api";
import MaintenanceLogSheet from "./MaintenanceLogSheet";
import { useAuth } from "../../context/AuthContext";
import { useNotifications } from "../../context/NotificationContext";

/**
 * One maintenance request, in full.
 *
 * Built to the same contract as BreakdownDetail — the server says what each
 * stage collects and will not move without, and this fetches that rather than
 * keeping its own copy, so a field marked required here cannot drift from the
 * one actually enforced on save.
 *
 * The journey is shorter, and that is the whole point of the record existing.
 * There is no failure mode, no root cause and no prevention action, because a
 * fabrication job has none of those and asking for them is what produced a
 * column of "n/a" while these shared a form.
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

/** Four stops, against a breakdown's five. */
const JOURNEY = ["Requested", "In Progress", "Completed", "Closed"];

const WORKER_ROLES = ["Fitter", "Electrician", "Welder", "Helper", "Supervisor", "Contractor"];

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

const hours = (h) => {
  if (h === null || h === undefined || h === "") return "—";
  const n = Number(h);
  if (!Number.isFinite(n)) return "—";
  if (n < 1) return `${Math.round(n * 60)} min`;
  if (n < 48) return `${Math.round(n * 10) / 10} hr`;
  return `${Math.round(n / 24)} days`;
};

/** Now, in the format a datetime-local input wants. */
const localNow = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};

const toErpDateTime = (value) => (value ? `${value.replace("T", " ")}:00` : "");

const MaintenanceRequestDetail = ({ id, onClose, onChanged }) => {
  const { user } = useAuth();
  const { showToast } = useNotifications();

  const [record, setRecord] = useState(null);
  const [stages, setStages] = useState({});
  const [people, setPeople] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [logSheet, setLogSheet] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await API.get(`/maintenance-requests/${id}`);
      setRecord(data);
      setError("");
    } catch (err) {
      setError(err.response?.data?.message || "Could not load that request");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    API.get("/maintenance-requests/stages").then(({ data }) => setStages(data)).catch(() => {});
    API.get("/breakdowns/lookups")
      .then(({ data }) => setPeople(data.people || []))
      .catch(() => setPeople([]));
  }, []);

  const stage = record?.nextAction ? stages[record.nextAction] : null;

  /**
   * Whether the signed-in user may actually take the step that is due.
   *
   * Worked out here as well as on the server, and not to save a round trip: the
   * step that is due on a Completed request belongs to the person who raised
   * it, and showing everybody else a form they will be refused at the end of is
   * worse than showing them who they are waiting on.
   */
  const mayAct = useMemo(() => {
    if (!stage || !record || !user) return false;
    if (!stage.allowedRoles.includes(user.role)) return false;
    if (stage.requesterOnly && user.role !== "Manager") return user.email === record.requestedBy;
    return true;
  }, [stage, record, user]);

  const reached = useMemo(() => {
    if (!record) return -1;
    if (record.state === "Cancelled") return JOURNEY.indexOf("Requested");
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
            <Header record={record} onClose={onClose} onLogSheet={() => setLogSheet(true)} />

            <div className="px-6 pb-10 space-y-6">
              <Rail record={record} reached={reached} />

              {stage && mayAct && (
                <StageForm
                  key={record.nextAction}
                  action={record.nextAction}
                  stage={stage}
                  record={record}
                  people={people}
                  onDone={done}
                />
              )}

              {stage && !mayAct && (
                <div className="note note-slate print:hidden">
                  <span>
                    {stage.requesterOnly
                      ? `Waiting on ${record.requestedBy}, who raised it. Only they can close it.`
                      : `Waiting on maintenance: ${stage.title.toLowerCase()}.`}
                  </span>
                </div>
              )}

              <TurnDown record={record} stages={stages} user={user} onDone={done} />

              <Report record={record} />
            </div>
          </>
        )}

        {logSheet && <MaintenanceLogSheet record={record} onClose={() => setLogSheet(false)} />}
      </div>
    </div>
  );
};

const Header = ({ record, onClose, onLogSheet }) => (
  <div className="sticky top-0 z-10 bg-white border-b border-slate-200 px-6 py-4 print:static">
    <div className="flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="mono text-sm font-semibold text-slate-900">{record.id}</span>
          <span className={`badge ${STATE_STYLE[record.state] || "badge-slate"}`}>{record.state}</span>
          {record.priority && (
            <span className={`badge ${PRIORITY_STYLE[record.priority] || "badge-slate"}`}>
              {record.priority}
            </span>
          )}
          {record.requestType && (
            <span className="badge badge-slate badge-soft">{record.requestType}</span>
          )}
          {record.productionAffected && (
            <span className="badge badge-amber badge-soft">Production affected</span>
          )}
        </div>
        <h2 className="mt-1 text-lg font-bold tracking-tight text-slate-900 text-balance">
          {record.title}
        </h2>
        <p className="text-xs text-slate-500">
          {record.machine ? `${record.machineName} · ` : ""}
          {record.plant}
          {record.area ? ` · ${record.area}` : ""} · raised {when(record.requestedAt)}
        </p>
      </div>
      <div className="flex items-center gap-1 print:hidden">
        {/*
          The work sheet is offered from In Progress onwards.
          Before that there is nothing to carry to the job, and a blank sheet
          printed at the request stage is one that gets filled in from memory
          days later.
        */}
        {record.state !== "Requested" && (
          <button className="btn btn-sm btn-neutral" onClick={onLogSheet}>
            <Printer className="h-4 w-4" />
            Work sheet
          </button>
        )}
        <button className="modal-close" onClick={onClose} aria-label="Close">
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  </div>
);

/** The stages, and which one it is sitting on. */
const Rail = ({ record, reached }) => {
  if (record.state === "Cancelled") {
    return (
      <div className="note note-slate">
        <span>
          Cancelled{record.cancelledBy ? ` by ${record.cancelledBy}` : ""}.
          {record.cancelReason ? ` ${record.cancelReason}` : ""}
        </span>
      </div>
    );
  }

  const at = {
    Requested: record.requestedAt,
    "In Progress": record.startedAt,
    Completed: record.completedAt,
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
 * because the server will not accept them apart.
 */
const StageForm = ({ action, stage, record, people, onDone }) => {
  const has = (field) => stage.fields.includes(field);

  const [form, setForm] = useState(() => ({
    started_at: record.startedAt
      ? String(record.startedAt).replace(" ", "T").slice(0, 16)
      : localNow(),
    assigned_to: record.assignedTo || "",
    target_date: record.targetDate || "",
    plan_notes: record.planNotes || "",
    work_done: record.workDone || "",
    completed_at: record.completedAt
      ? String(record.completedAt).replace(" ", "T").slice(0, 16)
      : localNow(),
    closing_remarks: record.closingRemarks || "",
    satisfied: record.satisfied !== false,
  }));

  const [materials, setMaterials] = useState(() =>
    (record.materials || []).map((m) => ({
      item_code: m.itemCode,
      description: m.description,
      qty: m.qty,
      uom: m.uom,
      remarks: m.remarks,
    }))
  );
  const [crew, setCrew] = useState(() => (record.workedBy || []).map((w) => ({ ...w })));

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
    setSaving(true);
    setProblem("");
    setMissing([]);

    const fields = {};
    for (const field of stage.fields) {
      if (field === "materials_used") {
        fields.materials_used = materials.filter((m) => m.description?.trim());
      } else if (field === "worked_by") {
        fields.worked_by = crew.filter((w) => w.name?.trim());
      } else if (["started_at", "completed_at"].includes(field)) {
        fields[field] = toErpDateTime(form[field]);
      } else {
        fields[field] = form[field];
      }
    }

    try {
      const { data } = await API.post(`/maintenance-requests/${record.id}/action`, {
        action,
        fields,
      });
      onDone(data);
    } catch (err) {
      const body = err.response?.data;
      // 422 means the stage is incomplete and the server says which fields —
      // marking them beats a sentence the reader has to map back to the form.
      if (err.response?.status === 422 && body?.missing) setMissing(body.missing);
      setProblem(body?.message || "That step was refused");
    } finally {
      setSaving(false);
    }
  };

  const labourTotal = crew.reduce((sum, w) => sum + (Number(w.hours) || 0), 0);

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
        {has("started_at") && (
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Work started at" required invalid={isMissing("started_at")}>
              <div className="flex gap-2">
                <input
                  type="datetime-local"
                  className="field"
                  value={form.started_at}
                  onChange={set("started_at")}
                />
                <button
                  type="button"
                  className="btn btn-neutral shrink-0"
                  onClick={() => setForm((f) => ({ ...f, started_at: localNow() }))}
                >
                  Now
                </button>
              </div>
            </Field>
            <Field label="Target date" hint="What you are telling the requester to expect.">
              <input
                type="date"
                className="field"
                value={form.target_date || ""}
                onChange={set("target_date")}
              />
            </Field>
          </div>
        )}

        {has("assigned_to") && (
          <Field label="Assigned to">
            <select className="field" value={form.assigned_to} onChange={set("assigned_to")}>
              <option value="">Nobody yet</option>
              {people.map((p) => (
                <option key={p.email} value={p.email}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
        )}

        {has("plan_notes") && (
          <Field
            label="How it will be done"
            hint="Optional. Worth a line where the approach is not obvious, so nobody redesigns it halfway."
          >
            <textarea
              className="field field-area"
              rows={2}
              value={form.plan_notes}
              onChange={set("plan_notes")}
            />
          </Field>
        )}

        {has("work_done") && (
          <>
            <Field label="Work carried out" required invalid={isMissing("work_done")}>
              <textarea
                className="field field-area"
                rows={3}
                value={form.work_done}
                onChange={set("work_done")}
                placeholder="What was actually made or done, in the words the fitter would use."
              />
            </Field>
            <Field label="Completed at" required invalid={isMissing("completed_at")}>
              <div className="flex gap-2">
                <input
                  type="datetime-local"
                  className="field"
                  value={form.completed_at}
                  onChange={set("completed_at")}
                />
                <button
                  type="button"
                  className="btn btn-neutral shrink-0"
                  onClick={() => setForm((f) => ({ ...f, completed_at: localNow() }))}
                >
                  Now
                </button>
              </div>
            </Field>
          </>
        )}

        {has("materials_used") && <Materials rows={materials} onChange={setMaterials} />}

        {has("worked_by") && (
          <Crew
            rows={crew}
            onChange={setCrew}
            people={people}
            total={labourTotal}
            invalid={isMissing("worked_by")}
          />
        )}

        {has("closing_remarks") && (
          <>
            <Field
              label={stage.labels?.closing_remarks || "Closing remarks"}
              required={stage.required.includes("closing_remarks")}
              invalid={isMissing("closing_remarks")}
              hint="Optional unless you are closing somebody else's request."
            >
              <textarea
                className="field field-area"
                rows={2}
                value={form.closing_remarks}
                onChange={set("closing_remarks")}
              />
            </Field>
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                className="h-4 w-4 accent-brand-600"
                checked={form.satisfied}
                onChange={set("satisfied")}
              />
              <span className="text-sm text-slate-700">Done to satisfaction</span>
            </label>
            {!form.satisfied && (
              <p className="text-xs text-amber-700">
                Say what was wrong in the remarks. A request closed as unsatisfactory with no reason
                teaches nobody anything.
              </p>
            )}
          </>
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
 * Turning a request down, or taking it back.
 *
 * Tucked below the stage form and never beside it. Rejecting is not the next
 * step in the journey — it is the alternative to the journey — and a button
 * that sits next to "Start work" gets pressed by mistake on a busy morning.
 */
const TurnDown = ({ record, stages, user, onDone }) => {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState("");

  if (record.state !== "Requested" || !user) return null;

  const mine = user.email === record.requestedBy;
  const action = mine ? "Withdraw" : "Reject";
  const stage = stages[action];
  if (!stage || !stage.allowedRoles.includes(user.role)) return null;
  if (action === "Withdraw" && !mine && user.role !== "Manager") return null;

  const submit = async () => {
    if (!reason.trim()) {
      setProblem("Say why. A request that vanishes without a reason stops people raising them.");
      return;
    }
    setSaving(true);
    setProblem("");
    try {
      const { data } = await API.post(`/maintenance-requests/${record.id}/action`, {
        action,
        fields: { cancel_reason: reason.trim() },
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
        <div className="card p-4 space-y-3">
          <div>
            <h3 className="section-title">{stage.title}</h3>
            <p className="panel-sub">{stage.blurb}</p>
          </div>
          {problem && <div className="note note-rose">{problem}</div>}
          <textarea
            className="field field-area"
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={
              action === "Reject"
                ? "Why maintenance will not do it — or what would have to change first."
                : "Why it is no longer needed."
            }
          />
          <div className="flex justify-end gap-2">
            <button className="btn btn-sm btn-neutral" onClick={() => setOpen(false)}>
              Keep it
            </button>
            <button className="btn btn-sm btn-primary" onClick={submit} disabled={saving}>
              {saving ? "Saving…" : stage.title}
            </button>
          </div>
        </div>
      )}
    </div>
  );
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

/**
 * What the job consumed.
 *
 * Not checked against the catalog, for the same reason breakdown spares are
 * not: half of what a fabrication job uses is angle iron and welding rod that
 * nobody has created an Item for, and refusing to record it until somebody does
 * means it simply goes unrecorded.
 *
 * The unit matters more here than on a breakdown. A spare is counted in pieces;
 * material is counted in metres and kilos, and "4" with no unit against it is
 * an entry nobody can cost later.
 */
const Materials = ({ rows, onChange }) => {
  const set = (i, key, value) =>
    onChange(rows.map((r, n) => (n === i ? { ...r, [key]: value } : r)));

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="field-label mb-0">
          <Package className="inline h-3 w-3 mr-1" />
          Materials and items used
        </label>
        <button
          type="button"
          className="btn btn-sm btn-neutral"
          onClick={() => onChange([...rows, { item_code: "", description: "", qty: 1, uom: "nos" }])}
        >
          <Plus className="h-3.5 w-3.5" />
          Add
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="text-xs text-slate-500">
          Nothing yet. Write them in plain words with the unit — the catalog is still being renamed
          and recounted, so nothing here is checked against it.
        </p>
      ) : (
        <div className="space-y-2">
          {rows.map((row, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-start">
              <input
                className="field field-sm col-span-6"
                placeholder="What was used — 40x40x5 angle, 3.15 mm welding rod"
                value={row.description}
                onChange={(e) => set(i, "description", e.target.value)}
              />
              <input
                type="number"
                min="0"
                step="0.01"
                className="field field-sm col-span-2"
                placeholder="qty"
                value={row.qty}
                onChange={(e) => set(i, "qty", e.target.value)}
              />
              <input
                className="field field-sm col-span-2"
                placeholder="unit"
                list="cmms-uoms"
                value={row.uom || ""}
                onChange={(e) => set(i, "uom", e.target.value)}
              />
              <input
                className="field field-sm col-span-1"
                placeholder="note"
                value={row.remarks || ""}
                onChange={(e) => set(i, "remarks", e.target.value)}
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
          <datalist id="cmms-uoms">
            {["nos", "kg", "m", "ft", "litre", "set", "roll", "sheet"].map((u) => (
              <option key={u} value={u} />
            ))}
          </datalist>
        </div>
      )}
    </div>
  );
};

/**
 * Who did the work, and for how long.
 *
 * The same shape the breakdown record uses, and the same reasoning: a job is
 * rarely one person, and recording only whoever has a login makes "who actually
 * did this" unanswerable a year later. The name is free text with the accounts
 * offered as suggestions, because most of the team have no login at all.
 *
 * The total is shown and never typed. It is the sum of these rows, and asking
 * for it separately is what let a report say eight person-hours beside four
 * names adding up to fourteen.
 */
const Crew = ({ rows, onChange, people, total, invalid }) => {
  const set = (i, key, value) =>
    onChange(rows.map((r, n) => (n === i ? { ...r, [key]: value } : r)));

  return (
    <div className={invalid ? "ring-2 ring-rose-400 rounded-xl p-2 -m-2" : ""}>
      <div className="flex items-center justify-between mb-2">
        <label className="field-label mb-0">
          <Users className="inline h-3 w-3 mr-1" />
          Worked by<span className="text-rose-600 ml-0.5">*</span>
        </label>
        <div className="flex items-center gap-2">
          {total > 0 && (
            <span className="text-xs text-slate-500 tabular-nums">
              {Math.round(total * 10) / 10} person-hours
            </span>
          )}
          <button
            type="button"
            className="btn btn-sm btn-neutral"
            onClick={() => onChange([...rows, { name: "", user: "", role: "Fitter", hours: "" }])}
          >
            <Plus className="h-3.5 w-3.5" />
            Add
          </button>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="text-xs text-slate-500">
          Nobody named yet. Add everyone who worked on it and their hours — this is what the job
          cost in labour, and it is the only place it is recorded.
        </p>
      ) : (
        <div className="space-y-2">
          {rows.map((row, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-start">
              <input
                className="field field-sm col-span-5"
                placeholder="Name"
                list="cmms-request-people"
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
                {WORKER_ROLES.map((r) => (
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
          <datalist id="cmms-request-people">
            {people.map((p) => (
              <option key={p.email} value={p.name} />
            ))}
          </datalist>
        </div>
      )}
    </div>
  );
};

/* ----------------------------------------------------------------- report */

/** Everything recorded so far, in stage order. This is the part that prints. */
const Report = ({ record }) => {
  const reached = (state) => JOURNEY.indexOf(record.state) >= JOURNEY.indexOf(state);

  return (
    <div className="space-y-5">
      <Block title="The request">
        <KV label="Type of work" value={record.requestType} />
        <KV label="Priority" value={record.priority} />
        <KV
          label="For"
          value={record.machine ? `${record.machineName} (${record.machine})` : record.plant}
        />
        <KV label="Area" value={record.area} />
        <KV label="Raised by" value={record.requestedBy} />
        <KV label="Raised at" value={when(record.requestedAt)} />
        <KV label="Wanted by" value={record.neededBy ? day(record.neededBy) : ""} />
        <KV label="What is needed" value={record.whatIsNeeded} wide />
        <KV label="Why" value={record.whyNeeded} wide />
      </Block>

      {reached("In Progress") && record.state !== "Cancelled" && (
        <Block title="Taken on">
          <KV label="Accepted by" value={record.acceptedBy} />
          <KV label="Assigned to" value={record.assignedTo} />
          <KV label="Work started" value={when(record.startedAt)} />
          <KV label="Target date" value={record.targetDate ? day(record.targetDate) : ""} />
          <KV label="How it will be done" value={record.planNotes} wide />
        </Block>
      )}

      {reached("Completed") && (
        <Block title="The work">
          <KV label="Completed at" value={when(record.completedAt)} />
          <KV label="Completed by" value={record.completedBy} />
          <KV
            label="Labour"
            value={record.labourHours ? `${record.labourHours} person-hours` : ""}
          />
          <KV label="Time on the job" value={hours(record.workHours)} />
          <KV label="Turnaround" value={hours(record.turnaroundHours)} />
          <KV label="Work carried out" value={record.workDone} wide />
          {record.materials?.length > 0 && <MaterialList rows={record.materials} />}
          {record.workedBy?.length > 0 && <CrewList rows={record.workedBy} />}
        </Block>
      )}

      {reached("Closed") && (
        <Block title="Closed">
          <KV label="Closed by" value={record.closedBy} />
          <KV label="Closed at" value={when(record.closedAt)} />
          <KV label="Done to satisfaction" value={record.satisfied ? "Yes" : "No"} />
          <KV label="Closing remarks" value={record.closingRemarks} wide />
        </Block>
      )}

      {record.state === "Cancelled" && (
        <Block title="Cancelled">
          <KV label="By" value={record.cancelledBy} />
          <KV label="Reason" value={record.cancelReason} wide />
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
  value || value === 0 ? (
    <div className={wide ? "sm:col-span-2" : ""}>
      <p className="kv-label">{label}</p>
      <p className="kv-value whitespace-pre-wrap">{value}</p>
    </div>
  ) : null;

const MaterialList = ({ rows }) => (
  <div className="sm:col-span-2">
    <p className="kv-label mb-1.5">Materials used</p>
    <ul className="text-sm text-slate-700 space-y-0.5">
      {rows.map((m, i) => (
        <li key={i}>
          {m.qty} {m.uom || ""} &times; {m.description}
          {m.itemCode ? ` (${m.itemCode})` : ""}
          {m.remarks ? ` — ${m.remarks}` : ""}
        </li>
      ))}
    </ul>
  </div>
);

const CrewList = ({ rows }) => (
  <div className="sm:col-span-2">
    <p className="kv-label mb-1.5">Worked by</p>
    <ul className="text-sm text-slate-700 space-y-0.5">
      {rows.map((w, i) => (
        <li key={i}>
          {w.name}
          {w.role ? ` — ${w.role}` : ""}
          {w.hours ? ` · ${w.hours} hr` : ""}
        </li>
      ))}
    </ul>
  </div>
);

export default MaintenanceRequestDetail;
