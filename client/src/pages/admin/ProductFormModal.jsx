import { useEffect, useState } from "react";
import API from "../../services/api";
import { useNotifications } from "../../context/NotificationContext";
import { Loader2, X, Boxes, AlertCircle, ShieldAlert } from "lucide-react";
import { COMMON_STATUSES } from "../../utils/productStatus";
import ItemNameBuilder, {
  NameComplianceNotice,
  EMPTY_NAMING,
  isNamingBlank,
  namingFromProduct,
} from "../../components/ItemNameBuilder";
import DuplicateWarning, { useDuplicateCheck } from "../../components/DuplicateWarning";

const EMPTY = {
  code: "",
  name: "",
  category: "",
  subCategory: "",
  brand: "",
  status: "Good Condition",
  rackNumber: "",
  quantity: 0,
  unit: "Pcs",
  minStock: 5,
  maxStock: 100,
  unitCost: 0,
  storeRoom: "",
  description: "",
  image: "",
};

/**
 * Create or edit a product directly, as an Admin.
 *
 * Supervisors change the catalog by raising ADD/EDIT requests; this is the
 * Admin's direct path. Quantity here is the product's **total** across every
 * room — the backend applies any change to the home room. Per-room figures
 * are moved on the Stock Rooms page instead.
 */
