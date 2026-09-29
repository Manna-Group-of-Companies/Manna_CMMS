import { useEffect, useMemo, useRef, useState } from "react";
import API from "../../services/api";
import { useNotifications } from "../../context/NotificationContext";
import { Loader2, X, Boxes, Lock, RotateCcw, Hash } from "lucide-react";
import ItemNameBuilder, {
  NameComplianceNotice,
  EMPTY_NAMING,
  isNamingBlank,
} from "../../components/ItemNameBuilder";
import TaxonomySelect, {
  useSubCategoryOptions,
  useSubCategoryBOptions,
} from "../../components/TaxonomySelect";
import CategorySyncNote from "../../components/CategorySyncNote";
import { useFormDraft, describeWhen } from "../../hooks/useFormDraft";

/**
 * Add or edit an engineering item - as a SAP item master record.
 *
 * Since 25 Sep 2026 the catalog is SAP's, so the form is SAP's item master:
 *
 *   SAP field            here
 *   (company database)   SAP company
 *   ItemsGroupCode       Item group            (that company's engineering groups)
 *   U_SubTypeA / B       Sub-category A / B
 *   ItemName             Description           (built with the SOP naming builder)
 *   ForeignName          Foreign name
 *   Inventory/Purchasing/Sales UoM   Unit      (one unit, as SAP is used here)
 *   ChapterID            HSN code              (from that company's SAP HSN list)
 *   U_TaxRate            Tax rate
 *   MinInventory         Minimum stock         (also the CMMS low-stock limit)
 *   -                    Brand                 (the CMMS's own)
 *
 * Adding sends a request for the VP Operations to approve; on approval the SAP
 * server creates the item in SAP with the company's next item code and it
 * appears here. Editing saves at once and the same sync updates SAP. The item
 * code, company and unit are fixed once an item exists (SAP refuses a new
 * inventory unit after the first transaction).
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
  taxRate: "18%",
  minStock: 0,
  brand: "",
};

/** SAP limits. */
const NAME_MAX = 100;
const SUB_MAX = 50;

