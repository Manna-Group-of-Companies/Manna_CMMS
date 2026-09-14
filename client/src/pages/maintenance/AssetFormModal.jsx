import { useEffect, useRef, useState } from "react";
import { Factory, X } from "lucide-react";

import API from "../../services/api";
import { useNotifications } from "../../context/NotificationContext";
import { useFormDraft, describeWhen } from "../../hooks/useFormDraft";

/**
 * Adding a machine to the register.
 *
 * Long, because a machine genuinely has this much to say about it — and every
 * field here is one somebody would otherwise be ringing the supplier to ask
 * about at the moment it has stopped. Grouped so it reads as four short forms
 * rather than one wall of inputs.
 *
 * Only the first group is required. A machine half-recorded is worth far more
 * than one nobody entered because they did not have the serial number to hand,
 * and the rest can be filled in from the detail view later.
 */

const EMPTY = {
  code: "",
  name: "",
  plant: "",
  type: "",
  area: "",
  criticality: "B - Important",
  status: "Running",

  make: "",
  model: "",
  serialNo: "",
  yearMade: "",
  capacity: "",
  motorKw: "",
  commissionedOn: "",

  shiftsPerDay: "",
  runningHoursPerDay: "",
  outputPerHour: "",
  outputUom: "",
  standbyAvailable: false,
  stopsWholePlant: false,

  needsPower: true,
  needsSteam: false,
  needsThermicFluid: false,
  needsCompressedAir: false,
  needsCoolingWater: false,

  statutoryInspection: false,
  statutoryDueDate: "",
  maintainedBy: "In-house",
  supplierContact: "",
  recurringProblems: "",
  notes: "",
};

/** Only what somebody actually typed counts as a draft worth restoring. */
const isWorthKeeping = ({ form } = {}) => {
  if (!form) return false;
  return ["code", "name", "make", "model", "serialNo", "type", "area", "notes"].some((f) =>
    String(form[f] || "").trim()
  );
};

