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
            rows="3"
            className={`${field} field-area`}
          ></textarea>
        </div>

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
          <button type="submit" disabled={submitting} className="btn btn-primary">
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {isEdit ? "Save Changes" : "Add Product"}
          </button>
        </div>
      </form>
    </div>
  );
};

export default ProductFormModal;
