import { useCallback, useEffect, useMemo, useState } from "react";
import API from "../../services/api";
import { useNotifications } from "../../context/NotificationContext";
import { formatCurrency } from "../../utils/currency";
import {
  Loader2,
  Download,
  CheckCircle2,
  ArrowRightLeft,
  Warehouse,
  Search,
  ShieldAlert,
  Ban,
} from "lucide-react";

/**
 * The SAP naming hand-off (ST-13).
 *
 * Module 1 does not integrate with SAP. Its whole job here is to make sure no
 * item gets stocked under a name SAP has never heard of: every item created
 * through intake lands on this list, the Plant Manager creates it in SAP, and
 * the code that comes back is recorded against the product.
 *
 * The CSV is the point of the page as much as the table is — the list has to
 * leave the app to reach whoever is sitting in front of SAP.
 */
const SapHandoff = () => {
  const { showToast } = useNotifications();

  const [pending, setPending] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [room, setRoom] = useState("");
  const [search, setSearch] = useState("");
  const [exporting, setExporting] = useState(false);

  /** The row whose SAP code is being entered, keyed by product id. */
  const [editing, setEditing] = useState(null);
  const [sapCode, setSapCode] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchPending = useCallback(async () => {
    try {
      setLoading(true);
      const { data } = await API.get("/products/sap-pending", {
        params: room ? { storeRoom: room } : {},
      });
      setPending(data);
    } catch (error) {
      console.error("Error loading the SAP hand-off list:", error);
      showToast("Failed to load the SAP hand-off list", "error");
    } finally {
      setLoading(false);
    }
  }, [room, showToast]);

  useEffect(() => {
    fetchPending();
  }, [fetchPending]);

  useEffect(() => {
    API.get("/stock-rooms")
      .then(({ data }) => setRooms(data))
      // The room filter is a convenience; the list works without it.
      .catch((error) => console.error("Error loading stock rooms:", error));
  }, []);

  // Filtering the rows already in hand rather than round-tripping: the pending
  // queue is small by construction, and it should shrink as items are cleared.
  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return pending;
    return pending.filter((product) =>
      [product.name, product.code, product.category, product.naming?.itemCode]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(needle)),
    );
  }, [pending, search]);

  const handleExport = async () => {
    try {
      setExporting(true);
      const { data } = await API.get("/products/sap-pending", {
        params: { format: "csv", ...(room && { storeRoom: room }) },
        responseType: "blob",
      });

      const url = URL.createObjectURL(new Blob([data], { type: "text/csv;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `sap-pending-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Error exporting the SAP hand-off list:", error);
      showToast("Failed to export the list", "error");
    } finally {
      setExporting(false);
    }
  };

  const updateSap = async (product, status, code = "") => {
    try {
      setSaving(true);
      await API.put(`/products/${product._id}/sap`, { status, code });
      showToast(
        status === "Created"
          ? `"${product.name}" marked as created in SAP`
          : `"${product.name}" no longer needs a SAP record`,
        "success",
      );
      setEditing(null);
      setSapCode("");
      await fetchPending();
    } catch (error) {
      console.error("Error updating SAP status:", error);
      showToast(error.response?.data?.message || "Failed to update SAP status", "error");
    } finally {
      setSaving(false);
    }
  };

  const dayOf = (value) =>
    value
      ? new Date(value).toLocaleDateString([], {
          month: "short",
          day: "numeric",
          year: "numeric",
        })
      : "—";

  /** How long the Plant Manager has been sitting on this one. */
  const waitingDays = (value) =>
    value ? Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000) : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 p-5 rounded-2xl glass-premium border border-slate-200">
        <div className="flex items-center gap-2">
          <ArrowRightLeft className="h-5 w-5 text-indigo-600" />
          <div>
            <h3 className="text-lg font-bold text-slate-900">SAP Hand-off</h3>
            <p className="text-xs text-slate-500">
              Items named in the store and waiting to be created in SAP by the Plant Manager
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, code…"
              className="field-search"
            />
          </div>
          <select
            value={room}
            onChange={(e) => setRoom(e.target.value)}
            className="field field-sm w-auto cursor-pointer"
          >
            <option value="">All companies</option>
            {rooms.map((option) => (
              <option key={option._id} value={option.name}>
                {option.name}
              </option>
            ))}
          </select>
          <button
            onClick={handleExport}
            disabled={exporting || !pending.length}
            className="btn btn-primary"
          >
            {exporting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            Export CSV
          </button>
        </div>
      </div>

      <div className="table-card">
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-200">
          <h4 className="text-sm font-bold text-slate-900">
            Pending SAP creation
            <span className="ml-2 badge badge-indigo">{visible.length}</span>
          </h4>
          {Boolean(pending.length) && (
            <p className="text-[11px] text-slate-500">
              Oldest first — these are blocking nothing in the store, but nothing in SAP
              either.
            </p>
          )}
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-slate-500 text-sm">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : !visible.length ? (
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <CheckCircle2 className="h-8 w-8 text-emerald-500" />
            <p className="text-sm font-semibold text-slate-700">
              {pending.length ? "Nothing matches that search" : "Nothing waiting for SAP"}
            </p>
            <p className="text-xs text-slate-500">
              {pending.length
                ? "Clear the search to see the rest of the queue."
                : "Every item named in the store has been created in SAP."}
            </p>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500 border-b border-slate-200">
                  <th className="px-5 py-3">Standard Name</th>
                  <th className="px-3 py-3">Category</th>
                  <th className="px-3 py-3">Material / Item Code</th>
                  <th className="px-3 py-3">UOM</th>
                  <th className="px-3 py-3 text-right">Unit Cost</th>
                  <th className="px-3 py-3">Plant / Rack</th>
                  <th className="px-3 py-3">Waiting</th>
                  <th className="px-5 py-3 text-right">SAP</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((product) => {
                  const days = waitingDays(product.createdAt);
                  const isEditing = editing === product._id;

                  return (
                    <tr
                      key={product._id}
                      className="border-b border-slate-100 last:border-0 align-top"
                    >
                      <td className="px-5 py-3">
                        <p className="font-bold text-slate-900 break-words">{product.name}</p>
                        <p className="text-[11px] text-slate-500">{product.code}</p>
                        {/* A name the convention rejected still has to reach SAP,
                            but the Plant Manager should know before typing it in. */}
                        {product.nameCompliant === false && (
                          <span className="badge badge-amber mt-1 text-[10px]">
                            <ShieldAlert className="h-3 w-3" /> Non-compliant name
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-slate-600">
                        <p>{product.category}</p>
                        {product.subCategory && (
                          <p className="text-[11px] text-slate-400">{product.subCategory}</p>
                        )}
                      </td>
                      <td className="px-3 py-3 text-slate-600">
                        <p>{product.naming?.material || "—"}</p>
                        {product.naming?.itemCode && (
                          <p className="text-[11px] text-slate-400">{product.naming.itemCode}</p>
                        )}
                      </td>
                      <td className="px-3 py-3 text-slate-600">{product.unit}</td>
                      <td className="px-3 py-3 text-right text-slate-600">
                        {product.unitCost ? formatCurrency(product.unitCost) : "—"}
                      </td>
                      <td className="px-3 py-3 text-slate-600">
                        <span className="inline-flex items-center gap-1">
                          <Warehouse className="h-3.5 w-3.5 text-slate-400" />
                          {product.storeRoom}
                        </span>
                        {product.rackNumber && (
                          <p className="text-[11px] text-slate-400">{product.rackNumber}</p>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <span
                          className={`badge ${
                            days >= 7 ? "badge-rose" : days >= 3 ? "badge-amber" : "badge-slate"
                          }`}
                        >
                          {days === 0 ? "Today" : `${days}d`}
                        </span>
                        <p className="text-[11px] text-slate-400 mt-0.5">
                          {dayOf(product.createdAt)}
                        </p>
                      </td>
                      <td className="px-5 py-3">
                        {isEditing ? (
                          <div className="flex flex-col items-end gap-2">
                            <input
                              type="text"
                              value={sapCode}
                              onChange={(e) => setSapCode(e.target.value)}
                              placeholder="SAP material code"
                              autoFocus
                              className="field field-sm w-44"
                            />
                            <div className="flex gap-1.5">
                              <button
                                onClick={() => {
                                  setEditing(null);
                                  setSapCode("");
                                }}
                                disabled={saving}
                                className="btn btn-sm btn-neutral"
                              >
                                Cancel
                              </button>
                              <button
                                onClick={() => updateSap(product, "Created", sapCode)}
                                disabled={saving || !sapCode.trim()}
                                className="btn btn-sm btn-success"
                              >
                                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                                Confirm
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex justify-end gap-1.5">
                            <button
                              onClick={() => updateSap(product, "Not Required")}
                              disabled={saving}
                              className="btn btn-sm btn-neutral"
                              title="This item does not need a SAP record"
                            >
                              <Ban className="h-3.5 w-3.5" /> Not needed
                            </button>
                            <button
                              onClick={() => {
                                setEditing(product._id);
                                setSapCode("");
                              }}
                              disabled={saving}
                              className="btn btn-sm btn-primary"
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" /> Created in SAP
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default SapHandoff;
