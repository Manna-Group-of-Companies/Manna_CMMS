import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import API from "../../services/api";
import { useNotifications } from "../../context/NotificationContext";
import useAutoRefresh from "../../hooks/useAutoRefresh";
import {
  Loader2,
  Warehouse,
  HelpCircle,
  X,
  Search,
  ArrowLeftRight,
  Pencil,
  AlertCircle,
  PackageOpen,
  GitMerge,
} from "lucide-react";

/**
 * Per-room inventory, and the two ways an Admin changes it: moving stock
 * between rooms, and correcting a room's count after a physical stock take.
 *
 * This reads the same endpoint as the Supervisor's Stock tab, so the two
 * always show identical quantities.
 *
 * Red Stock is shown alongside the store rooms so returned product is visible
 * in the same place as everything else, but it is read-only here: stock only
 * leaves it through an approved weekly merge.
 */
const StockRooms = () => {
  const { showToast } = useNotifications();
  const [rooms, setRooms] = useState([]);
  const [redStock, setRedStock] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  // { mode: 'transfer' | 'adjust', item, room }
  const [action, setAction] = useState(null);
  const [form, setForm] = useState({ toRoomId: "", quantity: 1, note: "" });
  const [submitting, setSubmitting] = useState(false);

  /** [silent] is used by the background poll: no spinner, no error toast. */
  const fetchInventory = async ({ silent = false } = {}) => {
    try {
      if (!silent) setLoading(true);
      const [inventoryRes, redStockRes] = await Promise.all([
        API.get("/stock-rooms/inventory"),
        API.get("/red-stock/room"),
      ]);
      setRooms(inventoryRes.data);
      setRedStock(redStockRes.data);
    } catch (error) {
      console.error("Error loading stock rooms:", error);
      if (!silent) showToast("Could not retrieve stock rooms", "error");
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    fetchInventory();
  }, []);

  // Supervisors issue stock from the app, which moves these balances.
  useAutoRefresh(() => fetchInventory({ silent: true }), { enabled: !action });

  const visibleRooms = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return rooms;
    return rooms
      .map((room) => {
        const items = room.items.filter(
          (item) =>
            item.name.toLowerCase().includes(term) || item.code.toLowerCase().includes(term)
        );
        return {
          ...room,
          items,
          itemCount: items.length,
          totalQuantity: items.reduce((sum, item) => sum + item.quantity, 0),
        };
      })
      .filter((room) => room.items.length > 0);
  }, [rooms, search]);

  // Red Stock is filtered by the same search box, but kept out of the store
  // room list so it can never be transferred or counted like on-hand stock.
  const visibleRedStock = useMemo(() => {
    if (!redStock) return null;
    const term = search.trim().toLowerCase();
    if (!term) return redStock;

    const items = redStock.items.filter(
      (item) =>
        item.name.toLowerCase().includes(term) ||
        (item.code || "").toLowerCase().includes(term)
    );
    return {
      ...redStock,
      items,
      itemCount: items.length,
      totalQuantity: items.reduce((sum, item) => sum + item.quantity, 0),
    };
  }, [redStock, search]);

  const grandTotal = rooms.reduce((sum, room) => sum + room.totalQuantity, 0);

  const openTransfer = (room, item) => {
    setAction({ mode: "transfer", room, item });
    setForm({
      toRoomId: rooms.find((r) => r._id !== room._id)?._id || "",
      quantity: 1,
      note: "",
    });
  };

  const openAdjust = (room, item) => {
    setAction({ mode: "adjust", room, item });
    setForm({ toRoomId: "", quantity: item.quantity, note: "" });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const quantity = Number(form.quantity);
    const { mode, room, item } = action;

    if (mode === "transfer") {
      if (!Number.isInteger(quantity) || quantity < 1) {
        return showToast("Transfer quantity must be at least 1", "error");
      }
      if (quantity > item.quantity) {
        return showToast(`${room.name} only holds ${item.quantity}`, "error");
      }
      if (!form.toRoomId) return showToast("Choose a destination room", "error");
    } else if (!Number.isInteger(quantity) || quantity < 0) {
      return showToast("Quantity must be a whole number of 0 or more", "error");
    }

    try {
      setSubmitting(true);
      if (mode === "transfer") {
        const { data } = await API.post("/stock-rooms/transfer", {
          productId: item.productId,
          fromRoomId: room._id,
          toRoomId: form.toRoomId,
          quantity,
          note: form.note,
        });
        showToast(data.message, "success");
      } else {
        const { data } = await API.put("/stock-rooms/inventory", {
          productId: item.productId,
          stockRoomId: room._id,
          quantity,
          note: form.note,
        });
        showToast(data.message, "success");
      }
      setAction(null);
      fetchInventory();
    } catch (error) {
      console.error("Error updating stock room:", error);
      showToast(error.response?.data?.message || "Failed to update stock room", "error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-2xl glass-premium border border-slate-200">
        <div className="flex items-center gap-2">
          <Warehouse className="h-5 w-5 text-brand-700" />
          <div>
            <h3 className="text-lg font-bold text-slate-900">Stock Rooms</h3>
            <p className="text-xs text-slate-500">
              {rooms.length} room(s) • {grandTotal} pcs on hand
              {redStock?.totalQuantity > 0 && (
                <>
                  {" "}
                  • <span className="text-rose-600 font-semibold">
                    {redStock.totalQuantity} pcs in Red Stock
                  </span>
                </>
              )}
            </p>
          </div>
        </div>

        <div className="relative w-full sm:w-72">
          <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-500">
            <Search className="h-4 w-4" />
          </span>
          <input
            type="text"
            placeholder="Search product name or code…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-sm rounded-xl bg-white border border-slate-200 text-slate-900 placeholder-slate-400 focus:outline-none focus:border-brand-500"
          />
        </div>
      </div>

      {loading ? (
        <div className="h-[40vh] flex items-center justify-center">
          <Loader2 className="h-7 w-7 text-brand-500 animate-spin" />
        </div>
      ) : visibleRooms.length === 0 && !visibleRedStock?.items.length ? (
        <div className="glass-premium p-12 text-center rounded-2xl border border-slate-200 flex flex-col items-center justify-center">
          <HelpCircle className="h-10 w-10 text-slate-400 mb-3" />
          <h3 className="text-base font-bold text-slate-900 mb-1">
            {search ? `Nothing matches "${search}"` : "No stock recorded yet"}
          </h3>
          <p className="text-xs text-slate-500">
            {search
              ? "Try a different product name or code."
              : "Approved stock requests appear here under the room they were credited to."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          {/* Red Stock — returned product, read-only until the weekly merge */}
          {visibleRedStock && (
            <div className="glass-premium rounded-2xl border border-rose-500/30 overflow-hidden shadow-sm">
              <div className="px-5 py-4 border-b border-rose-500/20 flex items-center justify-between bg-rose-50">
                <div className="flex items-center gap-2">
                  <PackageOpen className="h-4 w-4 text-rose-600" />
                  <div>
                    <h4 className="font-bold text-slate-900 text-sm">Red Stock</h4>
                    <span className="text-[10px] text-slate-500">
                      {visibleRedStock.itemCount} returned product(s) • awaiting the weekly merge
                    </span>
                  </div>
                </div>
                <span className="px-3 py-1 rounded-full bg-rose-500/10 text-rose-600 border border-rose-500/20 text-xs font-bold">
                  {visibleRedStock.totalQuantity} Pcs
                </span>
              </div>

              {visibleRedStock.items.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-500">
                  No returned stock is waiting.
                </div>
              ) : (
                <div className="divide-y divide-rose-500/10">
                  {visibleRedStock.items.map((item) => (
                    <div
                      key={item.productId}
                      className="px-5 py-3 flex items-center gap-3 hover:bg-rose-50/50 transition-colors"
                    >
                      <img
                        src={
                          item.image ||
                          "https://images.unsplash.com/photo-1595246140707-1e5b22b271d4?w=50&auto=format"
                        }
                        alt={item.name}
                        className="w-9 h-9 rounded-lg object-cover border border-slate-200"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-slate-900 text-sm truncate">
                          {item.name}
                        </div>
                        <div className="text-[10px] font-mono text-rose-600">{item.code}</div>
                      </div>
                      {item.inOpenMerge > 0 && (
                        <span
                          className="text-[10px] font-semibold text-indigo-600 flex items-center gap-1"
                          title="Included in the open weekly merge request"
                        >
                          <GitMerge className="h-3 w-3" />
                          {item.inOpenMerge} in merge
                        </span>
                      )}
                      <span className="text-sm font-bold px-2 py-0.5 rounded bg-rose-50 text-rose-600">
                        {item.quantity} {item.unit}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <div className="px-5 py-3 bg-slate-50 border-t border-rose-500/20 text-[11px] text-slate-600 flex items-center justify-between gap-3">
                <span>Moves to a store room only when a weekly merge is approved.</span>
                <Link
                  to="/admin/red-stock"
                  className="font-semibold text-rose-600 hover:underline shrink-0"
                >
                  Open Red Stock Room
                </Link>
              </div>
            </div>
          )}

          {visibleRooms.map((room) => (
            <div
              key={room._id}
              className="glass-premium rounded-2xl border border-slate-200 overflow-hidden shadow-sm"
            >
              <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
                <div className="flex items-center gap-2">
                  <Warehouse className="h-4 w-4 text-brand-700" />
                  <div>
                    <h4 className="font-bold text-slate-900 text-sm">{room.name}</h4>
                    <span className="text-[10px] text-slate-500">
                      {room.itemCount} product(s)
                    </span>
                  </div>
                </div>
                <span className="px-3 py-1 rounded-full bg-brand-500/10 text-brand-700 border border-brand-500/20 text-xs font-bold">
                  {room.totalQuantity} Pcs
                </span>
              </div>

              {room.items.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-500">This room is empty.</div>
              ) : (
                <div className="divide-y divide-slate-200">
                  {room.items.map((item) => (
                    <div
                      key={item.productId}
                      className="px-5 py-3 flex items-center gap-3 hover:bg-slate-50 transition-colors"
                    >
                      <img
                        src={
                          item.image ||
                          "https://images.unsplash.com/photo-1595246140707-1e5b22b271d4?w=50&auto=format"
                        }
                        alt={item.name}
                        className="w-9 h-9 rounded-lg object-cover border border-slate-200"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-slate-900 text-sm truncate">
                          {item.name}
                        </div>
                        <div className="text-[10px] font-mono text-brand-700">{item.code}</div>
                      </div>
                      <span
                        className={`text-sm font-bold px-2 py-0.5 rounded ${
                          item.isLowStock
                            ? "bg-amber-50 text-amber-600"
                            : "bg-emerald-50 text-emerald-600"
                        }`}
                      >
                        {item.quantity} {item.unit}
                      </span>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => openTransfer(room, item)}
                          disabled={rooms.length < 2 || item.quantity === 0}
                          className="p-1.5 hover:bg-slate-100 rounded-lg text-indigo-600 transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                          title="Move to another room"
                        >
                          <ArrowLeftRight className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => openAdjust(room, item)}
                          className="p-1.5 hover:bg-slate-100 rounded-lg text-brand-700 transition-all cursor-pointer"
                          title="Correct this room's count"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Transfer / adjust modal */}
      {action && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
          <div className="glass-premium w-full max-w-md rounded-2xl border border-slate-200 max-h-[90vh] overflow-y-auto shadow-2xl animate-fade-in text-left">
            <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-center">
              <div>
                <h3 className="font-bold text-lg text-slate-900">
                  {action.mode === "transfer" ? "Move Stock" : "Correct Count"}
                </h3>
                <p className="text-xs text-slate-600 mt-0.5">
                  {action.item.name} • {action.room.name}
                </p>
              </div>
              <button
                onClick={() => setAction(null)}
                className="p-1 rounded-lg hover:bg-slate-100 text-slate-600 hover:text-slate-900 cursor-pointer transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-700">
                <strong>{action.room.name}</strong> currently holds{" "}
                <strong>
                  {action.item.quantity} {action.item.unit}
                </strong>{" "}
                of {action.item.name}.
              </div>

              {action.mode === "transfer" ? (
                <>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                      Move To *
                    </label>
                    <select
                      value={form.toRoomId}
                      onChange={(e) => setForm({ ...form, toRoomId: e.target.value })}
                      required
                      className="w-full px-4 py-2.5 text-sm rounded-xl bg-white border border-slate-200 text-slate-900 focus:outline-none focus:border-brand-500 cursor-pointer"
                    >
                      <option value="">Select a destination room…</option>
                      {rooms
                        .filter((room) => room._id !== action.room._id)
                        .map((room) => (
                          <option key={room._id} value={room._id}>
                            {room.name}
                          </option>
                        ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                      Quantity to Move *{" "}
                      <span className="font-normal text-slate-500">
                        (max {action.item.quantity})
                      </span>
                    </label>
                    <input
                      type="number"
                      min="1"
                      max={action.item.quantity}
                      value={form.quantity}
                      onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                      required
                      className="w-full px-4 py-2.5 text-sm rounded-xl bg-white border border-slate-200 text-slate-900 focus:outline-none focus:border-brand-500"
                    />
                  </div>
                  <div className="p-3 rounded-xl bg-indigo-50 border border-indigo-500/20 text-[11px] text-indigo-900 leading-relaxed">
                    The product's total stays the same — only where it sits changes. Both rooms
                    update for the Supervisor app straight away.
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                      New Quantity in {action.room.name} *
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={form.quantity}
                      onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                      required
                      className="w-full px-4 py-2.5 text-sm rounded-xl bg-white border border-slate-200 text-slate-900 focus:outline-none focus:border-brand-500"
                    />
                  </div>
                  {Number(form.quantity) !== action.item.quantity && (
                    <div className="p-3 rounded-xl bg-amber-50 border border-amber-500/20 text-[11px] text-amber-900 leading-relaxed flex gap-2">
                      <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                      <span>
                        This changes the product total by{" "}
                        <strong>
                          {Number(form.quantity) - action.item.quantity > 0 ? "+" : ""}
                          {Number(form.quantity) - action.item.quantity}
                        </strong>
                        . Only {action.room.name} is affected.
                      </span>
                    </div>
                  )}
                </>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                  Note (optional)
                </label>
                <input
                  type="text"
                  value={form.note}
                  onChange={(e) => setForm({ ...form, note: e.target.value })}
                  placeholder="e.g. Quarterly stock take"
                  className="w-full px-4 py-2.5 text-sm rounded-xl bg-white border border-slate-200 text-slate-900 placeholder-slate-400 focus:outline-none focus:border-brand-500"
                />
              </div>

              <div className="pt-4 border-t border-slate-200 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setAction(null)}
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
                  {action.mode === "transfer" ? "Move Stock" : "Save Count"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default StockRooms;