const AssetFormModal = ({ plants, asset = null, onClose, onSaved }) => {
  const { showToast } = useNotifications();
  const isEdit = Boolean(asset);
  // No draft when editing: a half-typed change restored over a real record
  // would put back values somebody had already decided against.
  const draft = useFormDraft("add-machine", { enabled: !isEdit, isWorthKeeping });
  const savedDraft = draft.restored;
  const { save: saveDraft, saveNow: saveDraftNow, clear: clearDraft } = draft;

  const [form, setForm] = useState(() =>
    isEdit
      ? { ...EMPTY, ...asset, commissionedOn: asset.commissionedOn || "", statutoryDueDate: asset.statutoryDueDate || "" }
      : { ...EMPTY, ...(savedDraft?.form || {}) }
  );
  const [restoredFrom, setRestoredFrom] = useState(
    !isEdit && savedDraft?.form ? savedDraft.savedAt : null
  );
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState("");

  const set = (field) => (e) =>
    setForm((f) => ({
      ...f,
      [field]: e.target.type === "checkbox" ? e.target.checked : e.target.value,
    }));

  /**
   * Saved on a debounce while typing, and once more on the way out.
   *
   * Unmount rather than an onClose handler, because the form can be left by the
   * X, by Cancel, by the backdrop or by the page navigating away, and only
   * unmount catches all of them.
   */
  const latest = useRef({ form });
  latest.current = { form };
  const finished = useRef(false);

  /**
   * The units ERPNext holds, for the output-unit picker.
   *
   * `output_uom` is a Link field, so a spelling ERPNext does not have is
   * refused on save. Offering the real list is the difference between picking
   * a unit and being told no after filling in the whole form.
   */
  const [units, setUnits] = useState([]);
  useEffect(() => {
    API.get("/products/units")
      .then(({ data }) => setUnits([...(data?.inUse || []), ...(data?.others || [])]))
      // A missing picker costs a datalist, not the form.
      .catch(() => setUnits([]));
  }, []);

  useEffect(() => {
    saveDraft({ form });
  }, [form, saveDraft]);

  useEffect(
    () => () => {
      if (!finished.current) saveDraftNow(latest.current);
    },
    [saveDraftNow]
  );

  const submit = async (e) => {
    e.preventDefault();
    if (!form.code.trim()) return showToast("A machine code is required", "error");
    if (!form.name.trim()) return showToast("A machine name is required", "error");
    if (!form.plant) return showToast("Choose a plant", "error");

    setSaving(true);
    setProblem("");
    try {
      const body = {
        ...form,
        yearMade: form.yearMade ? Number(form.yearMade) : undefined,
        motorKw: form.motorKw ? Number(form.motorKw) : undefined,
        shiftsPerDay: form.shiftsPerDay ? Number(form.shiftsPerDay) : undefined,
        runningHoursPerDay: form.runningHoursPerDay ? Number(form.runningHoursPerDay) : undefined,
        outputPerHour: form.outputPerHour ? Number(form.outputPerHour) : undefined,
      };
      const { data } = isEdit
        ? await API.put(`/assets/${asset.code}`, body)
        : await API.post("/assets", body);
      finished.current = true;
      clearDraft();
      onSaved(data);
    } catch (err) {
      setProblem(err.response?.data?.message || `Could not save it: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const close = () => onClose();

  const startFresh = () => {
    clearDraft();
    setRestoredFrom(null);
    setForm(EMPTY);
  };

  return (
    <div className="modal-backdrop" onClick={close}>
      <form className="modal max-w-3xl" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="modal-head">
          <h3 className="modal-title">
            <Factory className="h-[18px] w-[18px] text-brand-700 shrink-0" />
            {isEdit ? `Edit ${asset.name}` : "Add a machine"}
          </h3>
          <button type="button" className="modal-close" onClick={close} aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="modal-body space-y-6">
          {restoredFrom && (
            <div className="note note-brand items-center justify-between">
              <span>Picked up where you left off, saved {describeWhen(restoredFrom)}.</span>
              <button
                type="button"
                onClick={startFresh}
                className="shrink-0 font-semibold underline underline-offset-2 hover:no-underline cursor-pointer"
              >
                Start fresh
              </button>
            </div>
          )}

          {problem && <div className="note note-rose">{problem}</div>}

          <Group title="What it is" hint="The only part that is required.">
            <Field
              label="Machine code"
              required
              hint={isEdit ? "The record is named by this and cannot be renamed here." : "What the plate says — MRP-PRE-01."}
            >
              <input
                className={`field mono ${isEdit ? "bg-slate-50" : ""}`}
                value={form.code}
                onChange={set("code")}
                readOnly={isEdit}
                required
              />
            </Field>
            <Field label="Machine name" required>
              <input className="field" value={form.name} onChange={set("name")} required />
            </Field>
            <Field label="Plant" required>
              <select className="field" value={form.plant} onChange={set("plant")} required>
                <option value="">Choose…</option>
                {plants.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Area" hint="Where it stands — Devulcanising, Press shop.">
              <input className="field" value={form.area} onChange={set("area")} />
            </Field>
            <Field label="Type" hint="Autoclave, Refiner, Press.">
              <input className="field" value={form.type} onChange={set("type")} />
            </Field>
            <Field
              label="Criticality"
              hint="A means a breakdown gets a root cause analysis. Not everything can be A."
            >
              <select className="field" value={form.criticality} onChange={set("criticality")}>
                {["A - Critical", "B - Important", "C - Ordinary"].map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </Field>
          </Group>

          <Group title="The nameplate" hint="What you would otherwise ring the supplier to ask.">
            <Field label="Make">
              <input className="field" value={form.make} onChange={set("make")} />
            </Field>
            <Field label="Model">
              <input className="field" value={form.model} onChange={set("model")} />
            </Field>
            <Field label="Serial number">
              <input className="field mono" value={form.serialNo} onChange={set("serialNo")} />
            </Field>
            <Field label="Year made">
              <input type="number" className="field" value={form.yearMade} onChange={set("yearMade")} />
            </Field>
            <Field label="Capacity" hint="As the plate states it.">
              <input className="field" value={form.capacity} onChange={set("capacity")} />
            </Field>
            <Field label="Motor (kW)">
              <input type="number" step="0.1" className="field" value={form.motorKw} onChange={set("motorKw")} />
            </Field>
            <Field label="Commissioned on">
              <input type="date" className="field" value={form.commissionedOn} onChange={set("commissionedOn")} />
            </Field>
            <Field label="Status">
              <select className="field" value={form.status} onChange={set("status")}>
                {["Running", "Under Repair", "Stopped", "Retired"].map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </Field>
          </Group>

          <Group
            title="How hard it works"
            hint="What a stoppage costs. The loss per hour is what turns downtime into a number."
          >
            <Field label="Shifts per day">
              <input type="number" className="field" value={form.shiftsPerDay} onChange={set("shiftsPerDay")} />
            </Field>
            <Field label="Running hours per day">
              <input type="number" step="0.5" className="field" value={form.runningHoursPerDay} onChange={set("runningHoursPerDay")} />
            </Field>
            {/* What the machine makes in an hour, which is what a stoppage
                actually costs the plant. This replaced a rupee loss rate: a
                money figure per breakdown read as fact while resting on a rate
                nobody had agreed, and there was nothing to check it against. */}
            <Field
              label="Output per hour"
              hint="What it makes in an hour when running normally. Downtime × this is the production a stoppage costs."
            >
              <input
                type="number"
                step="0.1"
                min="0"
                className="field"
                value={form.outputPerHour}
                onChange={set("outputPerHour")}
              />
            </Field>
            <Field label="Output unit" hint="What that output is counted in — Kg for a mill, Nos for a press.">
              <input
                className="field"
                list="asset-output-uoms"
                placeholder="Kg"
                value={form.outputUom}
                onChange={set("outputUom")}
              />
              {/* A datalist rather than a select: it must be one of ERPNext's
                  units (the field is a Link, so an invented one is refused on
                  save), but the list is long and typing "Kg" is faster than
                  finding it. */}
              <datalist id="asset-output-uoms">
                {units.map((u) => (
                  <option key={u} value={u} />
                ))}
              </datalist>
            </Field>
            <div className="sm:col-span-2 space-y-2">
              <Check label="A standby is available" checked={form.standbyAvailable} onChange={set("standbyAvailable")} />
              <Check label="Stopping it stops the whole plant" checked={form.stopsWholePlant} onChange={set("stopsWholePlant")} />
            </div>
          </Group>

          <Group title="What it needs" hint="Which utilities have to be live for it to run.">
            <div className="sm:col-span-2 grid sm:grid-cols-2 gap-2">
              <Check label="Power" checked={form.needsPower} onChange={set("needsPower")} />
              <Check label="Steam" checked={form.needsSteam} onChange={set("needsSteam")} />
              <Check label="Thermic fluid" checked={form.needsThermicFluid} onChange={set("needsThermicFluid")} />
              <Check label="Compressed air" checked={form.needsCompressedAir} onChange={set("needsCompressedAir")} />
              <Check label="Cooling water" checked={form.needsCoolingWater} onChange={set("needsCoolingWater")} />
            </div>
          </Group>

          <Group title="Looking after it">
            <Field label="Maintained by">
              <select className="field" value={form.maintainedBy} onChange={set("maintainedBy")}>
                {["In-house", "AMC", "Both"].map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Supplier contact" hint="Who to ring. A name and a number.">
              <input className="field" value={form.supplierContact} onChange={set("supplierContact")} />
            </Field>
            <div className="sm:col-span-2">
              <Check
                label="Needs a statutory inspection"
                checked={form.statutoryInspection}
                onChange={set("statutoryInspection")}
              />
            </div>
            {form.statutoryInspection && (
              <Field label="Next inspection due">
                <input type="date" className="field" value={form.statutoryDueDate} onChange={set("statutoryDueDate")} />
              </Field>
            )}
            <Field label="Recurring problems" wide hint="What it keeps doing. The most useful field here.">
              <textarea className="field field-area" rows={2} value={form.recurringProblems} onChange={set("recurringProblems")} />
            </Field>
            <Field label="Notes" wide>
              <textarea className="field field-area" rows={2} value={form.notes} onChange={set("notes")} />
            </Field>
          </Group>

          <p className="text-xs text-slate-500">
            Drawings, manuals and the component document are attached from the machine’s own page.
          </p>
        </div>

        <div className="modal-foot">
          <button type="button" className="btn btn-neutral" onClick={close}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? "Saving…" : isEdit ? "Save changes" : "Add to the register"}
          </button>
        </div>
      </form>
    </div>
  );
};

const Group = ({ title, hint, children }) => (
  <div>
    <h4 className="section-title">{title}</h4>
    {hint && <p className="panel-sub mb-3">{hint}</p>}
    <div className="grid sm:grid-cols-2 gap-4">{children}</div>
  </div>
);

const Field = ({ label, hint, required, wide, children }) => (
  <div className={wide ? "sm:col-span-2" : ""}>
    <label className="field-label">
      {label}
      {required && <span className="text-rose-600 ml-0.5">*</span>}
    </label>
    {children}
    {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
  </div>
);

const Check = ({ label, checked, onChange }) => (
  <label className="flex items-center gap-2.5 cursor-pointer">
    <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={checked} onChange={onChange} />
    <span className="text-sm text-slate-700">{label}</span>
  </label>
);

export default AssetFormModal;
