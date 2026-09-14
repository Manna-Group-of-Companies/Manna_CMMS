import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Download,
  FileText,
  Image as ImageIcon,
  Loader2,
  Paperclip,
  Pencil,
  Trash2,
  Upload,
  X,
  Zap,
} from "lucide-react";

import API from "../../services/api";
import { useNotifications } from "../../context/NotificationContext";

/**
 * One plant's electrical system: the supply, and its paperwork.
 *
 * There was a subsystem editor here — the APFC panel, its capacitor steps, the
 * breakers inside each board. It is gone. The maintenance team keeps a document
 * describing the installation, and keeping that current is one job; keeping it
 * current *and* a three-level form up to date is two, and the second always
 * loses. A form that competes with a Word file ends with neither being trusted.
 *
 * So what is structured here is only what somebody needs to answer without
 * opening anything: the supply, the load, the licence. Everything else is the
 * document.
 */

const MAX_BYTES = 15 * 1024 * 1024;

const size = (bytes) => {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

const day = (v) => {
  if (!v) return "";
  const d = new Date(String(v).replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleDateString("en-IN", { dateStyle: "medium" });
};

const isImage = (name) => /\.(png|jpe?g|gif|webp|tiff?)$/i.test(name || "");

const ElectricalSystemDetail = ({ id, canEdit, canAttach, onClose, onChanged }) => {
  const { showToast } = useNotifications();

  const [system, setSystem] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef(null);

  const load = useCallback(async () => {
    try {
      const { data } = await API.get(`/electrical/${id}`);
      setSystem(data);
      setError("");
    } catch (err) {
      setError(err.response?.data?.message || "Could not load that system");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const refresh = () => {
    load();
    onChanged?.();
  };

  const upload = async (files) => {
    const list = [...files];
    if (!list.length) return;

    setUploading(true);
    for (const file of list) {
      if (file.size > MAX_BYTES) {
        showToast(
          `${file.name} is ${size(file.size)}. The limit is 15 MB — put it on a shared drive and note the link.`,
          "error"
        );
        continue;
      }
      try {
        const dataBase64 = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(",")[1]);
          reader.onerror = () => reject(new Error("Could not read that file"));
          reader.readAsDataURL(file);
        });
        await API.post(`/electrical/${id}/files`, {
          fileName: file.name,
          contentType: file.type,
          dataBase64,
        });
        showToast(`${file.name} attached`, "success");
      } catch (err) {
        showToast(err.response?.data?.message || `Could not attach ${file.name}`, "error");
      }
    }
    setUploading(false);
    if (fileInput.current) fileInput.current.value = "";
    refresh();
  };

  const remove = async (file) => {
    if (!window.confirm(`Remove ${file.fileName}?`)) return;
    try {
      await API.delete(`/electrical/${id}/files/${file.id}`);
      showToast(`${file.fileName} removed`, "success");
      refresh();
    } catch (err) {
      showToast(err.response?.data?.message || "Could not remove it", "error");
    }
  };

  return (
    <div className="modal-backdrop items-stretch justify-end p-0" onClick={onClose}>
      <div
        className="bg-white w-full max-w-3xl h-full overflow-y-auto shadow-2xl"
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
            <div className="sticky top-0 z-10 bg-white border-b border-slate-200 px-6 py-4 flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="eyebrow">{system.plant}</p>
                <h2 className="mt-0.5 text-lg font-bold tracking-tight text-slate-900 text-balance">
                  {system.name}
                </h2>
              </div>
              <button className="modal-close" onClick={onClose} aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="px-6 pb-10 space-y-5 pt-5">
              <Files
                files={system.files || []}
                canAttach={canAttach}
                uploading={uploading}
                fileInput={fileInput}
                onUpload={upload}
                onRemove={remove}
              />

              <Supply system={system} canEdit={canEdit} onEdit={() => setEditing(true)} />
            </div>
          </>
        )}
      </div>

      {editing && (
        <SupplyModal
          system={system}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            refresh();
          }}
        />
      )}
    </div>
  );
};

/**
 * The installation document, and everything that belongs with it.
 *
 * First on the page, because it is now where the detail lives. The supply
 * figures below are the handful of facts worth having without opening a file.
 */
