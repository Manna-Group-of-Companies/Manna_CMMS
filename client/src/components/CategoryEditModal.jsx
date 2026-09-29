import { useEffect, useState } from "react";
import API from "../services/api";
import { useNotifications } from "../context/NotificationContext";
import TaxonomySelect, {
  useSubCategoryOptions,
  useSubCategoryBOptions,
} from "./TaxonomySelect";
import CategorySyncNote from "./CategorySyncNote";
import { FolderTree, Loader2, X } from "lucide-react";

/**
 * Re-files one SAP-mirrored item: SAP item group > Sub-category A > Sub-category B.
 *
 * Saved in ERPNext straight away; SAP follows through the flagged category sync
 * on the SAP server (ItemsGroupCode, U_SubTypeA, U_SubTypeB). Level 1 offers
 * only the engineering item groups of the item's own SAP company - a new group
 * is created in the SAP client, not here. Levels 2 and 3 can be typed.
 */
const CategoryEditModal = ({ product, onClose, onSaved }) => {
  const { showToast } = useNotifications();
  const [options, setOptions] = useState(null);
  const [form, setForm] = useState({
    category: product.category || "",
    subCategory: product.subCategory || "",
    subCategoryB: product.subCategoryB || "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const subOptions = useSubCategoryOptions(form.category);
  const subBOptions = useSubCategoryBOptions(form.category, form.subCategory);

  useEffect(() => {
    let live = true;
    API.get(`/products/${encodeURIComponent(product.code)}/category-options`)
      .then(({ data }) => {
        if (!live) return;
        setOptions(data);
        // Level 1 as SAP spells the group for this company.
        const exact = (data.groups || []).find(
          (g) => g.toLowerCase() === String(product.category || "").toLowerCase()
        );
        if (exact) setForm((f) => ({ ...f, category: exact }));
      })
      .catch((e) => live && setError(e.response?.data?.message || "Could not load this item's SAP category."));
    return () => {
      live = false;
    };
  }, [product.code, product.category]);

  const set = (key, value) =>
    setForm((f) => {
      const next = { ...f, [key]: value };
      // A lower level only makes sense under the level above it.
      if (key === "category") {
        next.subCategory = "";
        next.subCategoryB = "";
      }
      if (key === "subCategory") next.subCategoryB = "";
      return next;
    });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (form.subCategoryB && !form.subCategory) {
      setError("Sub-category B needs a Sub-category A above it.");
      return;
    }
    try {
      setSaving(true);
      await API.put(`/products/${encodeURIComponent(product.code)}/category`, form);
      showToast("Category saved. SAP is updated by the category sync.", "success");
      onSaved?.();
      onClose();
    } catch (err) {
      setError(err.response?.data?.message || "Could not save the category.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal max-w-lg">
      <div className="modal-head">
        <h3 className="modal-title truncate">
          <FolderTree className="h-[18px] w-[18px] text-brand-700 shrink-0" />
          <span className="truncate">Category of {product.name}</span>
        </h3>
        <button onClick={onClose} className="modal-close" aria-label="Close">
          <X className="h-5 w-5" />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="contents">
        <div className="modal-body space-y-4">
          <div className="text-[13px] text-slate-600">
            <span className="mono text-brand-700">{product.code}</span>
            {options && (
              <>
                {" "}
                · SAP {options.sapDb} · {options.company}
              </>
            )}
          </div>

          <CategorySyncNote compact />

          {!options && !error && (
            <div className="flex items-center gap-2 text-slate-500 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          )}

          {options && (
            <>
              <div>
                <label className="field-label" htmlFor="cat-l1">
                  Item group <span className="text-slate-400 font-normal">(SAP item group)</span>
                </label>
                <select
                  id="cat-l1"
                  value={form.category}
                  onChange={(e) => set("category", e.target.value)}
                  className="field cursor-pointer"
                  required
                >
                  {options.groups.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-[11px] text-slate-500">
                  Only {options.company}'s engineering groups. A new item group is created in the SAP client.
                </p>
              </div>

              <div>
                <label className="field-label" htmlFor="cat-l2">
                  Sub-category A <span className="text-slate-400 font-normal">(SAP SubTypeA)</span>
                </label>
                <TaxonomySelect
                  id="cat-l2"
                  value={form.subCategory}
                  options={subOptions}
                  onChange={(v) => set("subCategory", v.slice(0, 50))}
                  placeholder="None"
                />
              </div>

              <div>
                <label className="field-label" htmlFor="cat-l3">
                  Sub-category B <span className="text-slate-400 font-normal">(SAP SubTypeB)</span>
                </label>
                <TaxonomySelect
                  id="cat-l3"
                  value={form.subCategoryB}
                  options={subBOptions}
                  onChange={(v) => set("subCategoryB", v.slice(0, 50))}
                  placeholder="None"
                  disabled={!form.subCategory}
                />
              </div>
            </>
          )}

          {error && <div className="note note-rose text-sm">{error}</div>}
        </div>

        <div className="modal-foot">
          <button type="button" onClick={onClose} className="btn btn-neutral">
            Cancel
          </button>
          <button type="submit" disabled={saving || !options} className="btn btn-primary">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Save
          </button>
        </div>
      </form>
    </div>
  );
};

export default CategoryEditModal;
