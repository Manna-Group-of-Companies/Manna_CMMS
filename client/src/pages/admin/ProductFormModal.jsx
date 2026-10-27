import { useEffect, useMemo, useRef, useState } from "react";
import API from "../../services/api";
import { useNotifications } from "../../context/NotificationContext";
import { Loader2, X, Boxes, Lock, RotateCcw, Hash } from "lucide-react";
import TaxonomySelect, {
  useSubCategoryOptions,
  useSubCategoryBOptions,
} from "../../components/TaxonomySelect";
import ItemNameBuilder, { EMPTY_NAMING, isNamingBlank } from "../../components/ItemNameBuilder";
import { useFormDraft, describeWhen } from "../../hooks/useFormDraft";
import Select from "../../components/Select";

/**
 * Add or edit an engineering item - as a SAP item master record.
 *
 * Since 25 Sep 2026 the catalog is SAP's, so the form is SAP's item master:
 *
 *   SAP field            here
 *   (company database)   SAP company
 *   ItemsGroupCode       Item group            (that company's engineering groups)
 *   U_SubTypeA / B       Sub-category A / B
 *   ItemName             Description
 *   ForeignName          Foreign name
 *   Inventory/Purchasing/Sales UoM   Unit      (one unit, as SAP is used here)
 *   ChapterID            HSN code              (shown on edit; set by the goods receipt)
 *   U_TaxRate            Tax rate              (shown on edit; set by the goods receipt)
 *   MinInventory         Minimum stock         (also the CMMS low-stock limit)
 *   -                    Brand                 (the CMMS's own)
 *   -                    Opening quantity      (add only: stock on the shelf with no bill)
 *
 * Since 9 Oct 2026 there is no approval: adding saves the item approved and
 * queues it for the SAP server, which creates it in SAP with the company's next
 * item code (and then in ERPNext) within about a minute.
 *
 * Neither form asks for HSN or tax rate: they belong to a bill, and the item's
 * first goods receipt is what fills them in (adding since 13 Oct 2026, editing
 * since 27 Oct 2026 - once an item has them they are not changed). The edit
 * form shows them. An edit saves at once; the name, item group, sub-categories,
 * foreign name and minimum stock reach SAP.
 * The item code, company and unit are fixed once an item exists (SAP refuses a
 * new inventory unit after the first transaction).
 */

const EMPTY = {
  company: "",
  itemGroup: "",
  subCategory: "",
  subCategoryB: "",
  name: "",
  foreignName: "",
  unit: "NOS",
  hsnCode: "",
  taxRate: "",
  minStock: 0,
  brand: "",
  openingQty: "",
};

/** SAP limits. */
const NAME_MAX = 100;
const SUB_MAX = 50;

/** The company's "Engineering Stocks" item group in SAP - where every item goes. */
const engineeringGroupOf = (company) =>
  company?.groups.find((g) => g.name.trim().toLowerCase() === "engineering stocks")?.name || "";

/** Only a form with something typed into it is worth keeping as a draft. */
const isWorthKeeping = ({ form } = {}) =>
  Boolean(form && (form.name || form.foreignName || form.brand || form.subCategory));

