import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Plus, ReceiptIndianRupee, RefreshCw, Trash2, X } from "lucide-react";

import API from "../../services/api";
import { useAuth } from "../../context/AuthContext";
import { useNotifications } from "../../context/NotificationContext";
import { useFormDraft, describeWhen } from "../../hooks/useFormDraft";
import { formatCurrency } from "../../utils/currency";
import LowValuePurchaseSheet from "./LowValuePurchaseSheet";

/**
 * Low value purchase requests (20 Oct 2026): the small things a plant buys
 * locally - a bearing from the market, a box of gloves - kept in ERPNext and
 * never sent to SAP.
 *
 * Any manager or plant head raises one; the purchase manager buys it or turns
 * it down; whoever asked, or the purchase manager, records it received. Who may
 * take which step on a given request is the server's answer (`may` on each
 * record), so this screen never works it out from the role.
 */

const STATUS_STYLE = {
  Requested: "badge-amber",
  Ordered: "badge-cyan",
  Received: "badge-emerald",
  Rejected: "badge-rose",
  Withdrawn: "badge-slate",
};

const OPEN = ["Requested", "Ordered"];

const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** Local date; toISOString would give yesterday for the first hours of an Indian day. */
const today = () => ymd(new Date());
const daysAhead = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return ymd(d);
};

const day = (value) => {
  if (!value) return "—";
  const d = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString("en-IN", { dateStyle: "medium" });
};

