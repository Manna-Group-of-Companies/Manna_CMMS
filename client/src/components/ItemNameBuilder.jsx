import { useCallback, useEffect, useRef, useState } from "react";
import API from "../services/api";
import { Plus, Trash2, Wand2, CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";

/**
 * The SOI1/SOP1 item naming convention, as a form (ST-09, ST-10).
 *
 * The rules themselves live on the server in `utils/itemNaming.js` and are
 * reached through `POST /products/name-preview`. Nothing here knows what a
 * valid name looks like — it collects the fields, asks, and shows the answer.
 * That is deliberate: three copies of a naming standard is three chances for
 * the store and the app to disagree about what an item is called.
 */

/** Offered as a datalist rather than a fixed list — the store meets new ones. */
const COMMON_UOMS = ["MM", "CM", "M", "”", "’", "SQMM", "KG", "G", "L", "NOS", "SET", "MTR"];
const ELECTRICAL_UOMS = ["V", "A", "W", "KW", "HP", "HZ", "MA", "KVA"];

export const EMPTY_NAMING = {
  dimensions: [{ value: "", uom: "" }],
  electricalRating: "",
  electricalUom: "",
  itemName: "",
  type: "",
  material: "",
  itemCode: "",
};

/** True when the parts hold nothing worth composing a name out of. */
export const isNamingBlank = (naming) =>
  !naming ||
  (!naming.itemName?.trim() &&
    !naming.itemCode?.trim() &&
    !naming.electricalRating?.trim() &&
    !(naming.dimensions || []).some((dimension) => dimension?.value?.trim()));

/** Fills the builder from a product that was saved with its naming fields. */
export const namingFromProduct = (product) => {
  const saved = product?.naming;
  if (!saved) return { ...EMPTY_NAMING, dimensions: [{ value: "", uom: "" }] };

  return {
    dimensions: saved.dimensions?.length
      ? saved.dimensions.map((d) => ({ value: d.value || "", uom: d.uom || "" }))
      : [{ value: "", uom: "" }],
    electricalRating: saved.electricalRating || "",
    electricalUom: saved.electricalUom || "",
    itemName: saved.itemName || "",
    type: saved.type || "",
    material: saved.material || "",
    itemCode: saved.itemCode || "",
  };
};

/**
 * Runs a name (or a set of naming fields) past the server and returns the
 * verdict, debounced so typing does not fire a request per keystroke.
 */
const useNameCheck = (payload, { enabled = true, delay = 400 } = {}) => {
  const [result, setResult] = useState(null);
  const [checking, setChecking] = useState(false);
  const serialized = JSON.stringify(payload);

  // Responses can land out of order once a slow request overtakes a fast one;
  // only the newest is allowed to set state.
  const latest = useRef(0);

  useEffect(() => {
    if (!enabled) {
      setResult(null);
      return undefined;
    }

    const ticket = ++latest.current;
    const timer = setTimeout(async () => {
      try {
        setChecking(true);
        const { data } = await API.post("/products/name-preview", JSON.parse(serialized));
        if (latest.current === ticket) setResult(data);
      } catch {
        // A failed preview must not block the form — the same check runs again
        // on save, where it can actually be acted on.
        if (latest.current === ticket) setResult(null);
      } finally {
        if (latest.current === ticket) setChecking(false);
      }
    }, delay);

    return () => clearTimeout(timer);
  }, [serialized, enabled, delay]);

  return { result, checking };
};

/**
 * The compliance readout for a name as it currently stands.
 *
 * Shown under the Product Name field. Silent while the field is empty — an
 * untouched form should not open covered in warnings.
 */
export const NameComplianceNotice = ({ name }) => {
  const trimmed = (name || "").trim();
  const { result, checking } = useNameCheck({ name: trimmed }, { enabled: trimmed.length > 1 });

  if (!trimmed || !result) {
    return checking ? (
      <p className="mt-1.5 text-[11px] text-slate-400 flex items-center gap-1">
        <Loader2 className="h-3 w-3 animate-spin" /> Checking the naming convention…
      </p>
    ) : null;
  }

  if (result.compliant) {
    return (
      <p className="mt-1.5 text-[11px] font-semibold text-emerald-700 flex items-center gap-1">
        <CheckCircle2 className="h-3.5 w-3.5" /> Follows the SOI1/SOP1 naming convention
      </p>
    );
  }

  return (
    <div className="note note-amber mt-2 flex-col gap-1 items-start">
      <span className="font-bold flex items-center gap-1.5">
        <AlertTriangle className="h-4 w-4" /> This name does not follow SOI1/SOP1
      </span>
      <ul className="list-disc pl-4 space-y-0.5">
        {result.issues.map((issue) => (
          <li key={issue.code + issue.message}>{issue.message}</li>
        ))}
      </ul>
      <span className="text-slate-500">
        You can still save it — the form will ask you to confirm.
      </span>
    </div>
  );
};

/**
 * Builds a standardized name out of its parts and hands it back to the form.
 *
 * The preview updates as the fields are filled in, so the person at the
 * counter watches the name assemble itself instead of being told after the
 * fact that it was wrong.
 */
const ItemNameBuilder = ({ value, onChange, onApply, disabled = false }) => {
  const naming = value || EMPTY_NAMING;
  const blank = isNamingBlank(naming);
  const { result, checking } = useNameCheck({ naming }, { enabled: !blank });

  const patch = useCallback(
    (changes) => onChange({ ...naming, ...changes }),
    [naming, onChange],
  );

  const setDimension = (index, changes) =>
    patch({
      dimensions: naming.dimensions.map((dimension, i) =>
        i === index ? { ...dimension, ...changes } : dimension,
      ),
    });

  const addDimension = () =>
    patch({ dimensions: [...naming.dimensions, { value: "", uom: "" }] });

  const removeDimension = (index) =>
    patch({
      // Always leave one row, so the section never collapses to nothing.
      dimensions:
        naming.dimensions.length > 1
          ? naming.dimensions.filter((_, i) => i !== index)
          : [{ value: "", uom: "" }],
    });

  const field = "field field-sm";
  const label = "field-label";

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-4">
      <datalist id="uom-options">
        {COMMON_UOMS.map((uom) => (
          <option key={uom} value={uom} />
        ))}
      </datalist>
      <datalist id="electrical-uom-options">
        {ELECTRICAL_UOMS.map((uom) => (
          <option key={uom} value={uom} />
        ))}
      </datalist>

      <div>
        <h4 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
          <Wand2 className="h-4 w-4 text-brand-700" /> Standard Name Builder
        </h4>
        <p className="text-[11px] text-slate-500 mt-0.5">
          Fill in what applies. Dimensions first, then rating, item name, type, material and
          item code — the name assembles itself below.
        </p>
      </div>

      {/* Dimensions — the only fields joined by "*", and only to each other. */}
      <div>
        <label className={label}>Dimensions</label>
        <div className="space-y-2">
          {naming.dimensions.map((dimension, index) => (
            <div key={index} className="flex items-center gap-2">
              <input
                type="text"
                value={dimension.value}
                onChange={(e) => setDimension(index, { value: e.target.value })}
                disabled={disabled}
                placeholder={index === 0 ? "e.g. 50" : "e.g. 10"}
                className={`${field} flex-1`}
              />
              <input
                type="text"
                list="uom-options"
                value={dimension.uom}
                onChange={(e) => setDimension(index, { uom: e.target.value })}
                disabled={disabled}
                placeholder="UOM"
                className={`${field} w-24 uppercase`}
              />
              <button
                type="button"
                onClick={() => removeDimension(index)}
                disabled={disabled}
                className="btn btn-sm btn-icon btn-neutral shrink-0"
                aria-label="Remove dimension"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={addDimension}
          disabled={disabled}
          className="btn btn-sm btn-subtle mt-2"
        >
          <Plus className="h-3.5 w-3.5" /> Add dimension
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className={label}>Electrical Rating</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={naming.electricalRating}
              onChange={(e) => patch({ electricalRating: e.target.value })}
              disabled={disabled}
              placeholder="e.g. 415"
              className={`${field} flex-1`}
            />
            <input
              type="text"
              list="electrical-uom-options"
              value={naming.electricalUom}
              onChange={(e) => patch({ electricalUom: e.target.value })}
              disabled={disabled}
              placeholder="V"
              className={`${field} w-20 uppercase`}
            />
          </div>
        </div>
        <div>
          <label className={label}>Item Name</label>
          <input
            type="text"
            value={naming.itemName}
            onChange={(e) => patch({ itemName: e.target.value })}
            disabled={disabled}
            placeholder="e.g. Bearing"
            className={field}
          />
        </div>
        <div>
          <label className={label}>Type</label>
          <input
            type="text"
            value={naming.type}
            onChange={(e) => patch({ type: e.target.value })}
            disabled={disabled}
            placeholder="e.g. Deep Groove"
            className={field}
          />
        </div>
        <div>
          <label className={label}>Material</label>
          <input
            type="text"
            value={naming.material}
            onChange={(e) => patch({ material: e.target.value })}
            disabled={disabled}
            placeholder="e.g. SS304"
            className={`${field} uppercase`}
          />
        </div>
        <div className="sm:col-span-2">
          <label className={label}>Item Code</label>
          <input
            type="text"
            value={naming.itemCode}
            onChange={(e) => patch({ itemCode: e.target.value })}
            disabled={disabled}
            placeholder="e.g. BS245SR61"
            className={`${field} uppercase`}
          />
        </div>
      </div>

      {/* The composed name */}
      <div className="rounded-lg border border-slate-200 bg-white p-3">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
            Standard name
          </span>
          {checking && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />}
        </div>
        <p
          className={`mt-1 text-sm font-bold break-words ${
            result?.name ? "text-slate-900" : "text-slate-400"
          }`}
        >
          {result?.name || "Fill in the fields above…"}
        </p>

        {result?.name && (
          <>
            {result.compliant ? (
              <p className="mt-2 text-[11px] font-semibold text-emerald-700 flex items-center gap-1">
                <CheckCircle2 className="h-3.5 w-3.5" /> Compliant with SOI1/SOP1
              </p>
            ) : (
              <ul className="mt-2 list-disc pl-4 space-y-0.5 text-[11px] text-amber-700">
                {result.issues.map((issue) => (
                  <li key={issue.code + issue.message}>{issue.message}</li>
                ))}
              </ul>
            )}

            <button
              type="button"
              onClick={() => onApply(result.name, result.naming)}
              disabled={disabled}
              className="btn btn-sm btn-primary mt-3"
            >
              <Wand2 className="h-3.5 w-3.5" /> Use this name
            </button>
          </>
        )}
      </div>
    </div>
  );
};

export default ItemNameBuilder;