const ProductFormModal = ({ product, onClose, onSaved }) => {
  const { showToast } = useNotifications();
  const isEdit = Boolean(product);
  const notSap = isEdit && !product.sapCategory;

  const [form, setForm] = useState(EMPTY);
  const [companies, setCompanies] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [problem, setProblem] = useState("");
  const [naming, setNaming] = useState(EMPTY_NAMING);
  const [showBuilder, setShowBuilder] = useState(true);

  // The half-finished add form survives a close; an edit never restores a draft.
  const draft = useFormDraft("add-engineering-stock-sap", { enabled: !isEdit, isWorthKeeping });
  const savedDraft = draft.restored;
  const { save: saveDraft, saveNow: saveDraftNow, clear: clearDraft } = draft;
  const [restoredFrom, setRestoredFrom] = useState(null);

  const company = useMemo(
    () => (companies || []).find((c) => c.abbr === form.company) || null,
    [companies, form.company]
  );
  // Every engineering item lives in the company's "Engineering Stocks" item
  // group, so the group is no longer asked for: an item being edited keeps
  // the group it has, and a new one takes Engineering Stocks.
  const itemGroup = form.itemGroup || engineeringGroupOf(company);
  const group = company?.groups.find((g) => g.name === itemGroup) || null;
  const subOptions = useSubCategoryOptions(itemGroup);
  const subBOptions = useSubCategoryBOptions(itemGroup, form.subCategory);

  // The SAP lists, per company.
  useEffect(() => {
    API.get("/naming-requests/options")
      .then(({ data }) => setCompanies(Array.isArray(data) ? data : []))
      .catch((e) => setLoadError(e.response?.data?.message || "Could not load the SAP lists."));
  }, []);

  // Fill the form: from the item on an edit, from a draft or blank on an add.
  useEffect(() => {
    if (product) {
      setForm({
        company: product.sapCategory?.company || "",
        itemGroup: product.sapCategory?.group || product.category || "",
        subCategory: product.subCategory || "",
        subCategoryB: product.subCategoryB || "",
        name: product.name || "",
        foreignName: product.foreignName || "",
        unit: product.unit || "",
        hsnCode: product.hsnCode || "",
        taxRate: product.taxRate || "",
        minStock: product.minStock ?? 0,
        brand: product.brand || "",
      });
    } else if (savedDraft?.form) {
      setForm({ ...EMPTY, ...savedDraft.form });
      setRestoredFrom(savedDraft.savedAt || null);
    }
  }, [product, savedDraft]);

  // One company in the list? Pick it.
  useEffect(() => {
    if (!isEdit && companies?.length === 1 && !form.company) setForm((f) => ({ ...f, company: companies[0].abbr }));
  }, [companies, isEdit, form.company]);

  const latest = useRef({ form });
  latest.current = { form };
  const finished = useRef(false);
  useEffect(() => {
    if (!isEdit) saveDraft({ form });
  }, [form, isEdit, saveDraft]);
  useEffect(
    () => () => {
      if (!isEdit && !finished.current) saveDraftNow(latest.current);
    },
    [isEdit, saveDraftNow]
  );

  const startFresh = () => {
    clearDraft();
    setRestoredFrom(null);
    setForm(EMPTY);
    setProblem("");
  };

  const set = (field, value) =>
    setForm((prev) => {
      const next = { ...prev, [field]: value };
      // A lower level only makes sense under the level above it.
      if (field === "company") {
        next.itemGroup = "";
        next.subCategory = "";
        next.subCategoryB = "";
        next.hsnCode = "";
      }
      if (field === "itemGroup") {
        next.subCategory = "";
        next.subCategoryB = "";
      }
      if (field === "subCategory") next.subCategoryB = "";
      return next;
    });
  const bind = (field) => (e) => set(field, e.target.value);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setProblem("");
    if (!form.company) return setProblem("Choose the SAP company.");
    if (!itemGroup) return setProblem("This company has no Engineering Stocks item group in SAP.");
    if (!form.name.trim()) return setProblem("Type the description.");
    if (form.name.trim().length > NAME_MAX) return setProblem(`The description can be at most ${NAME_MAX} characters - SAP's limit.`);
    if (form.subCategoryB && !form.subCategory) return setProblem("Sub-category B needs a Sub-category A above it.");
    if (!form.unit) return setProblem("Choose the unit.");
    const openingQty = form.openingQty === "" ? 0 : Number(form.openingQty);
    if (!isEdit && (!Number.isFinite(openingQty) || openingQty < 0)) return setProblem("The opening quantity must be zero or more.");

    const payload = {
      itemGroup,
      subCategory: form.subCategory,
      subCategoryB: form.subCategoryB,
      foreignName: form.foreignName,
      // No HSN or tax rate, on either form: a draft saved before they went may still carry them, and only the goods
      // receipt sets them now.
      minStock: Number(form.minStock) || 0,
      brand: form.brand,
    };

    try {
      setSubmitting(true);
      if (isEdit) {
        await API.put(`/products/${encodeURIComponent(product.code)}`, {
          ...payload,
          category: itemGroup,
          name: form.name.trim(),
        });
        showToast("Saved. The changes are sent to SAP by the item master sync.", "success");
      } else {
        await API.post("/naming-requests", {
          ...payload,
          company: form.company,
          unit: form.unit,
          proposedName: form.name.trim(),
          openingQty,
          ...(isNamingBlank(naming) ? {} : { naming }),
        });
        finished.current = true;
        clearDraft();
        showToast("Saved. SAP creates it within a minute; it appears in Engineering Stock once SAP gives it a code.", "success");
      }
      onSaved?.();
      onClose();
    } catch (error) {
      setProblem(error.response?.data?.message || "Could not save.");
    } finally {
      setSubmitting(false);
    }
  };

  const label = "field-label";
  const locked = isEdit;

  return (
    <div className="modal max-w-2xl">
      <div className="modal-head">
        <h3 className="modal-title truncate">
          <Boxes className="h-[18px] w-[18px] text-brand-700 shrink-0" />
          <span className="truncate">{isEdit ? `Edit ${product.name}` : "New engineering item"}</span>
        </h3>
        <button onClick={onClose} className="modal-close" aria-label="Close">
          <X className="h-5 w-5" />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="contents">
        <div className="modal-body space-y-4">
          {restoredFrom && (
            <div className="note note-brand items-center justify-between">
              <span className="flex items-center gap-2">
                <RotateCcw className="h-4 w-4 shrink-0" />
                Picked up where you left off, saved {describeWhen(restoredFrom)}.
              </span>
              <button type="button" onClick={startFresh} className="shrink-0 font-semibold underline underline-offset-2 hover:no-underline cursor-pointer">
                Start fresh
              </button>
            </div>
          )}

          {notSap && (
            <div className="note note-amber text-sm">
              This item is not in SAP, so it cannot be edited here. Items are created and edited as SAP items now.
            </div>
          )}

          {loadError && <div className="note note-rose text-sm">{loadError}</div>}
          {!companies && !loadError && (
            <div className="flex items-center gap-2 text-slate-500 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading SAP lists…
            </div>
          )}

          {companies && !notSap && (
            <>
              {/* --- where it lives in SAP --- */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={label} htmlFor="sap-company">SAP company *</label>
                  {locked ? (
                    <LockedValue value={company ? `${company.company} (${company.sapDb})` : form.company} />
                  ) : (
                    <Select
                      id="sap-company"
                      value={form.company}
                      onChange={bind("company")}
                      options={companies.map((c) => ({ value: c.abbr, label: c.company }))}
                      placeholder="Choose…"
                      required
                    />
                  )}
                </div>
                <div>
                  <label className={label} htmlFor="sap-sub-a">Sub-category A</label>
                  <TaxonomySelect id="sap-sub-a" value={form.subCategory} options={subOptions} onChange={(v) => set("subCategory", v.slice(0, SUB_MAX))} placeholder="None" disabled={!itemGroup} />
                </div>
                <div>
                  <label className={label} htmlFor="sap-sub-b">Sub-category B</label>
                  <TaxonomySelect id="sap-sub-b" value={form.subCategoryB} options={subBOptions} onChange={(v) => set("subCategoryB", v.slice(0, SUB_MAX))} placeholder="None" disabled={!form.subCategory} />
                </div>
              </div>

              {/* --- the item code --- */}
              <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[13px] text-slate-700">
                <Hash className="h-4 w-4 text-slate-400 shrink-0" />
                {isEdit ? (
                  <span>
                    Item code{" "}
                    <span className="mono text-brand-700">{product.sap?.code || "not assigned yet"}</span>
                  </span>
                ) : group ? (
                  group.automatic ? (
                    <span>Item code: assigned by SAP</span>
                  ) : (
                    <span>
                      Item code <span className="mono font-semibold text-brand-700">{group.nextCode}</span>
                    </span>
                  )
                ) : (
                  <span className="text-slate-500">Item code: choose the company</span>
                )}
              </div>

              {/* --- SOP name builder (add only) --- */}
              {!isEdit && (
                <>
                  <div>
                    <button
                      type="button"
                      onClick={() => setShowBuilder((v) => !v)}
                      className="px-3 py-1.5 text-xs font-semibold rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 cursor-pointer"
                    >
                      {showBuilder ? "Hide" : "Show"} standard name builder (SOI1/SOP1)
                    </button>
                  </div>
                  {showBuilder && (
                    <ItemNameBuilder
                      value={naming}
                      onChange={setNaming}
                      onApply={(name) => set("name", name)}
                    />
                  )}
                </>
              )}

              {/* --- description --- */}
              <div className="space-y-2">
                <label className={label} htmlFor="sap-name">Description *</label>
                <input id="sap-name" className="field" value={form.name} onChange={bind("name")} maxLength={NAME_MAX} required />
                {/* The count stays: it is the one thing here that is not a
                    description but a limit, and SAP rejects the save over it. */}
                <div className="flex justify-end">
                  <span className="text-[11px] text-slate-400 shrink-0">{form.name.length}/{NAME_MAX}</span>
                </div>
              </div>

              {/* --- the rest of the item master --- */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label className={label} htmlFor="sap-foreign">
                    Foreign name
                  </label>
                  <input id="sap-foreign" className="field" value={form.foreignName} onChange={bind("foreignName")} maxLength={NAME_MAX} />
                </div>
                <div>
                  <label className={label} htmlFor="sap-unit">Unit *</label>
                  {locked ? (
                    <LockedValue value={form.unit} note="Fixed once the item exists" />
                  ) : (
                    <Select
                      id="sap-unit"
                      value={form.unit}
                      onChange={bind("unit")}
                      disabled={!company}
                      options={company?.units || [form.unit]}
                      required
                    />
                  )}
                </div>
                {/*
                  HSN and tax rate come off a bill: the goods receipt is the one
                  place they are entered, and only for an item without them
                  (27 Oct 2026). Shown here, not editable.
                */}
                {isEdit && (
                  <>
                    <div>
                      <span className={label}>HSN code</span>
                      <p className="field mono bg-slate-50 text-slate-600" aria-readonly="true">
                        {form.hsnCode || "None yet - set by the first goods receipt"}
                      </p>
                    </div>
                    <div>
                      <span className={label}>Tax rate</span>
                      <p className="field bg-slate-50 text-slate-600" aria-readonly="true">
                        {form.taxRate || "None yet - set by the first goods receipt"}
                      </p>
                    </div>
                  </>
                )}
                <div>
                  <label className={label} htmlFor="sap-min">
                    Minimum stock
                  </label>
                  <input id="sap-min" type="number" min="0" step="any" className="field" value={form.minStock} onChange={bind("minStock")} />
                </div>
                {!isEdit && (
                  <div>
                    <label className={label} htmlFor="sap-opening">Opening quantity</label>
                    <input id="sap-opening" type="number" min="0" step="any" className="field" value={form.openingQty} onChange={bind("openingQty")} />
                  </div>
                )}
                <div className="sm:col-span-2">
                  <label className={label} htmlFor="sap-brand">Brand</label>
                  <input id="sap-brand" className="field" value={form.brand} onChange={bind("brand")} />
                </div>
              </div>
            </>
          )}

          {problem && <div className="note note-rose text-sm">{problem}</div>}
        </div>

        <div className="modal-foot">
          <button type="button" onClick={onClose} className="btn btn-neutral">
            Cancel
          </button>
          <button type="submit" disabled={submitting || !companies || notSap} className="btn btn-primary">
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {isEdit ? "Save" : "Add item"}
          </button>
        </div>
      </form>
    </div>
  );
};

const LockedValue = ({ value, note = "" }) => (
  <div className="field flex items-center gap-2 bg-slate-50 text-slate-600 cursor-not-allowed" title={note}>
    <Lock className="h-3.5 w-3.5 text-slate-400 shrink-0" />
    <span className="truncate">{value || "—"}</span>
  </div>
);

export default ProductFormModal;