const ProductFormModal = ({ product, onClose, onSaved }) => {
  const { showToast } = useNotifications();
  const isEdit = Boolean(product);

  const [form, setForm] = useState(EMPTY);
  const [rooms, setRooms] = useState([]);
  const [submitting, setSubmitting] = useState(false);

  // The SOI1/SOP1 fields the name is built from (ST-09). Kept beside the form
  // rather than inside it because they are saved as their own sub-document.
  const [naming, setNaming] = useState(EMPTY_NAMING);
  const [showBuilder, setShowBuilder] = useState(false);

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

  // Live duplicate check while the name is typed (ST-14). Suppressed on edit
  // until the name actually changes — reopening a product should not accuse it
  // of duplicating itself.
  const { matches, checking: checkingDuplicates } = useDuplicateCheck({
    name: form.name,
    code: form.code,
    brand: form.brand,
    category: form.category,
    excludeId: product?._id || "",
    enabled: !isEdit || form.name !== product?.name,
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
        maxStock: product.maxStock ?? 100,
        unitCost: product.unitCost ?? 0,
        storeRoom: product.storeRoom || "",
        description: product.description || "",
        image: product.image || "",
      });
      setNaming(namingFromProduct(product));
      // Open the builder for a product that was named with it, so its parts
      // are visible rather than hidden behind a collapsed section.
      setShowBuilder(Boolean(product.naming));
    } else {
      setForm(EMPTY);
      setNaming(EMPTY_NAMING);
      setShowBuilder(true);
    }

    setNameIssues(null);
    setDuplicateBlock(null);
    setAcknowledgeNaming(false);
    setAllowDuplicate(false);
  }, [product]);

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
  }, []);

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

  // The standard conditions, plus whatever this product already carries. A few
  // catalog rows use one-off phrasings ("BreakDown on High loads") that predate
  // the list; opening one in the form must not quietly rewrite it.
  const statusOptions =
    form.status && !COMMON_STATUSES.includes(form.status)
      ? [form.status, ...COMMON_STATUSES]
      : COMMON_STATUSES;

  const roomChanged = isEdit && form.storeRoom !== product.storeRoom;
  const quantityChanged = isEdit && Number(form.quantity) !== product.quantity;

  // A pending refusal holds the save until it is answered, so the button never
  // re-sends a payload the API has already turned down.
  const awaitingConfirmation =
    (Boolean(nameIssues) && !acknowledgeNaming) ||
    (Boolean(duplicateBlock) && !allowDuplicate);

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!form.name.trim()) return showToast("Product name is required", "error");
    if (!form.category.trim()) return showToast("Category is required", "error");
    if (!form.storeRoom) return showToast("Select a store room", "error");

    const quantity = Number(form.quantity);
    if (!Number.isInteger(quantity) || quantity < 0) {
      return showToast("Quantity must be a whole number of 0 or more", "error");
    }

    try {
      setSubmitting(true);
      const payload = {
        ...form,
        quantity,
        minStock: Number(form.minStock),
        maxStock: Number(form.maxStock),
        unitCost: Number(form.unitCost) || 0,
        // Only sent when there is something to send. An empty sub-document
        // would overwrite the naming fields of a product created with them.
        ...(isNamingBlank(naming) ? {} : { naming }),
        acknowledgeNaming,
        allowDuplicate,
      };

      if (isEdit) {
        await API.put(`/products/${product._id}`, payload);
        showToast(`"${form.name}" updated`, "success");
      } else {
        await API.post("/products", payload);
        showToast(`"${form.name}" added to the catalog`, "success");
      }

      onSaved();
      onClose();
    } catch (error) {
      const refusal = error.response?.data;

      // 422 and 409 are not failures — they are the two intake checks asking
      // for confirmation (ST-10, ST-14). Show what was found and let the user
      // decide; the retry carries the matching override.
      if (error.response?.status === 422 && refusal?.code === "NAME_NOT_COMPLIANT") {
        setNameIssues(refusal.issues || []);
        showToast("Check the product name before saving", "error");
        return;
      }
      if (error.response?.status === 409 && refusal?.code === "POSSIBLE_DUPLICATE") {
        setDuplicateBlock(refusal);
        showToast(refusal.message || "This item may already exist", "error");
        return;
      }

      console.error("Error saving product:", error);
      showToast(refusal?.message || "Failed to save product", "error");
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
          <span className="truncate">{isEdit ? `Edit ${product.name}` : "Add Product"}</span>
        </h3>
        <button onClick={onClose} className="modal-close" aria-label="Close">
          <X className="h-5 w-5" />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="contents">
        <div className="modal-body space-y-4">
        {/* The naming convention comes first: the name it produces is what
            every other field on this form hangs off. */}
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

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label className={label}>Product Name *</label>
            <input type="text" value={form.name} onChange={set("name")} required className={field} />
            <NameComplianceNotice name={form.name} />
          </div>
          <div>
            <label className={label}>
              Product Code {!isEdit && <span className="font-normal text-slate-500">(auto if blank)</span>}
            </label>
            <input type="text" value={form.code} onChange={set("code")} className={field} />
          </div>
          <div>
            <label className={label}>Category *</label>
            <input type="text" value={form.category} onChange={set("category")} required className={field} />
          </div>
          <div>
            <label className={label}>Sub-Category</label>
            <input
              type="text"
              value={form.subCategory}
              onChange={set("subCategory")}
              placeholder="e.g. Ring Spanners"
              className={field}
            />
          </div>
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
          <div>
            <label className={label}>Unit</label>
            <input type="text" value={form.unit} onChange={set("unit")} className={field} />
          </div>
          <div>
            <label className={label}>
              {isEdit ? "Total Quantity (all rooms)" : "Opening Quantity"}
            </label>
            <input
              type="number"
              min="0"
              value={form.quantity}
              onChange={set("quantity")}
              className={field}
            />
          </div>
          <div>
            <label className={label}>Home Store Room *</label>
            <select value={form.storeRoom} onChange={set("storeRoom")} required className={`${field} cursor-pointer`}>
              <option value="">Select a store room…</option>
              {rooms.map((room) => (
                <option key={room._id} value={room.name}>
                  {room.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={label}>Min Stock</label>
            <input type="number" min="0" value={form.minStock} onChange={set("minStock")} className={field} />
          </div>
          <div>
            <label className={label}>Max Stock</label>
            <input type="number" min="0" value={form.maxStock} onChange={set("maxStock")} className={field} />
          </div>
          <div>
            <label className={label}>Unit Cost (₹)</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.unitCost}
              onChange={set("unitCost")}
              className={field}
            />
          </div>
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

        {/* Spell out the stock consequences before they are applied. */}
        {(roomChanged || quantityChanged) && (
          <div className="note note-amber flex-col gap-1">
            <span className="font-bold flex items-center gap-1.5">
              <AlertCircle className="h-4 w-4" /> This also moves stock
            </span>
            {roomChanged && (
              <p>
                Stock currently in <strong>{product.storeRoom}</strong> will move to{" "}
                <strong>{form.storeRoom}</strong>.
              </p>
            )}
            {quantityChanged && (
              <p>
                Total goes from <strong>{product.quantity}</strong> to{" "}
                <strong>{Number(form.quantity)}</strong>; the difference is applied to{" "}
                <strong>{form.storeRoom}</strong>.
              </p>
            )}
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
            {isEdit ? "Save Changes" : "Add Product"}
          </button>
        </div>
      </form>
    </div>
  );
};

export default ProductFormModal;
