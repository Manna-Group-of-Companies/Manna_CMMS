import { useEffect, useState } from "react";
import API from "../services/api";
import { Warehouse } from "lucide-react";

/**
 * Which company holds how much of one item (ST-34, ST-35).
 *
 * Stock is kept separately per company, so the quantity on the product is only
 * a sum: an item can read "40 Pcs" while no single company has more than
 * fifteen. Anyone sent to fetch twenty needs to know that before they walk, so
 * a lookup says where the stock is and not just how much there is.
 *
 * Companies holding none of it are left out — a list of zeroes is noise, and a
 * company with none of the item is not somewhere to be sent.
 */
const CompanyBreakdown = ({ productId, unit, rack = "" }) => {
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!productId) return undefined;
    let cancelled = false;

    (async () => {
      try {
        setLoading(true);
        const { data } = await API.get(`/products/${productId}/rooms`);
        if (!cancelled) setRooms(data.filter((room) => room.quantity > 0));
      } catch (error) {
        console.error("Error loading the company breakdown:", error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [productId]);

  if (loading || rooms.length === 0) return null;

  return (
    <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 text-xs">
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-slate-500 flex items-center gap-1.5">
          <Warehouse className="h-3.5 w-3.5" /> Held by company
        </span>
        {rack && <span className="text-slate-400">Rack {rack}</span>}
      </div>

      <dl className="space-y-1">
        {rooms.map((room) => (
          <div key={room.stockRoomId} className="flex items-center justify-between gap-3">
            <dt className="text-slate-700 truncate">{room.stockRoom}</dt>
            <dd className="font-bold text-slate-900 shrink-0">
              {room.quantity} {unit}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
};

export default CompanyBreakdown;
