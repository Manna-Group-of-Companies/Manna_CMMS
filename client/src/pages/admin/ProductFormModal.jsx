import { useEffect, useRef, useState } from "react";
import API from "../../services/api";
import { useNotifications } from "../../context/NotificationContext";
import { Loader2, X, Boxes, Lock, ShieldAlert, RotateCcw } from "lucide-react";
import { COMMON_STATUSES } from "../../utils/productStatus";
import ItemNameBuilder, {
  NameComplianceNotice,
  EMPTY_NAMING,
  isNamingBlank,
} from "../../components/ItemNameBuilder";
import DuplicateWarning, { useDuplicateCheck } from "../../components/DuplicateWarning";
import TaxonomySelect, {
  useCategoryOptions,
  useSubCategoryOptions,
} from "../../components/TaxonomySelect";
import { AUDIT_FREQUENCIES } from "../../utils/audit";
import { useFormDraft, describeWhen } from "../../hooks/useFormDraft";

const EMPTY = {
  code: "",
  name: "",
  category: "",
  subCategory: "",
  plant: "",
  brand: "",
  status: "Good Condition",
  rackNumber: "",
  quantity: 0,
  unit: "Nos",
  minStock: 5,
  unitCost: 0,
  auditFrequency: "Monthly",
  storeRoom: "",
  description: "",
  image: "",
  reason: "",
};

/**
 * Whether what has been typed is worth keeping as a draft.
 *
 * The form starts with real defaults — Pcs, a minimum of 5, Monthly audit, and
 * a company filled in from the list — so "anything differs from EMPTY" would
 * call an untouched form a draft and offer to restore it forever. Only the
 * fields a person actually fills in count.
 */
const isWorthKeeping = ({ form, naming } = {}) => {
  if (!form) return false;
  const typed = ["name", "brand", "category", "subCategory", "rackNumber", "description"];
  if (typed.some((f) => String(form[f] || "").trim())) return true;
  if (String(form.reason || "").trim()) return true;
  return !isNamingBlank(naming || EMPTY_NAMING);
};

/**
 * Create or edit a product directly, as an Admin.
 *
 * Supervisors change the catalog by raising ADD/EDIT requests; this is the
 * Admin's direct path.
 *
 * **Adding** asks for everything. **Editing** is deliberately narrow: only the
 * classification and the descriptive fields — category, sub-category, rack,
 * condition, image, description.
 *
 * The name is not among them. It is settled at intake and is what the catalog,
 * every issue record and the SAP hand-off refer to the item by, so it is shown
 * on an edit but never typed over. The SOI1/SOP1 builder is the intake tool for
 * arriving at it and is likewise not offered here.
 *
 * Everything else is read-only here because it has a proper home elsewhere:
 * quantity and company move real stock (Companies page), and code, unit,
 * min stock and cost are identity and purchasing figures that should not drift
 * from a form somebody opened to fix a shelf label.
 */