const Files = ({ files, canAttach, uploading, fileInput, onUpload, onRemove }) => (
  <div className="card p-5">
    <div className="flex items-center justify-between mb-3">
      <div>
        <h3 className="section-title">
          <Paperclip className="inline h-4 w-4 mr-1.5" />
          Documents and drawings
        </h3>
        <p className="panel-sub">
          The installation document, single-line diagrams, test reports, panel schedules.
        </p>
      </div>
      {canAttach && (
        <>
          <input
            ref={fileInput}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => onUpload(e.target.files)}
          />
          <button
            className="btn btn-sm btn-primary shrink-0"
            onClick={() => fileInput.current?.click()}
            disabled={uploading}
          >
            <Upload className="h-4 w-4" />
            {uploading ? "Uploading…" : "Add files"}
          </button>
        </>
      )}
    </div>

    {files.length === 0 ? (
      <div className="empty-inline">
        <p className="empty-sub">
          Nothing attached yet. Start with the document describing the installation — the panels,
          what is inside them, and what each one feeds.
        </p>
      </div>
    ) : (
      <ul className="divide-y divide-slate-100">
        {files.map((f) => (
          <li key={f.id} className="flex items-center gap-3 py-2.5">
            <span className="text-slate-400 shrink-0">
              {isImage(f.fileName) ? <ImageIcon className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-slate-800 truncate">{f.fileName}</p>
              <p className="text-xs text-slate-500">
                {size(f.size)}
                {f.addedAt ? ` · added ${day(f.addedAt)}` : ""}
              </p>
            </div>
            <a
              href={f.url}
              target="_blank"
              rel="noreferrer"
              className="icon-btn shrink-0"
              aria-label={`Open ${f.fileName}`}
            >
              <Download className="h-4 w-4" />
            </a>
            {canAttach && (
              <button
                className="icon-btn icon-btn-danger shrink-0"
                onClick={() => onRemove(f)}
                aria-label={`Remove ${f.fileName}`}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </li>
        ))}
      </ul>
    )}
  </div>
);

/** The incoming supply. The facts an inspector or the board asks for. */
const Supply = ({ system: s, canEdit, onEdit }) => (
  <div className="card p-5">
    <div className="flex items-center justify-between mb-3">
      <div>
        <h3 className="section-title">
          <Zap className="inline h-4 w-4 mr-1.5" />
          The supply
        </h3>
        <p className="panel-sub">What comes in, and what is allowed to.</p>
      </div>
      {canEdit && (
        <button className="btn btn-sm btn-neutral shrink-0" onClick={onEdit}>
          <Pencil className="h-3.5 w-3.5" />
          Edit
        </button>
      )}
    </div>

    {!s.supplyType && !s.sanctionedLoadKw ? (
      <div className="note note-amber">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <span>
          Nothing recorded yet. The consumer number, sanctioned load and contract demand are on the
          electricity bill.
        </span>
      </div>
    ) : (
      <div className="grid sm:grid-cols-2 gap-x-6 gap-y-3">
        <KV label="Supply" value={[s.supplyType, s.supplyVoltage].filter(Boolean).join(" · ")} />
        <KV label="Consumer number" value={s.consumerNumber} />
        <KV label="Sanctioned load" value={s.sanctionedLoadKw ? `${s.sanctionedLoadKw} kW` : ""} />
        <KV label="Contract demand" value={s.contractDemandKva ? `${s.contractDemandKva} kVA` : ""} />
        <KV label="Connected load" value={s.connectedLoadKw ? `${s.connectedLoadKw} kW` : ""} />
        <KV label="Target power factor" value={s.targetPowerFactor || ""} />
        <KV label="DG backup" value={s.hasDgBackup ? `${s.dgCapacityKva || "?"} kVA` : ""} />
        <KV label="Solar" value={s.hasSolar ? `${s.solarCapacityKw || "?"} kW` : ""} />
        <KV label="Electrical supervisor" value={s.electricalSupervisor} />
        <KV
          label="Supervisor licence"
          value={
            s.licenceNumber
              ? `${s.licenceNumber}${s.licenceValidUntil ? ` · to ${day(s.licenceValidUntil)}` : ""}`
              : ""
          }
        />
        <KV label="Last statutory inspection" value={day(s.lastInspectionOn)} />
        <KV label="Next inspection due" value={day(s.nextInspectionDue)} />
        <KV label="Notes" value={s.notes} wide />
      </div>
    )}
  </div>
);

const KV = ({ label, value, wide }) =>
  value || value === 0 ? (
    <div className={wide ? "sm:col-span-2" : ""}>
      <p className="kv-label">{label}</p>
      <p className="kv-value whitespace-pre-wrap">{value}</p>
    </div>
  ) : null;

const Field = ({ label, hint, wide, children }) => (
  <div className={wide ? "sm:col-span-2" : ""}>
    <label className="field-label">{label}</label>
    {children}
    {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
  </div>
);

const SupplyModal = ({ system, onClose, onSaved }) => {
  const { showToast } = useNotifications();
  const [form, setForm] = useState({ ...system });
  const [saving, setSaving] = useState(false);
  const set = (f) => (e) =>
    setForm((x) => ({ ...x, [f]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await API.put(`/electrical/${system.id}`, {
        ...form,
        sanctionedLoadKw: Number(form.sanctionedLoadKw) || 0,
        contractDemandKva: Number(form.contractDemandKva) || 0,
        connectedLoadKw: Number(form.connectedLoadKw) || 0,
        targetPowerFactor: Number(form.targetPowerFactor) || 0,
        dgCapacityKva: Number(form.dgCapacityKva) || 0,
        solarCapacityKw: Number(form.solarCapacityKw) || 0,
      });
      showToast("Supply details saved", "success");
      onSaved();
    } catch (err) {
      showToast(err.response?.data?.message || "Could not save", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal max-w-2xl" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="modal-head">
          <h3 className="modal-title">The supply</h3>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="modal-body space-y-4">
          <p className="text-xs text-slate-500">
            Most of this is on the electricity bill and the supervisor’s licence. Everything about
            the panels themselves belongs in the document.
          </p>
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Supply">
              <select className="field" value={form.supplyType || ""} onChange={set("supplyType")}>
                <option value="">Not recorded</option>
                <option value="HT">HT</option>
                <option value="LT">LT</option>
              </select>
            </Field>
            <Field label="Supply voltage" hint="11 kV, 415 V">
              <input className="field" value={form.supplyVoltage || ""} onChange={set("supplyVoltage")} />
            </Field>
            <Field label="Consumer number">
              <input className="field mono" value={form.consumerNumber || ""} onChange={set("consumerNumber")} />
            </Field>
            <Field label="Target power factor" hint="What the board penalises below.">
              <input type="number" step="0.01" className="field" value={form.targetPowerFactor || ""} onChange={set("targetPowerFactor")} />
            </Field>
            <Field label="Sanctioned load (kW)">
              <input type="number" className="field" value={form.sanctionedLoadKw || ""} onChange={set("sanctionedLoadKw")} />
            </Field>
            <Field label="Contract demand (kVA)">
              <input type="number" className="field" value={form.contractDemandKva || ""} onChange={set("contractDemandKva")} />
            </Field>
            <Field label="Connected load (kW)" hint="What is actually wired up. Often exceeds the sanction.">
              <input type="number" className="field" value={form.connectedLoadKw || ""} onChange={set("connectedLoadKw")} />
            </Field>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="flex items-center gap-2.5 cursor-pointer">
                <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={Boolean(form.hasDgBackup)} onChange={set("hasDgBackup")} />
                <span className="text-sm text-slate-700">Has DG backup</span>
              </label>
              {form.hasDgBackup && (
                <input type="number" className="field" placeholder="kVA" value={form.dgCapacityKva || ""} onChange={set("dgCapacityKva")} />
              )}
            </div>
            <div className="space-y-2">
              <label className="flex items-center gap-2.5 cursor-pointer">
                <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={Boolean(form.hasSolar)} onChange={set("hasSolar")} />
                <span className="text-sm text-slate-700">Has solar</span>
              </label>
              {form.hasSolar && (
                <input type="number" className="field" placeholder="kW" value={form.solarCapacityKw || ""} onChange={set("solarCapacityKw")} />
              )}
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Electrical supervisor">
              <input className="field" value={form.electricalSupervisor || ""} onChange={set("electricalSupervisor")} />
            </Field>
            <Field label="Supervisor licence no">
              <input className="field mono" value={form.licenceNumber || ""} onChange={set("licenceNumber")} />
            </Field>
            <Field label="Licence valid until">
              <input type="date" className="field" value={form.licenceValidUntil || ""} onChange={set("licenceValidUntil")} />
            </Field>
            <Field label="Last statutory inspection">
              <input type="date" className="field" value={form.lastInspectionOn || ""} onChange={set("lastInspectionOn")} />
            </Field>
            <Field label="Next inspection due">
              <input type="date" className="field" value={form.nextInspectionDue || ""} onChange={set("nextInspectionDue")} />
            </Field>
          </div>

          <Field label="Notes" wide>
            <textarea className="field field-area" rows={2} value={form.notes || ""} onChange={set("notes")} />
          </Field>
        </div>
        <div className="modal-foot">
          <button type="button" className="btn btn-neutral" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
};

export default ElectricalSystemDetail;
