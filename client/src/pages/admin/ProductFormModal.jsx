import { useEffect, useState } from "react";
import API from "../../services/api";
import { useNotifications } from "../../context/NotificationContext";
import { Loader2, X, Boxes, AlertCircle } from "lucide-react";

const EMPTY = {
  code: "",
  name: "",
  category: "",
  rackNumber: "",
  quantity: 0,
  unit: "Pcs",
  minStock: 5,
  maxStock: 100,
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

  useEffect(() => {
    if (product) {
      setForm({
        code: product.code || "",
        name: product.name || "",
        category: product.category || "",
        rackNumber: product.rackNumber || "",
        quantity: product.quantity ?? 0,
        unit: product.unit || "Pcs",
        minStock: product.minStock ?? 5,
        maxStock: product.maxStock ?? 100,
        storeRoom: product.storeRoom || "",
        description: product.description || "",
        image: product.image || "",
      });
    } else {
      setForm(EMPTY);
    }
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

  const set = (field) => (e) => setForm({ ...form, [field]: e.target.value });

  const roomChanged = isEdit && form.storeRoom !== product.storeRoom;
  const quantityChanged = isEdit && Number(form.quantity) !== product.quantity;

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
      console.error("Error saving product:", error);
      showToast(error.response?.data?.message || "Failed to save product", "error");
    } finally {
      setSubmitting(false);
    }
  };

  const field = "w-full px-4 py-2.5 text-sm rounded-xl bg-white border border-slate-200 text-slate-900 placeholder-slate-400 focus:outline-none focus:border-brand-500";
  const label = "block text-xs font-semibold text-slate-600 mb-1.5";

  return (
    <div className="glass-premium w-full max-w-2xl rounded-2xl border border-slate-200 max-h-[90vh] overflow-y-auto shadow-2xl animate-fade-in text-left">
      <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-center">
        <h3 className="font-bold text-lg text-slate-900 flex items-center gap-2">
          <Boxes className="h-5 w-5 text-brand-700" />
          {isEdit ? `Edit ${product.name}` : "Add Product"}
        </h3>
        <button
          onClick={onClose}
          className="p-1 rounded-lg hover:bg-slate-100 text-slate-600 hover:text-slate-900 cursor-pointer transition-colors"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={label}>Product Name *</label>
            <input type="text" value={form.name} onChange={set("name")} required className={field} />
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
            rows="2"
            className={`${field} resize-none`}
          ></textarea>
        </div>

        {/* Spell out the stock consequences before they are applied. */}
        {(roomChanged || quantityChanged) && (
          <div className="p-3 rounded-xl bg-amber-50 border border-amber-500/20 text-[11px] text-amber-900 leading-relaxed space-y-1">
            <span className="font-bold flex items-center gap-1.5">
              <AlertCircle className="h-3.5 w-3.5" /> This also moves stock
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

        <div className="pt-4 border-t border-slate-200 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold rounded-xl bg-white border border-slate-200 text-slate-600 cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="px-4 py-2 text-xs font-semibold rounded-xl bg-brand-600 hover:bg-brand-500 text-white disabled:opacity-50 cursor-pointer active:scale-98 transition-all flex items-center gap-2"
          >
            {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {isEdit ? "Save Changes" : "Add Product"}
          </button>
        </div>
      </form>
    </div>
  );
};

export default ProductFormModal;
