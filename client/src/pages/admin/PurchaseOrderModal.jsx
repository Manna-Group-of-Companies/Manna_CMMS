import { useState } from "react";
import API from "../../services/api";
import { useNotifications } from "../../context/NotificationContext";
import { formatCurrency } from "../../utils/currency";
import { AlertTriangle, FileCheck, Loader2, X } from "lucide-react";

/**
 * The PO, made from a quotation SAP has (24 Oct 2026) - one quotation, one PO.
 *
 * Management has signed the printed quotation, and that signature is the
 * approval: there is no draft, and the sync posts the PO straight away. Vendor,
 * units, prices and tax codes are the quotation's. The quantity starts at the
 * quoted one and can change, because a vendor sometimes quotes for a single
 * unit. A quotation past its validity date still makes a PO once that is
 * confirmed; the PO records that it was.
 */

const pad = (n) => String(n).padStart(2, "0");
/** Local date; toISOString would give yesterday for the first hours of an Indian day. */
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const REMARKS_MAX = 200;

/** A validity date is a calendar date; no time, and no timezone shift. */
const day = (value) => {
  if (!value) return "";
  const d = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString("en-IN", { dateStyle: "medium" });
};

const PurchaseOrderModal = ({ quotation: q, onClose, onSaved }) => {
  const { showToast } = useNotifications();
  const [poDate, setPoDate] = useState(today());
  const [deliveryDate, setDeliveryDate] = useState(today());
  const [remarks, setRemarks] = useState("");
  const [lines, setLines] = useState(() => (q.lines || []).map((l) => ({ ...l, orderQty: String(l.qty) })));
  const [acceptExpired, setAcceptExpired] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const expired = Boolean(q.validUntil) && String(q.validUntil).slice(0, 10) < poDate;

  const setQty = (lineId, value) =>
    setLines((prev) => prev.map((l) => (l.lineId === lineId ? { ...l, orderQty: value } : l)));

  const total = lines.reduce((sum, l) => (Number(l.orderQty) > 0 ? sum + Number(l.orderQty) * l.price : sum), 0);

  const validate = () => {
    if (!poDate) return "Give the PO date.";
    if (!deliveryDate) return "Give the delivery date.";
    if (deliveryDate < poDate) return "The delivery date cannot be before the PO date.";
    if (remarks.trim().length > REMARKS_MAX) return `Keep the remarks to ${REMARKS_MAX} characters.`;
    for (const l of lines) if (!(Number(l.orderQty) > 0)) return `Give the quantity for ${l.name}.`;
    if (expired && !acceptExpired) return "The quotation has expired. Tick the box to make the PO anyway.";
    return "";
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const problem = validate();
    setError(problem);
    if (problem) return;
    try {
      setSaving(true);
      const { data } = await API.post(`/purchase-quotations/${q.id}/order`, {
        poDate,
        deliveryDate,
        remarks: remarks.trim(),
        acceptExpired: expired && acceptExpired,
        lines: lines.map((l) => ({ lineId: l.lineId, qty: Number(l.orderQty) })),
      });
      showToast(`${data.id} saved. The SAP sync posts it.`, "success");
      onSaved?.(data);
      onClose();
    } catch (err) {
      setError(err.response?.data?.message || "Could not save the purchase order.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal max-w-5xl">
      <div className="modal-head">
        <div className="min-w-0">
          <h3 className="modal-title">
            <FileCheck className="h-[18px] w-[18px] text-brand-700 shrink-0" />
            Make PO
          </h3>
          <p className="modal-sub">
            From {q.id}
            {q.sapDocNumber ? ` · SAP quotation ${q.sapDocNumber}` : ""} · {q.vendorName || q.vendorCode} ·{" "}
            {q.companyName || q.company}
          </p>
        </div>
        <button onClick={onClose} className="modal-close" aria-label="Close">
          <X className="h-5 w-5" />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="contents" noValidate>
        <div className="modal-body space-y-4">
          {expired && (
            <div className="note note-amber">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-px" />
              <div className="space-y-2">
                <p>
                  This quotation was valid until {day(q.validUntil)}. The PO can still be made from the signed
                  printout; it will be marked as made after the quotation expired.
                </p>
                <label className="flex items-center gap-2 cursor-pointer font-medium">
                  <input
                    type="checkbox"
                    checked={acceptExpired}
                    onChange={(e) => setAcceptExpired(e.target.checked)}
                    className="h-4 w-4 accent-brand-600"
                  />
                  Make the PO anyway
                </label>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 sm:max-w-md">
            <div>
              <label className="field-label" htmlFor="po-date">
                PO date
              </label>
              <input
                id="po-date"
                type="date"
                value={poDate}
                onChange={(e) => setPoDate(e.target.value)}
                className="field"
                required
              />
            </div>
            <div>
              <label className="field-label" htmlFor="po-due">
                Delivery date
              </label>
              <input
                id="po-due"
                type="date"
                value={deliveryDate}
                min={poDate || undefined}
                onChange={(e) => setDeliveryDate(e.target.value)}
                className="field"
                required
              />
            </div>
          </div>

          <div className="table-card">
            <div className="table-scroll">
              <table className="tbl tbl-compact">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th className="text-right">Quoted</th>
                    <th>Order qty</th>
                    <th className="text-right">Unit price</th>
                    <th>Tax code</th>
                    <th className="text-right">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => {
                    const value = Number(l.orderQty) > 0 ? Number(l.orderQty) * l.price : 0;
                    return (
                      <tr key={l.lineId}>
                        <td>
                          <div className="min-w-[160px] max-w-[280px]">
                            <div className="cell-title break-words leading-snug">{l.name}</div>
                            <div className="mono text-[11px] text-slate-500">SAP {l.sapItemCode || l.itemCode}</div>
                            <div className="text-[11px] text-slate-500">
                              Requested {l.requestQty} {l.inventoryUnit}
                            </div>
                          </div>
                        </td>
                        <td className="text-right whitespace-nowrap text-slate-700">
                          {l.qty} {l.vendorUnit}
                        </td>
                        <td>
                          <div className="flex items-center gap-1.5">
                            <input
                              type="number"
                              min="0"
                              step="any"
                              inputMode="decimal"
                              value={l.orderQty}
                              onChange={(ev) => setQty(l.lineId, ev.target.value)}
                              className="field field-sm w-24"
                              aria-label={`Order quantity of ${l.name} in ${l.vendorUnit}`}
                            />
                            <span className="text-[12px] text-slate-500">{l.vendorUnit}</span>
                          </div>
                        </td>
                        <td className="text-right whitespace-nowrap tabular-nums text-slate-700">
                          {formatCurrency(l.price)} / {l.vendorUnit}
                        </td>
                        <td className="whitespace-nowrap text-slate-700">{l.taxCode}</td>
                        <td className="text-right whitespace-nowrap tabular-nums text-slate-800">
                          {value ? formatCurrency(value) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex items-baseline justify-between gap-3 border-t border-slate-200 px-4 py-3">
              <span className="text-[12px] text-slate-500">PO value, before tax, at the quoted prices.</span>
              <span className="text-base font-bold tabular-nums text-slate-900">{formatCurrency(total)}</span>
            </div>
          </div>

          <div>
            <label className="field-label" htmlFor="po-remarks">
              Remarks
            </label>
            <textarea
              id="po-remarks"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              className="field field-area"
              rows={2}
              maxLength={REMARKS_MAX}
              placeholder="Optional - goes to the PO's comments in SAP"
            />
          </div>

          {error && <div className="note note-rose text-sm">{error}</div>}
        </div>

        <div className="modal-foot">
          <button type="button" onClick={onClose} className="btn btn-neutral">
            Cancel
          </button>
          <button type="submit" disabled={saving} className="btn btn-primary">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Save PO for SAP
          </button>
        </div>
      </form>
    </div>
  );
};

export default PurchaseOrderModal;