/** Only a form with something typed into it is worth keeping as a draft. */
const isWorthKeeping = ({ form, naming } = {}) =>
  Boolean(
    form &&
      (form.name || form.foreignName || form.brand || form.subCategory || form.hsnCode) ||
      (naming && !isNamingBlank(naming))
  );

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
  const [showBuilder, setShowBuilder] = useState(!isEdit);

  // The half-finished add form survives a close; an edit never restores a draft.
  const draft = useFormDraft("add-engineering-stock-sap", { enabled: !isEdit, isWorthKeeping });
  const savedDraft = draft.restored;
  const { save: saveDraft, saveNow: saveDraftNow, clear: clearDraft } = draft;
  const [restoredFrom, setRestoredFrom] = useState(null);

  const company = useMemo(
    () => (companies || []).find((c) => c.abbr === form.company) || null,
    [companies, form.company]
  );
  const group = company?.groups.find((g) => g.name === form.itemGroup) || null;
  const subOptions = useSubCategoryOptions(form.itemGroup);
  const subBOptions = useSubCategoryBOptions(form.itemGroup, form.subCategory);

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
      setNaming(savedDraft.naming || EMPTY_NAMING);
      setRestoredFrom(savedDraft.savedAt || null);
    }
  }, [product, savedDraft]);

  // One company in the list? Pick it.
  useEffect(() => {
    if (!isEdit && companies?.length === 1 && !form.company) setForm((f) => ({ ...f, company: companies[0].abbr }));
  }, [companies, isEdit, form.company]);

  const latest = useRef({ form, naming });
  latest.current = { form, naming };
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

  const startFresh = () => {
    clearDraft();
    setRestoredFrom(null);
    setForm(EMPTY);
    setNaming(EMPTY_NAMING);
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
    if (!form.itemGroup) return setProblem("Choose the item group.");
    if (!form.name.trim()) return setProblem("Build the description with the SOP naming builder (or type it).");
    if (form.name.trim().length > NAME_MAX) return setProblem(`The description can be at most ${NAME_MAX} characters - SAP's limit.`);
    if (form.subCategoryB && !form.subCategory) return setProblem("Sub-category B needs a Sub-category A above it.");
    if (!form.unit) return setProblem("Choose the unit.");

    const payload = {
      itemGroup: form.itemGroup,
      subCategory: form.subCategory,
      subCategoryB: form.subCategoryB,
      foreignName: form.foreignName,
      hsnCode: form.hsnCode,
      taxRate: form.taxRate,
      minStock: Number(form.minStock) || 0,
      brand: form.brand,
    };

    try {
      setSubmitting(true);
      if (isEdit) {
        await API.put(`/products/${encodeURIComponent(product.code)}`, {
          ...payload,
          category: form.itemGroup,
          name: form.name.trim(),
          ...(isNamingBlank(naming) ? {} : { naming }),
        });
        showToast("Saved. SAP is updated by the item master sync.", "success");
      } else {
        const { data } = await API.post("/naming-requests", {
          ...payload,
          company: form.company,
          unit: form.unit,
          proposedName: form.name.trim(),
          naming: isNamingBlank(naming) ? null : naming,
        });
        finished.current = true;
        clearDraft();
        showToast(`${data.id} sent to the VP Operations for approval`, "success");
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
  const hint = "mt-1 text-[11px] text-slate-500";
  const locked = isEdit;

  return (
    <div className="modal max-w-2xl">
      <div className="modal-head">
        <h3 className="modal-title truncate">
          <Boxes className="h-[18px] w-[18px] text-brand-700 shrink-0" />
          <span className="truncate">{isEdit ? `Edit ${product.name}` : "New engineering item (SAP item master)"}</span>
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

          {isEdit && !notSap && <CategorySyncNote compact />}
          {!isEdit && (
            <p className="text-[13px] text-slate-600">
              Goes to the VP Operations for approval. Once approved, the SAP server creates it in SAP with the next item
              code and it appears in the catalog.
            </p>
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
                    <select id="sap-company" className="field cursor-pointer" value={form.company} onChange={bind("company")} required>
                      <option value="">Choose…</option>
                      {companies.map((c) => (
                        <option key={c.abbr} value={c.abbr}>
                          {c.company}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                <div>
                  <label className={label} htmlFor="sap-group">Item group *</label>
                  <select
                    id="sap-group"
                    className="field cursor-pointer"
                    value={form.itemGroup}
                    onChange={bind("itemGroup")}
                    disabled={!company}
                    required
                  >
                    <option value="">{company ? "Choose…" : "Choose the company first"}</option>
                    {(company?.groups || []).map((g) => (
                      <option key={g.code} value={g.name}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={label} htmlFor="sap-sub-a">Sub-category A</label>
                  <TaxonomySelect id="sap-sub-a" value={form.subCategory} options={subOptions} onChange={(v) => set("subCategory", v.slice(0, SUB_MAX))} placeholder="None" disabled={!form.itemGroup} />
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
                    Item code <span className="mono text-brand-700">{product.sap?.code || product.code}</span> (SAP) · <span className="mono">{product.code}</span> here
                  </span>
                ) : group ? (
                  group.automatic ? (
                    <span>Item code: assigned by SAP's automatic numbering when the item is created.</span>
                  ) : (
                    <span>
                      Item code will be <span className="mono font-semibold text-brand-700">{group.nextCode}</span>, or the next free one - SAP confirms it when the item is created.
                    </span>
                  )
                ) : (
                  <span className="text-slate-500">The item code follows the company's SAP numbering once the group is chosen.</span>
                )}
              </div>

              {/* --- description: the SOP name --- */}
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <label className={label + " mb-0"} htmlFor="sap-name">Description * <span className="text-slate-400 font-normal">(SAP item description)</span></label>
                  <button type="button" className="text-[12px] font-semibold text-brand-700 hover:underline cursor-pointer" onClick={() => setShowBuilder((s) => !s)}>
                    {showBuilder ? "Hide the SOP naming builder" : "Build it with the SOP naming builder"}
                  </button>
                </div>
                {showBuilder && (
                  <ItemNameBuilder value={naming} onChange={setNaming} onApply={(name) => set("name", String(name || "").slice(0, NAME_MAX))} disabled={submitting} />
                )}
                <input id="sap-name" className="field" value={form.name} onChange={bind("name")} maxLength={NAME_MAX} placeholder="e.g. 50SQMM*10MM Cable Leg Ring Type CU" required />
                <div className="flex justify-between gap-2">
                  <NameComplianceNotice name={form.name} />
                  <span className="text-[11px] text-slate-400 shrink-0">{form.name.length}/{NAME_MAX}</span>
                </div>
              </div>

              {/* --- the rest of the item master --- */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label className={label} htmlFor="sap-foreign">Foreign name</label>
                  <input id="sap-foreign" className="field" value={form.foreignName} onChange={bind("foreignName")} maxLength={NAME_MAX} placeholder="Optional - a second name, e.g. the supplier's" />
                </div>
                <div>
                  <label className={label} htmlFor="sap-unit">Unit *</label>
                  {locked ? (
                    <LockedValue value={form.unit} note="Fixed once the item exists" />
                  ) : (
                    <select id="sap-unit" className="field cursor-pointer" value={form.unit} onChange={bind("unit")} disabled={!company} required>
                      {(company?.units || [form.unit]).map((u) => (
                        <option key={u} value={u}>
                          {u}
                        </option>
                      ))}
                    </select>
                  )}
                  {!locked && <p className={hint}>Inventory, purchasing and sales unit in SAP.</p>}
                </div>
                <div>
                  <label className={label} htmlFor="sap-hsn">HSN code</label>
                  <input
                    id="sap-hsn"
                    className="field mono"
                    list="sap-hsn-list"
                    value={form.hsnCode}
                    onChange={(e) => set("hsnCode", e.target.value.replace(/[^\d.]/g, ""))}
                    placeholder="e.g. 84819090"
                    disabled={!company}
                  />
                  <datalist id="sap-hsn-list">
                    {(company?.hsn || []).map((h) => (
                      <option key={h} value={h} />
                    ))}
                  </datalist>
                  <p className={hint}>From {company?.company || "the company"}'s HSN list in SAP.</p>
                </div>
                <div>
                  <label className={label} htmlFor="sap-tax">Tax rate</label>
                  <select id="sap-tax" className="field cursor-pointer" value={form.taxRate} onChange={bind("taxRate")} disabled={!company}>
                    <option value="">None</option>
                    {(company?.taxRates || []).map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={label} htmlFor="sap-min">Minimum stock</label>
                  <input id="sap-min" type="number" min="0" step="any" className="field" value={form.minStock} onChange={bind("minStock")} />
                  <p className={hint}>SAP's Minimum Inventory, and the low-stock limit here.</p>
                </div>
                <div className="sm:col-span-2">
                  <label className={label} htmlFor="sap-brand">Brand</label>
                  <input id="sap-brand" className="field" value={form.brand} onChange={bind("brand")} placeholder="Optional - kept in the CMMS only" />
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
            {isEdit ? "Save" : "Send for approval"}
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