const ProductFormModal = ({ product, onClose, onSaved }) => {
  const { showToast } = useNotifications();
  const isEdit = Boolean(product);

  const [form, setForm] = useState(EMPTY);
  const [rooms, setRooms] = useState([]);
  const [units, setUnits] = useState({ inUse: [], others: [] });
  const [plants, setPlants] = useState([]);
  const [submitting, setSubmitting] = useState(false);

  // The SOI1/SOP1 fields the name is built from (ST-09). Kept beside the form
  // rather than inside it because they are saved as their own sub-document.
  const [naming, setNaming] = useState(EMPTY_NAMING);
  const [showBuilder, setShowBuilder] = useState(false);

  /**
   * The half-finished form, kept across a close.
   *
   * Intake only. On an edit there is a real record behind the form, and
   * restoring a draft over it would quietly put back values the user had
   * already decided against.
   */
  const draft = useFormDraft("add-engineering-stock", {
    enabled: !isEdit,
    isWorthKeeping,
  });
  const [restoredFrom, setRestoredFrom] = useState(null);

  // Read once when the form mounts and stable thereafter, so it can sit in the
  // dependency list below without the effect re-running and restoring over
  // whatever has been typed since.
  const savedDraft = draft.restored;

  // Pulled out because the hook returns a fresh object every render. Depending
  // on `draft` itself made the effects below tear down and re-run on each
  // render - which meant a synchronous localStorage write per keystroke, and a
  // debounce that was reset before it could ever fire. These three are
  // useCallback'd and stable.
  const { save: saveDraft, saveNow: saveDraftNow, clear: clearDraft } = draft;

  /**
   * What the server refused, and what the user has since confirmed.
   *
   * Both intake checks are advisory: the API answers 422 for a non-compliant
   * name and 409 for a possible duplicate, and re-accepts the same payload once
   * the matching flag is set. Holding the refusal here is what lets the form
   * show *why* and offer "save anyway" rather than just failing.
   */
  const [nameIssues, setNameIssues] = useState(null);
  const [duplicateBlock, setDuplicateBlock] = useState(null);
  const [acknowledgeNaming, setAcknowledgeNaming] = useState(false);
  const [allowDuplicate, setAllowDuplicate] = useState(false);

  // The classifications already in use, so the catalog stops accumulating
  // "Bearing" / "Bearings" / "BEARING" as three separate categories.
  const categoryOptions = useCategoryOptions();
  const subCategoryOptions = useSubCategoryOptions(form.category);

  // Live duplicate check while the name is typed (ST-14). Intake only: an edit
  // cannot change the name, so there is nothing here that could newly collide —
  // and reopening a product must not accuse it of duplicating itself.
  const { matches, checking: checkingDuplicates } = useDuplicateCheck({
    name: form.name,
    code: form.code,
    brand: form.brand,
    category: form.category,
    excludeId: product?._id || "",
    enabled: !isEdit,
  });

  useEffect(() => {
    if (product) {
      setForm({
        code: product.code || "",
        name: product.name || "",
        category: product.category || "",
        subCategory: product.subCategory || "",
        brand: product.brand || "",
        status: product.status || "",
        rackNumber: product.rackNumber || "",
        quantity: product.quantity ?? 0,
        unit: product.unit || "Pcs",
        minStock: product.minStock ?? 5,
        unitCost: product.unitCost ?? 0,
        auditFrequency: product.auditFrequency || "Monthly",
        storeRoom: product.storeRoom || "",
        description: product.description || "",
        image: product.image || "",
      });
    } else if (savedDraft?.form) {
      // Picked up where they left off. Announced rather than done silently —
      // a form that opens with text already in it looks like a bug when you
      // are not expecting it.
      setForm({ ...EMPTY, ...savedDraft.form });
      setNaming(savedDraft.naming || EMPTY_NAMING);
      setRestoredFrom(savedDraft.savedAt || null);
    } else {
      setForm(EMPTY);
    }

    // Nothing on an edit is built from these: the builder is not shown and the
    // name is not sent, so the sub-document is only ever assembled at intake.
    // A restored draft has already set them just above, so it is left alone.
    if (!savedDraft?.form) setNaming(EMPTY_NAMING);
    setShowBuilder(true);

    setNameIssues(null);
    setDuplicateBlock(null);
    setAcknowledgeNaming(false);
    setAllowDuplicate(false);
  }, [product, savedDraft]);

  useEffect(() => {
    const loadRooms = async () => {
      try {
        const { data } = await API.get("/stock-rooms");
        setRooms(data);
        // A new product needs a room; default to the first one on file.
        setForm((prev) => ({ ...prev, storeRoom: prev.storeRoom || data[0]?.name || "" }));
      } catch (error) {
        console.error("Error loading stock rooms:", error);
      }
    };
    loadRooms();

    // The units ERPNext actually holds. Typed free text reached the server as
    // "Pieces" and came back "Could not find Unit: Pieces" — `uom` is a Link
    // field, so it only accepts a name that exists.
    API.get("/products/units")
      .then(({ data }) => setUnits(data))
      .catch(() => setUnits({ inUse: [], others: [] }));

    // The sites, for "which plant wants this". `plant` is a Link to CMMS Plant
    // on the request, so it has to be picked rather than typed.
    API.get("/assets/plants")
      .then(({ data }) => setPlants(Array.isArray(data) ? data : []))
      .catch(() => setPlants([]));
  }, []);

  /**
   * The draft is written on a debounce while typing, and once more on the way
   * out.
   *
   * Saving on unmount rather than from an onClose handler is deliberate: the
   * form can be left by the X, by Cancel, by clicking the backdrop, or by the
   * page navigating away, and only unmount catches all of them. Wiring each
   * exit separately is how one of them ends up forgotten.
   */
  const latest = useRef({ form, naming });
  latest.current = { form, naming };

  // Set once the item is actually saved, so leaving does not immediately
  // write back a draft of something that no longer needs one.
  const finished = useRef(false);

  useEffect(() => {
    if (!isEdit) saveDraft({ form, naming });
  }, [form, naming, isEdit, saveDraft]);

  useEffect(
    () => () => {
      if (!isEdit && !finished.current) saveDraftNow(latest.current);
    },
    [isEdit, saveDraftNow]
  );

  /** Throws the draft away and puts the form back to a blank one. */
  const startFresh = () => {
    clearDraft();
    setRestoredFrom(null);
    setForm({ ...EMPTY, storeRoom: rooms[0]?.name || "" });
    setNaming(EMPTY_NAMING);
    setNameIssues(null);
    setDuplicateBlock(null);
    setAcknowledgeNaming(false);
    setAllowDuplicate(false);
  };

  const set = (field) => (e) => {
    setForm({ ...form, [field]: e.target.value });

    // Editing the name invalidates both confirmations — they were given about
    // a different name, and carrying them forward would let a fresh problem
    // through unremarked.
    if (field === "name") {
      setNameIssues(null);
      setDuplicateBlock(null);
      setAcknowledgeNaming(false);
      setAllowDuplicate(false);
    }
  };

  /** Applies a name built by the builder, and re-opens both checks on it. */
  const applyBuiltName = (name) => {
    setForm((prev) => ({ ...prev, name }));
    setNameIssues(null);
    setDuplicateBlock(null);
    setAcknowledgeNaming(false);
    setAllowDuplicate(false);
  };

  /**
   * Changing the main category invalidates the sub-category under it — "Ring
   * Spanners" is not a sub-category of "Bearings" — so it is cleared rather
   * than left pointing at the wrong parent.
   */
  const setCategory = (category) =>
    setForm((prev) => ({
      ...prev,
      category,
      subCategory: category === prev.category ? prev.subCategory : "",
    }));

  // The standard conditions, plus whatever this product already carries. A few
  // catalog rows use one-off phrasings ("BreakDown on High loads") that predate
  // the list; opening one in the form must not quietly rewrite it.
  const statusOptions =
    form.status && !COMMON_STATUSES.includes(form.status)
      ? [form.status, ...COMMON_STATUSES]
      : COMMON_STATUSES;

  // A pending refusal holds the save until it is answered, so the button never
  // re-sends a payload the API has already turned down.
  const awaitingConfirmation =
    (Boolean(nameIssues) && !acknowledgeNaming) ||
    (Boolean(duplicateBlock) && !allowDuplicate);

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!form.name.trim()) return showToast("Engineering Stock name is required", "error");
    if (!form.category.trim()) return showToast("Category is required", "error");
    if (!isEdit && !form.plant.trim()) {
      return showToast("Choose which plant this is for", "error");
    }

    if (!isEdit) {
      if (!form.unit.trim()) return showToast("A unit is required", "error");
    }

    try {
      setSubmitting(true);

      if (isEdit) {
        // Editing sends only what it is allowed to change. Posting the
        // untouched rest back would be harmless today — the API no-ops a zero
        // delta — but it invites a future field to be written by a form that
        // never offered it.
        //
        // The name is deliberately absent: the form does not let it be changed,
        // and echoing it back would put a legacy name through the convention on
        // a save that only meant to fix a shelf label.
        await API.put(`/products/${product._id}`, {
          category: form.category,
          subCategory: form.subCategory,
          rackNumber: form.rackNumber,
          status: form.status,
          image: form.image,
          description: form.description,
          acknowledgeNaming,
          allowDuplicate,
        });
        showToast(`"${form.name}" updated`, "success");
      } else {
        // Adding is a proposal now, not a creation. An item entering the
        // catalog is what every issue slip, every audit and eventually SAP
        // refers to the thing by, so a name goes in front of the Manager
        // before it becomes real.
        const { data } = await API.post("/naming-requests", {
          proposedName: form.name,
          naming: isNamingBlank(naming) ? null : naming,
          plant: form.plant,
          category: form.category,
          subCategory: form.subCategory,
          unit: form.unit,
          brand: form.brand,
          rackLocation: form.rackNumber,
          minStock: Number(form.minStock) || 0,
          description: form.description,
          reason: form.reason || "",
        });
        showToast(`${data.id} sent for approval`, "success");
      }

      finished.current = true;
      clearDraft();

      onSaved();
      onClose();
    } catch (error) {
      const refusal = error.response?.data;

      // 422 and 409 are not failures — they are the two intake checks asking
      // for confirmation (ST-10, ST-14). Show what was found and let the user
      // decide; the retry carries the matching override.
      if (error.response?.status === 422 && refusal?.code === "NAME_NOT_COMPLIANT") {
        setNameIssues(refusal.issues || []);
        showToast("Check the engineering stock name before saving", "error");
        return;
      }
      if (error.response?.status === 409 && refusal?.code === "POSSIBLE_DUPLICATE") {
        setDuplicateBlock(refusal);
        showToast(refusal.message || "This item may already exist", "error");
        return;
      }

      console.error(isEdit ? "Error saving product:" : "Error raising the request:", error);
      // The server's own message names the field or the link it refused, which
      // is more use than a generic failure. A message-less error is almost
      // always the request never leaving the browser.
      showToast(
        refusal?.message ||
          (isEdit
            ? "Failed to save engineering stock"
            : `Could not send it for approval: ${error.message}`),
        "error"
      );
    } finally {
      setSubmitting(false);
    }
  };

  const field = "field";
  const label = "field-label";

  return (
    <div className="modal max-w-2xl">
      <div className="modal-head">
        <h3 className="modal-title truncate">
          <Boxes className="h-[18px] w-[18px] text-brand-700 shrink-0" />
          <span className="truncate">
            {isEdit ? `Edit ${product.name}` : "Propose a new engineering item"}
          </span>
        </h3>
        <button onClick={onClose} className="modal-close" aria-label="Close">
          <X className="h-5 w-5" />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="contents">
        <div className="modal-body space-y-4">
        {/* Says plainly that the form was not blank when it opened, and offers
            the way out. Without this, a restored draft reads as the form
            having remembered something it should not have. */}
        {restoredFrom && (
          <div className="note note-brand items-center justify-between">
            <span className="flex items-center gap-2">
              <RotateCcw className="h-4 w-4 shrink-0" />
              Picked up where you left off, saved {describeWhen(restoredFrom)}.
            </span>
            <button
              type="button"
              onClick={startFresh}
              className="shrink-0 font-semibold underline underline-offset-2 hover:no-underline cursor-pointer"
            >
              Start fresh
            </button>
          </div>
        )}
        {/* Intake only. The naming convention comes first there, because the
            name it produces is what every other field on the form hangs off —
            but on an edit the name is already settled and not up for changing,
            so a builder would only offer something this form cannot apply. */}
        {!isEdit && (
          <>
            <div>
              <button
                type="button"
                onClick={() => setShowBuilder((open) => !open)}
                className="btn btn-sm btn-subtle"
              >
                {showBuilder ? "Hide" : "Show"} standard name builder (SOI1/SOP1)
              </button>
            </div>

            {showBuilder && (
              <ItemNameBuilder
                value={naming}
                onChange={setNaming}
                onApply={applyBuiltName}
                disabled={submitting}
              />
            )}
          </>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            {/* No asterisk on an edit: nothing is being asked for. */}
            <label className={label}>Engineering Stock Name{isEdit ? "" : " *"}</label>
            {isEdit ? (
              <>
                {/* Shown, never typed over. The name is how the catalog, the
                    issue history and SAP all refer to this item, so it is fixed
                    at intake rather than left open to a form somebody opened to
                    correct a rack number. */}
                <input
                  type="text"
                  value={form.name}
                  readOnly
                  className={`${field} bg-slate-50 text-slate-600 cursor-not-allowed`}
                />
                <p className="mt-1.5 text-[11px] text-slate-500">
                  Set when the item was taken in and not changed here.
                </p>
              </>
            ) : (
              <>
                <input
                  type="text"
                  value={form.name}
                  onChange={set("name")}
                  required
                  className={field}
                />
                {/* Only worth showing where it can be acted on — which, now that
                    the name is fixed once saved, is intake and nowhere else. */}
                <NameComplianceNotice name={form.name} />
              </>
            )}
          </div>

          {/*
            Which site wants the item.
            Add only: the queue had no way to say which company a pending name
            was for, so four plants' requests read as one undifferentiated
            list. Not shown on edit, because the catalog itself is group-wide -
            this records who asked, not where the stock lives.
          */}
          {!isEdit && (
            <div>
              <label className={label}>Plant *</label>
              <select
                value={form.plant}
                onChange={(e) => setForm((prev) => ({ ...prev, plant: e.target.value }))}
                className="field"
                disabled={submitting}
                required
              >
                <option value="">Select a plant…</option>
                {/* The docname, not the short code: `plant` is a Link to CMMS
                    Plant and a short code would be refused on save. */}
                {plants.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* --- the editable classification, on both add and edit --- */}
          <div>
            <label className={label}>Category *</label>
            <TaxonomySelect
              value={form.category}
              options={categoryOptions}
              onChange={setCategory}
              placeholder="Select a category…"
              disabled={submitting}
              required
            />
          </div>
          <div>
            <label className={label}>Sub-Category</label>
            <TaxonomySelect
              value={form.subCategory}
              options={subCategoryOptions}
              onChange={(subCategory) => setForm((prev) => ({ ...prev, subCategory }))}
              placeholder={form.category ? "Select a sub-category…" : "Pick a category first"}
              disabled={submitting || !form.category}
            />
          </div>
          <div>
            <label className={label}>Condition</label>
            <select
              value={form.status}
              onChange={set("status")}
              className={`${field} cursor-pointer`}
            >
              <option value="">Not recorded</option>
              {statusOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={label}>Rack Number</label>
            <input
              type="text"
              value={form.rackNumber}
              onChange={set("rackNumber")}
              placeholder="e.g. A-1"
              className={field}
            />
          </div>

          {/* --- asked for once, when the item is first taken in --- */}
          {!isEdit && (
            <>
              <div>
                <label className={label}>Brand</label>
                <input
                  type="text"
                  value={form.brand}
                  onChange={set("brand")}
                  placeholder="e.g. Taparia"
                  className={field}
                />
              </div>
              <div>
                <label className={label}>Unit *</label>
                <select
                  value={form.unit}
                  onChange={set("unit")}
                  required
                  className={`${field} cursor-pointer`}
                >
                  {/* The ones the store already uses first — the full ERPNext
                      list is mostly furlongs and troy ounces. */}
                  {units.inUse.length > 0 && (
                    <optgroup label="Used in this store">
                      {units.inUse.map((u) => (
                        <option key={u} value={u}>
                          {u}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {units.others.length > 0 && (
                    <optgroup label="Everything else">
                      {units.others.map((u) => (
                        <option key={u} value={u}>
                          {u}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {units.inUse.length === 0 && units.others.length === 0 && (
                    <option value={form.unit}>{form.unit}</option>
                  )}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className={label}>Why it is needed</label>
                <input
                  type="text"
                  value={form.reason}
                  onChange={set("reason")}
                  placeholder="e.g. arrived with the new press; the old one has no name"
                  className={field}
                />
              </div>
              <div>
                <label className={label}>Min Stock</label>
                <input
                  type="number"
                  min="0"
                  value={form.minStock}
                  onChange={set("minStock")}
                  className={field}
                />
              </div>
              <div>
                <label className={label}>Audit Frequency</label>
                <select
                  value={form.auditFrequency}
                  onChange={set("auditFrequency")}
                  className={field}
                >
                  {AUDIT_FREQUENCIES.map((frequency) => (
                    <option key={frequency} value={frequency}>
                      {frequency}
                    </option>
                  ))}
                </select>
                {/* Monthly is the default and the safe answer. Moving an item
                    to a longer cycle is a decision about how often it is worth
                    walking to, so it is said here rather than inferred from
                    how fast the item moves. */}
                <p className="mt-1 text-[10px] text-slate-500">
                  How often this item has to be physically counted.
                </p>
              </div>
            </>
          )}
        </div>

        <div>
          <label className={label}>Image URL</label>
          <input type="text" value={form.image} onChange={set("image")} placeholder="https://…" className={field} />
        </div>

        <div>
          <label className={label}>Description</label>
          <textarea
            value={form.description}
            onChange={set("description")}
            rows="3"
            className={`${field} field-area`}
          ></textarea>
        </div>

        {/* Still shown on edit, just not editable — the figures are needed to
            make sense of the item, and each says where it is actually changed. */}
        {isEdit && (
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
            <h4 className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
              <Lock className="h-3.5 w-3.5 text-slate-400" /> Not changed here
            </h4>
            <dl className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3">
              {[
                ["Engineering Stock Code", product.code, "fixed identity"],
                ["Brand", product.brand || "—", "raise a new item if it differs"],
                ["Unit", product.unit, "fixed identity"],
                [
                  "Total Quantity",
                  `${product.quantity} ${product.unit}`,
                  "moves on Companies",
                ],
                ["Home Company", product.storeRoom, "moves on Companies"],
                ["Min Stock", `${product.minStock} ${product.unit}`, "purchasing figure"],
              ].map(([term, value, why]) => (
                <div key={term} className="min-w-0">
                  <dt className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                    {term}
                  </dt>
                  <dd className="text-xs font-semibold text-slate-800 truncate" title={value}>
                    {value}
                  </dd>
                  <dd className="text-[10px] text-slate-400">{why}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}

        {/* ST-14 — what the catalog already holds that looks like this. Shown
            live while typing, and again (with the confirmation) if the save was
            refused. */}
        {!duplicateBlock && (
          <DuplicateWarning matches={matches} checking={checkingDuplicates} />
        )}

        {duplicateBlock && (
          <div className="space-y-2">
            <DuplicateWarning
              matches={duplicateBlock.matches || []}
              heading={duplicateBlock.message}
            />
            <label className="flex items-start gap-2 text-xs text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={allowDuplicate}
                onChange={(e) => setAllowDuplicate(e.target.checked)}
                className="mt-0.5 cursor-pointer"
              />
              <span>
                This is a <strong>different item</strong> from the ones above — create it
                anyway.
              </span>
            </label>
          </div>
        )}

        {/* ST-10 — a non-compliant name is flagged before it is saved, not
            silently accepted and not outright refused. */}
        {nameIssues && (
          <div className="space-y-2">
            <div className="note note-rose flex-col gap-1 items-start">
              <span className="font-bold flex items-center gap-1.5">
                <ShieldAlert className="h-4 w-4" /> "{form.name}" does not follow SOI1/SOP1
              </span>
              <ul className="list-disc pl-4 space-y-0.5">
                {nameIssues.map((issue) => (
                  <li key={issue.code + issue.message}>{issue.message}</li>
                ))}
              </ul>
            </div>
            <label className="flex items-start gap-2 text-xs text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={acknowledgeNaming}
                onChange={(e) => setAcknowledgeNaming(e.target.checked)}
                className="mt-0.5 cursor-pointer"
              />
              <span>
                Save with this name anyway — it will be marked{" "}
                <strong>non-compliant</strong> in the catalog.
              </span>
            </label>
          </div>
        )}

        </div>

        <div className="modal-foot">
          <button type="button" onClick={onClose} className="btn btn-neutral">
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting || awaitingConfirmation}
            className="btn btn-primary"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {isEdit ? "Save Changes" : "Send for approval"}
          </button>
        </div>
      </form>
    </div>
  );
};

export default ProductFormModal;