const LowValuePurchases = () => {
  const { showToast } = useNotifications();

  const [rows, setRows] = useState([]);
  const [options, setOptions] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // "open" by default: the list is worked from, and finished ones pile up.
  const [status, setStatus] = useState("open");
  const [plant, setPlant] = useState("");
  const [opened, setOpened] = useState("");
  const [raising, setRaising] = useState(false);

  useEffect(() => {
    API.get("/low-value-purchases/options")
      .then(({ data }) => setOptions(data))
      .catch(() => setOptions({ units: [], statuses: [], maxLines: 30, plants: [] }));
  }, []);

  // The status is filtered here rather than by the server, so the counts above
  // the list stay the whole of what is open whichever status is picked.
  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const { data } = await API.get("/low-value-purchases", { params: { plant, limit: 300 } });
        setRows(Array.isArray(data) ? data : []);
        setError("");
      } catch (err) {
        if (!silent) {
          setError(err.response?.data?.message || `Cannot reach the server at ${API.defaults.baseURL}.`);
        }
      } finally {
        setLoading(false);
      }
    },
    [plant]
  );

  useEffect(() => {
    load();
  }, [load]);

  const shown = useMemo(
    () =>
      rows.filter((r) =>
        status === "open" ? OPEN.includes(r.status) : !status || r.status === status
      ),
    [rows, status]
  );

  const counts = useMemo(() => {
    const open = rows.filter((r) => OPEN.includes(r.status));
    return {
      toBuy: open.filter((r) => r.status === "Requested").length,
      toArrive: open.filter((r) => r.status === "Ordered").length,
      urgent: open.filter((r) => r.urgency === "Urgent").length,
      // What it was bought for once it is bought, the estimate until then.
      value: open.reduce((sum, r) => sum + (r.status === "Ordered" ? r.total : r.estTotal), 0),
    };
  }, [rows]);

  const statuses = options?.statuses?.length
    ? options.statuses
    : ["Requested", "Ordered", "Received", "Rejected", "Withdrawn"];

  return (
    <div className="space-y-5">
      <div className="panel">
        <div className="flex items-center gap-3">
          <span className="panel-icon">
            <ReceiptIndianRupee className="h-5 w-5" />
          </span>
          <div>
            <h2 className="panel-title">Low value purchases</h2>
            <p className="panel-sub">Bought locally by the purchase manager. Nothing here goes to SAP.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="field field-sm w-auto cursor-pointer"
            aria-label="Filter by status"
          >
            <option value="open">Open</option>
            <option value="">All statuses</option>
            {statuses.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          {options?.plants?.length > 1 && (
            <select
              value={plant}
              onChange={(e) => setPlant(e.target.value)}
              className="field field-sm w-auto cursor-pointer"
              aria-label="Filter by plant"
            >
              <option value="">All plants</option>
              {options.plants.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
          <button className="btn btn-sm btn-neutral" onClick={() => load()} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
          <button className="btn btn-sm btn-primary" onClick={() => setRaising(true)} disabled={!options}>
            <Plus className="h-4 w-4" />
            New request
          </button>
        </div>
      </div>

      {error && (
        <div className="note note-rose">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Waiting to be bought" value={counts.toBuy} tone={counts.toBuy ? "amber" : ""} />
        <Stat label="Waiting for delivery" value={counts.toArrive} />
        <Stat label="Urgent, still open" value={counts.urgent} tone={counts.urgent ? "rose" : ""} />
        <Stat label="Open value" value={formatCurrency(counts.value)} sub="estimate until bought" />
      </div>

      <div className="table-card">
        <div className="table-scroll">
          <table className="tbl">
            <thead>
              <tr>
                <th>Request</th>
                <th>Plant</th>
                <th>Raised</th>
                <th>Required by</th>
                <th className="text-right">Items</th>
                <th className="text-right">Estimated</th>
                <th className="text-right">Actual</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const late = OPEN.includes(r.status) && r.requiredBy && String(r.requiredBy) < today();
                return (
                  <tr key={r.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setOpened(r.id)}>
                    <td>
                      <div className="max-w-[280px]">
                        <span className="cell-title line-clamp-2">{r.purpose || r.lines?.[0]?.description}</span>
                        <div className="mono text-xs text-slate-500">{r.id}</div>
                      </div>
                    </td>
                    <td>
                      <span className="text-slate-700">{r.plant}</span>
                      {r.department && <div className="text-xs text-slate-500">{r.department}</div>}
                    </td>
                    <td>
                      <span className="text-slate-700">{r.raisedBy || "—"}</span>
                      <div className="text-xs text-slate-500">{day(r.raisedAt)}</div>
                    </td>
                    <td className="whitespace-nowrap">
                      <span className={late ? "text-rose-600" : "text-slate-700"}>{day(r.requiredBy)}</span>
                      {r.urgency === "Urgent" && (
                        <div>
                          <span className="badge badge-rose badge-soft">Urgent</span>
                        </div>
                      )}
                    </td>
                    <td className="text-right tabular-nums">{r.lines?.length || 0}</td>
                    <td className="text-right whitespace-nowrap tabular-nums">{formatCurrency(r.estTotal)}</td>
                    <td className="text-right whitespace-nowrap tabular-nums">
                      {r.order ? formatCurrency(r.total) : <span className="text-slate-400">—</span>}
                    </td>
                    <td>
                      <span className={`badge ${STATUS_STYLE[r.status] || "badge-slate"}`}>{r.status}</span>
                      {r.waitingOn && <div className="text-[11px] text-slate-500">{r.waitingOn}</div>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {!loading && shown.length === 0 && !error && (
          <div className="empty">
            <ReceiptIndianRupee className="h-8 w-8 text-slate-300 mb-2" />
            <p className="empty-title">Nothing here</p>
            <p className="empty-sub">
              {rows.length
                ? "No low value purchase requests match this filter."
                : "No low value purchase requests have been raised yet."}
            </p>
          </div>
        )}
      </div>

      {opened && (
        <LowValuePurchaseSheet id={opened} onClose={() => setOpened("")} onChanged={() => load(true)} />
      )}

      {raising && (
        <RaiseModal
          options={options}
          onClose={() => setRaising(false)}
          onDone={(created) => {
            setRaising(false);
            showToast(`${created.id} raised. The purchase manager has it.`, "success");
            load(true);
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

let seq = 0;
const blankLine = () => ({
  key: `l${Date.now()}-${(seq += 1)}`,
  description: "",
  specification: "",
  qty: "",
  unit: "Nos",
  estRate: "",
  remarks: "",
});

const amountOf = (l) => {
  const qty = Number(l.qty);
  const rate = Number(l.estRate);
  return qty > 0 && rate > 0 ? qty * rate : 0;
};

/** Only what somebody actually typed counts as a draft worth restoring. */
const isWorthKeeping = ({ form } = {}) =>
  Boolean(form) &&
  (Boolean(String(form.purpose || "").trim()) ||
    (form.lines || []).some((l) => String(l.description || "").trim()));

/**
 * Raising one: the top of the paper sheet, then its item rows.
 *
 * The plant is the server's list of the plants this person may buy for, so a
 * plant head is offered exactly one and is not asked.
 */
const RaiseModal = ({ options, onClose, onDone }) => {
  const { user } = useAuth();
  const plants = options?.plants || [];
  const units = options?.units || [];
  const maxLines = options?.maxLines || 30;
  const onlyPlant = plants.length === 1 ? plants[0].name : "";

  const draft = useFormDraft("low-value-purchase", { isWorthKeeping });
  const { save: saveDraft, saveNow: saveDraftNow, clear: clearDraft } = draft;
  const empty = () => ({
    plant: onlyPlant,
    department: "",
    urgency: "Normal",
    requiredBy: daysAhead(3),
    purpose: "",
    lines: [blankLine()],
  });
  const [form, setForm] = useState(() => {
    const saved = draft.restored?.form;
    if (!saved) return empty();
    return {
      ...empty(),
      ...saved,
      // A plant no longer theirs, or a date gone by, is not put back.
      plant: plants.some((p) => p.name === saved.plant) ? saved.plant : onlyPlant,
      requiredBy: saved.requiredBy && saved.requiredBy >= today() ? saved.requiredBy : daysAhead(3),
      lines: (saved.lines || []).length ? saved.lines : [blankLine()],
    };
  });
  const [restoredFrom, setRestoredFrom] = useState(draft.restored?.form ? draft.restored.savedAt : null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Saved while typing and once more on the way out, however the form is left.
  const latest = useRef({ form });
  latest.current = { form };
  const finished = useRef(false);
  useEffect(() => {
    saveDraft({ form });
  }, [form, saveDraft]);
  useEffect(
    () => () => {
      if (!finished.current) saveDraftNow(latest.current);
    },
    [saveDraftNow]
  );

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  const setLine = (key, field, value) =>
    setForm((f) => ({ ...f, lines: f.lines.map((l) => (l.key === key ? { ...l, [field]: value } : l)) }));
  const addLine = () =>
    setForm((f) => (f.lines.length >= maxLines ? f : { ...f, lines: [...f.lines, blankLine()] }));
  const removeLine = (key) =>
    setForm((f) => ({ ...f, lines: f.lines.length > 1 ? f.lines.filter((l) => l.key !== key) : f.lines }));

  const total = form.lines.reduce((sum, l) => sum + amountOf(l), 0);

  const validate = () => {
    if (!form.plant) return "Choose the plant it is for.";
    if (!form.requiredBy) return "Say by when it is needed.";
    if (form.requiredBy < today()) return "The required-by date cannot be in the past.";
    if (!form.purpose.trim()) return "Say what it is for.";
    for (const [i, l] of form.lines.entries()) {
      const n = `Item ${i + 1}`;
      if (!l.description.trim()) return `${n}: say what is needed.`;
      if (!(Number(l.qty) > 0)) return `${n}: the quantity must be more than zero.`;
      if (!l.unit.trim()) return `${n}: give the unit.`;
      if (l.estRate !== "" && !(Number(l.estRate) >= 0)) return `${n}: the estimated rate cannot be negative.`;
    }
    return "";
  };

  const submit = async (e) => {
    e.preventDefault();
    const problem = validate();
    setError(problem);
    if (problem) return;
    setSaving(true);
    try {
      const { data } = await API.post("/low-value-purchases", {
        plant: form.plant,
        department: form.department.trim(),
        urgency: form.urgency,
        requiredBy: form.requiredBy,
        purpose: form.purpose.trim(),
        lines: form.lines.map((l) => ({
          description: l.description.trim(),
          specification: l.specification.trim(),
          qty: Number(l.qty),
          unit: l.unit.trim(),
          estRate: l.estRate === "" ? 0 : Number(l.estRate),
          remarks: l.remarks.trim(),
        })),
      });
      finished.current = true;
      clearDraft();
      onDone(data);
    } catch (err) {
      setError(err.response?.data?.message || "Could not save the request.");
    } finally {
      setSaving(false);
    }
  };

  const startFresh = () => {
    clearDraft();
    setRestoredFrom(null);
    setForm(empty());
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal max-w-4xl" onClick={(e) => e.stopPropagation()} onSubmit={submit} noValidate>
        <div className="modal-head">
          <div className="min-w-0">
            <h3 className="modal-title">
              <ReceiptIndianRupee className="h-[18px] w-[18px] text-brand-700 shrink-0" />
              Low value purchase request
            </h3>
            <p className="modal-sub">For things bought locally. It is not sent to SAP.</p>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="modal-body space-y-4">
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

          {plants.length === 0 && (
            <div className="note note-amber">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-px" />
              <span>There is no plant you may raise a request for. Ask the Admin.</span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {onlyPlant ? (
              <div className="kv">
                <span className="kv-label">Plant</span>
                <span className="kv-value">{onlyPlant}</span>
              </div>
            ) : (
              <div>
                <label className="field-label" htmlFor="lvp-plant">
                  Plant
                </label>
                <select id="lvp-plant" className="field cursor-pointer" value={form.plant} onChange={set("plant")}>
                  <option value="">Choose…</option>
                  {plants.map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className="field-label" htmlFor="lvp-dept">
                Department
              </label>
              <input
                id="lvp-dept"
                className="field"
                value={form.department}
                onChange={set("department")}
                maxLength={60}
                placeholder="Maintenance, Production…"
              />
            </div>
            <div>
              <label className="field-label" htmlFor="lvp-required">
                Required by
              </label>
              <input
                id="lvp-required"
                type="date"
                className="field"
                min={today()}
                value={form.requiredBy}
                onChange={set("requiredBy")}
              />
            </div>
            <div>
              <span className="field-label">Urgency</span>
              <div className="tabs w-full">
                {["Normal", "Urgent"].map((u) => (
                  <button
                    key={u}
                    type="button"
                    className={`tab flex-1 ${form.urgency === u ? "tab-active" : ""}`}
                    onClick={() => setForm((f) => ({ ...f, urgency: u }))}
                    aria-pressed={form.urgency === u}
                  >
                    {u}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div>
            <label className="field-label" htmlFor="lvp-purpose">
              Purpose
            </label>
            <textarea
              id="lvp-purpose"
              className="field field-area"
              rows={2}
              maxLength={500}
              value={form.purpose}
              onChange={set("purpose")}
              placeholder="What it is for - e.g. replacing the worn coupling on mixer 2"
            />
          </div>

          <div>
            <div className="flex items-baseline justify-between gap-3">
              <span className="field-label">Items</span>
              <span className="text-[11px] text-slate-500">
                {form.lines.length} of {maxLines}
              </span>
            </div>
            {/* One block per line rather than a table, so the form still works
                on a phone. */}
            <datalist id="lvp-units">
              {units.map((u) => (
                <option key={u} value={u} />
              ))}
            </datalist>
            <ol className="space-y-2">
              {form.lines.map((l, i) => (
                <li key={l.key} className="rounded-xl border border-slate-200 p-3">
                  <div className="flex items-start gap-2">
                    <span className="mt-2 w-6 shrink-0 text-[12px] font-semibold text-slate-500 tabular-nums">
                      {i + 1}.
                    </span>
                    <div className="min-w-0 flex-1 grid grid-cols-2 sm:grid-cols-12 gap-2">
                      <input
                        className="field field-sm col-span-2 sm:col-span-5"
                        value={l.description}
                        onChange={(e) => setLine(l.key, "description", e.target.value)}
                        maxLength={140}
                        placeholder="Item / description"
                        aria-label={`Item ${i + 1} description`}
                      />
                      <input
                        className="field field-sm col-span-2 sm:col-span-7"
                        value={l.specification}
                        onChange={(e) => setLine(l.key, "specification", e.target.value)}
                        maxLength={140}
                        placeholder="Specification / size / make"
                        aria-label={`Item ${i + 1} specification`}
                      />
                      <input
                        type="number"
                        min="0"
                        step="any"
                        inputMode="decimal"
                        className="field field-sm sm:col-span-2"
                        value={l.qty}
                        onChange={(e) => setLine(l.key, "qty", e.target.value)}
                        placeholder="Qty"
                        aria-label={`Item ${i + 1} quantity`}
                      />
                      <input
                        list="lvp-units"
                        className="field field-sm sm:col-span-2"
                        value={l.unit}
                        onChange={(e) => setLine(l.key, "unit", e.target.value)}
                        maxLength={20}
                        placeholder="Unit"
                        aria-label={`Item ${i + 1} unit`}
                      />
                      <input
                        type="number"
                        min="0"
                        step="any"
                        inputMode="decimal"
                        className="field field-sm sm:col-span-2"
                        value={l.estRate}
                        onChange={(e) => setLine(l.key, "estRate", e.target.value)}
                        placeholder="Est. rate ₹"
                        aria-label={`Item ${i + 1} estimated rate`}
                      />
                      <div className="flex items-center justify-end sm:col-span-2 text-[13px] tabular-nums text-slate-700">
                        {amountOf(l) ? formatCurrency(amountOf(l)) : "—"}
                      </div>
                      <input
                        className="field field-sm col-span-2 sm:col-span-4"
                        value={l.remarks}
                        onChange={(e) => setLine(l.key, "remarks", e.target.value)}
                        maxLength={140}
                        placeholder="Remarks (optional)"
                        aria-label={`Item ${i + 1} remarks`}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => removeLine(l.key)}
                      disabled={form.lines.length === 1}
                      className="icon-btn icon-btn-danger"
                      title="Remove"
                      aria-label={`Remove item ${i + 1}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </li>
              ))}
            </ol>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                className="btn btn-sm btn-neutral"
                onClick={addLine}
                disabled={form.lines.length >= maxLines}
              >
                <Plus className="h-4 w-4" />
                Add item
              </button>
              <p className="text-[13px] text-slate-600">
                Estimated total{" "}
                <span className="ml-1 text-base font-bold tabular-nums text-slate-900">{formatCurrency(total)}</span>
              </p>
            </div>
          </div>

          <p className="text-xs text-slate-500">Raised as {user?.name || user?.email}.</p>

          {error && <div className="note note-rose text-sm">{error}</div>}
        </div>

        <div className="modal-foot">
          <button type="button" className="btn btn-neutral" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving || plants.length === 0}>
            {saving ? "Raising…" : "Raise request"}
          </button>
        </div>
      </form>
    </div>
  );
};

export default LowValuePurchases;
