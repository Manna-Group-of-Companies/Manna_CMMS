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
} from "lucide-react";

import API from "../../services/api";
import ConditionSelect from "./ConditionSelect";
import MachineHistory from "./MachineHistory";
import MachinePrevention from "./MachinePrevention";
import { useNotifications } from "../../context/NotificationContext";

/**
 * One machine, in full — and everything that came with it.
 *
 * The attachments are the point of this screen. A drawing that lives in a
 * drawer in the maintenance office is a drawing nobody has at two in the
 * morning; the same file against the machine record is one anybody can open
 * from the floor.
 */

/** The server refuses anything larger, and says so — this is the same number. */
const MAX_BYTES = 15 * 1024 * 1024;

const size = (bytes) => {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

const when = (value) => {
  if (!value) return "";
  const d = new Date(String(value).replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-IN", { dateStyle: "medium" });
};

const isImage = (name) => /\.(png|jpe?g|gif|webp|tiff?)$/i.test(name || "");

/**
 * One machine, in full.
 *
 * There was a component editor here — a list of gearboxes and motors with their
 * ratings. It is gone. The maintenance team keeps a document per machine
 * describing what it is made of, and keeping that current is one job; keeping
 * it current *and* a form up to date is two, and the second always loses.
 * The document is attached below with the drawings.
 *
 * `canEdit` covers the machine's own figures. `canAttach` is looser: a
 * production manager holding the manual for their own press should be able to
 * put it on the record without asking maintenance to do it for them.
 */
const AssetDetail = ({ id, canEdit, canAttach, onClose, onChanged, onEdit }) => {
  const { showToast } = useNotifications();

  const [asset, setAsset] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef(null);

  const load = useCallback(async () => {
    try {
      const { data } = await API.get(`/assets/${id}`);
      setAsset(data);
      setError("");
    } catch (err) {
      setError(err.response?.data?.message || "Could not load that machine");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

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
        // Read as base64 so it can travel as JSON. The server has no multipart
        // parser, and adding one for the single place that uploads was not
        // worth the dependency.
        const dataBase64 = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(",")[1]);
          reader.onerror = () => reject(new Error("Could not read that file"));
          reader.readAsDataURL(file);
        });

        await API.post(`/assets/${id}/files`, {
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
    load();
    onChanged?.();
  };

  const remove = async (file) => {
    if (!window.confirm(`Remove ${file.fileName}?`)) return;
    try {
      await API.delete(`/assets/${id}/files/${file.id}`);
      showToast(`${file.fileName} removed`, "success");
      load();
      onChanged?.();
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
                <div className="flex flex-wrap items-center gap-2">
                  <span className="mono text-sm font-semibold text-slate-900">{asset.code}</span>
                  {/* The condition, set here rather than through the full form.
                      It is the one thing about a machine that changes weekly. */}
                  <ConditionSelect
                    asset={asset}
                    canEdit={canEdit}
                    onChanged={(updated) => {
                      setAsset((current) => ({ ...current, ...updated }));
                      onChanged?.();
                    }}
                    onError={(message) => showToast(message, "error")}
                  />
                  <span className="badge badge-slate badge-soft">{asset.criticality}</span>
                </div>
                <h2 className="mt-1 text-lg font-bold tracking-tight text-slate-900 text-balance">
                  {asset.name}
                </h2>
                <p className="text-xs text-slate-500">
                  {asset.plant}
                  {asset.area ? ` · ${asset.area}` : ""}
                  {asset.type ? ` · ${asset.type}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-1">
                {canEdit && (
                  <button className="btn btn-sm btn-neutral" onClick={() => onEdit(asset)}>
                    <Pencil className="h-3.5 w-3.5" />
                    Edit
                  </button>
                )}
                <button className="modal-close" onClick={onClose} aria-label="Close">
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="px-6 pb-10 space-y-5 pt-5">
              <Files
                asset={asset}
                canEdit={canAttach}
                uploading={uploading}
                fileInput={fileInput}
                onUpload={upload}
                onRemove={remove}
              />

              <Block title="The nameplate">
                <KV label="Make" value={asset.make} />
                <KV label="Model" value={asset.model} />
                <KV label="Serial number" value={asset.serialNo} />
                <KV label="Year made" value={asset.yearMade} />
                <KV label="Capacity" value={asset.capacity} />
                <KV label="Motor" value={asset.motorKw ? `${asset.motorKw} kW` : ""} />
                <KV label="Commissioned" value={when(asset.commissionedOn)} />
              </Block>

              <Block title="How hard it works">
                <KV label="Shifts per day" value={asset.shiftsPerDay || ""} />
                <KV
                  label="Running hours per day"
                  value={asset.runningHoursPerDay ? `${asset.runningHoursPerDay} hr` : ""}
                />
                {/* What it makes in an hour, not what an hour costs. A rupee
                    figure used to sit here; it rested on a rate nobody had
                    agreed and could not be checked against anything. */}
                <KV
                  label="Output per hour"
                  value={
                    asset.outputPerHour
                      ? `${Number(asset.outputPerHour).toLocaleString("en-IN")} ${asset.outputUom || ""}`.trim()
                      : ""
                  }
                />
                <KV label="Standby available" value={asset.standbyAvailable ? "Yes" : "No"} />
                <KV
                  label="Stops the whole plant"
                  value={asset.stopsWholePlant ? "Yes" : "No"}
                />
                <KV label="Needs" value={asset.utilities?.join(", ")} />
              </Block>

              <MachineHistory machineId={asset.code} />

              {/* What is being done about all that, kept apart from the
                  history above it. The history is what the machine keeps
                  doing; this is what anybody has done about it, and it was
                  invisible while every prevention action lived a click deep
                  inside an individual breakdown. */}
              <MachinePrevention machineId={asset.code} canEdit={canEdit} />

              <Block title="Looking after it">
                <KV label="Maintained by" value={asset.maintainedBy} />
                <KV label="Supplier contact" value={asset.supplierContact} />
                <KV
                  label="Statutory inspection"
                  value={
                    asset.statutoryInspection
                      ? `Yes${asset.statutoryDueDate ? ` · due ${when(asset.statutoryDueDate)}` : ""}`
                      : "No"
                  }
                />
                <KV label="Recurring problems" value={asset.recurringProblems} wide />
                <KV label="Notes" value={asset.notes} wide />
              </Block>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

/**
 * Drawings, manuals, spec sheets.
 *
 * Put first, above the specifications, because it is the reason somebody opens
 * a machine's page at all — the fields below are mostly filled in once and read
 * rarely, and the manual is what gets looked for under pressure.
 */
const Files = ({ asset, canEdit, uploading, fileInput, onUpload, onRemove }) => (
  <div className="card p-5">
    <div className="flex items-center justify-between mb-3">
      <div>
        <h3 className="section-title">
          <Paperclip className="inline h-4 w-4 mr-1.5" />
          Drawings, manuals and specifications
        </h3>
        <p className="panel-sub">
          Anything that came with the machine — including the document listing its components.
        </p>
      </div>
      {canEdit && (
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

    {asset.files.length === 0 ? (
      <div className="empty-inline">
        <p className="empty-sub">
          Nothing attached yet. Start with the component document — a drawing in a drawer in the
          office is a drawing nobody has at two in the morning.
        </p>
      </div>
    ) : (
      <ul className="divide-y divide-slate-100">
        {asset.files.map((f) => (
          <li key={f.id} className="flex items-center gap-3 py-2.5">
            <span className="text-slate-400 shrink-0">
              {isImage(f.fileName) ? (
                <ImageIcon className="h-4 w-4" />
              ) : (
                <FileText className="h-4 w-4" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-slate-800 truncate">{f.fileName}</p>
              <p className="text-xs text-slate-500">
                {size(f.size)}
                {f.addedAt ? ` · added ${when(f.addedAt)}` : ""}
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
            {canEdit && (
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

export default AssetDetail;
