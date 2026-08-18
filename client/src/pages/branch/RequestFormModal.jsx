import { useEffect, useState } from "react";
import API from "../../services/api";
import { useNotifications } from "../../context/NotificationContext";
import { X, Send, Loader2, Boxes } from "lucide-react";

/**
 * Raises a request for one product held in the branch's own room.
 *
 * [items] are the room's stock rows, so the picker can only ever offer what
 * the branch actually holds — the same rule the API enforces.
 */
const RequestFormModal = ({ items = [], preselected = null, onClose, onSubmitted }) => {
  const { showToast } = useNotifications();
  const [productId, setProductId] = useState(preselected?.productId || "");
  const [quantity, setQuantity] = useState(1);
  const [purpose, setPurpose] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const inStock = items.filter((item) => item.quantity > 0);
  const selected = inStock.find((item) => item.productId === productId) || null;

  // Close on Escape, like the other modals in the app.
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    if (!productId) {
      setError("Choose engineering stock to request");
      return;
    }
    const qty = Number(quantity);
    if (!Number.isInteger(qty) || qty < 1) {
      setError("Quantity must be a whole number of at least 1");
      return;
    }
    if (selected && qty > selected.quantity) {
      setError(`Only ${selected.quantity} ${selected.unit} available in this room`);
      return;
    }

    setSaving(true);
    try {
      const { data } = await API.post("/branch-requests", {
        productId,
        quantity: qty,
        purpose,
      });
      showToast(`Request ${data.requestNumber} sent for Admin approval`, "success");
      onSubmitted?.(data);
      onClose();
    } catch (err) {
      const message = err.response?.data?.message || "Could not submit the request";
      setError(message);
      showToast(message, "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
      <div className="w-full max-w-lg glass-premium rounded-2xl border border-slate-200 shadow-xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-slate-900">Apply for Engineering Stock</h3>
            <p className="text-xs text-slate-600 mt-0.5">
              Goes to the Admin first, then to the Supervisor for final approval.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-all cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {error && (
            <div className="p-3 rounded-lg bg-rose-50 border border-rose-500/25 text-rose-600 text-xs font-medium">
              {error}
            </div>
          )}

          {/* Engineering Stock */}
          <div>
            <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-2">
              Engineering Stock
            </label>
            <select
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
              className="w-full px-4 py-3 rounded-xl bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/20 transition-all cursor-pointer"
            >
              <option value="">Select engineering stock from your room</option>
              {inStock.map((item) => (
                <option key={item.productId} value={item.productId}>
                  {item.name} ({item.code}) — {item.quantity} {item.unit} available
                </option>
              ))}
            </select>
            {inStock.length === 0 && (
              <p className="text-xs text-amber-600 mt-2">
                Your room holds no stock to request right now.
              </p>
            )}
          </div>

          {/* Selected product summary */}
          {selected && (
            <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 border border-slate-200">
              {selected.image ? (
                <img
                  src={selected.image}
                  alt={selected.name}
                  className="h-11 w-11 rounded-lg object-cover border border-slate-200"
                />
              ) : (
                <div className="h-11 w-11 rounded-lg bg-white border border-slate-200 flex items-center justify-center">
                  <Boxes className="h-4 w-4 text-slate-500" />
                </div>
              )}
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900 truncate">{selected.name}</p>
                <p className="text-xs text-slate-600">
                  {selected.quantity} {selected.unit} in room · min {selected.minStock}
                </p>
              </div>
            </div>
          )}

          {/* Quantity */}
          <div>
            <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-2">
              Quantity {selected ? `(max ${selected.quantity})` : ""}
            </label>
            <input
              type="number"
              min="1"
              max={selected ? selected.quantity : undefined}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className="w-full px-4 py-3 rounded-xl bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/20 transition-all"
            />
          </div>

          {/* Purpose */}
          <div>
            <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-2">
              Purpose <span className="text-slate-400 normal-case font-normal">(optional)</span>
            </label>
            <textarea
              rows="3"
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              placeholder="What the items are needed for"
              className="w-full px-4 py-3 rounded-xl bg-white border border-slate-200 text-slate-900 placeholder-slate-400 text-sm focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/20 transition-all resize-none"
            />
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-600 hover:bg-slate-100 transition-all cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || inStock.length === 0}
              className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-brand-600 to-brand-700 hover:from-brand-500 hover:to-brand-600 text-white text-sm font-semibold shadow-lg transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              Submit Request
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default RequestFormModal;
