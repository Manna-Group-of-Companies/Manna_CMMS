import { useEffect, useMemo, useRef, useState } from "react";
import API from "../../services/api";
import { useNotifications } from "../../context/NotificationContext";
import { formatCurrency } from "../../utils/currency";
import { AlertCircle, ChevronDown, FileText, Loader2, Search, X } from "lucide-react";

/**
 * The purchase manager makes the SAP Purchase Order from a purchase request
 * (20 Oct 2026), instead of keying it into SAP.
 *
 * Vendor, dates and a price per line are written on the request; the SAP sync
 * posts the PO copied from the SAP purchase request, so SAP links the two and
 * the request goes Ordered as it does for a PO made in SAP itself.
 *
 * The vendors and tax codes are the ones the sync publishes for the company -
 * the server refuses anything else, so this offers nothing else.
 */

const pad = (n) => String(n).padStart(2, "0");
/** Local date; toISOString would give yesterday for the first hours of an Indian day. */
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/** The dropdown lists this many at most; typing narrows it. A company may have hundreds. */
const MAX_SHOWN = 100;
const REMARKS_MAX = 200;

const lineFrom = (l, again) => ({
  itemCode: l.itemCode,
  name: l.name,
  sapItemCode: l.sapItemCode,
  requested: Number(l.qty || 0),
  unit: l.unit || "",
  // Making it again after SAP refused it starts from what was sent last time.
  qty: String(again && l.orderQty > 0 ? l.orderQty : l.qty || ""),
  price: again && l.price > 0 ? String(l.price) : "",
  taxCode: again ? l.taxCode || "" : "",
});

const PurchaseOrderModal = ({ request, onClose, onSaved }) => {
  const { showToast } = useNotifications();
  const again = request.order?.status === "Failed";
  const [published, setPublished] = useState(null);
  const [vendorCode, setVendorCode] = useState(again ? request.order.vendorCode : "");
  const [term, setTerm] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const searchRef = useRef(null);
  const [poDate, setPoDate] = useState(today());
  const [dueDate, setDueDate] = useState(() => {
    const wanted = String((again && request.order.dueDate) || request.requiredBy || "").slice(0, 10);
    return wanted && wanted >= today() ? wanted : today();
  });
  const [remarks, setRemarks] = useState(again ? request.order.remarks || "" : "");
  const [lines, setLines] = useState(() => (request.lines || []).map((l) => lineFrom(l, again)));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    API.get("/purchase-requests/vendors", { params: { company: request.company } })
      .then(({ data }) => setPublished(data))
      .catch((e) => {
        setPublished({ vendors: [], taxCodes: [] });
        setError(e.response?.data?.message || "Could not load the SAP suppliers.");
      });
  }, [request.company]);

  const vendors = useMemo(() => published?.vendors || [], [published]);
  const taxCodes = published?.taxCodes || [];
  const vendor = vendors.find((v) => v.code === vendorCode) || null;

  const matches = useMemo(() => {
    const q = term.trim().toLowerCase();
    return q
      ? vendors.filter((v) => `${v.name} ${v.code}`.toLowerCase().includes(q))
      : vendors;
  }, [vendors, term]);
  const shown = matches.slice(0, MAX_SHOWN);

  useEffect(() => {
    if (open) document.getElementById(`po-vendor-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const pick = (v) => {
    setVendorCode(v.code);
    setTerm("");
    setActive(0);
    setOpen(false);
  };

  const onSearchKey = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) setOpen(true);
      else setActive((i) => Math.min(i + 1, Math.max(shown.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && open) {
      e.preventDefault();
      if (shown[active]) pick(shown[active]);
    } else if (e.key === "Escape" && open) {
      e.stopPropagation();
      setOpen(false);
    }
  };

  const setLine = (code, key, value) =>
    setLines((prev) => prev.map((l) => (l.itemCode === code ? { ...l, [key]: value } : l)));

  // Before tax: a line left on SAP's default tax code has no rate this side.
  const total = lines.reduce((sum, l) => {
    const qty = Number(l.qty);
    const price = Number(l.price);
    return qty > 0 && price > 0 ? sum + qty * price : sum;
  }, 0);

  const validate = () => {
    if (!vendor) return "Choose the vendor.";
    if (!poDate) return "Give the PO date.";
    if (!dueDate) return "Give the delivery date.";
    if (dueDate < poDate) return "The delivery date cannot be before the PO date.";
    if (remarks.trim().length > REMARKS_MAX) return `Keep the remarks to ${REMARKS_MAX} characters.`;
    let ordered = 0;
    for (const l of lines) {
      const qty = Number(l.qty || 0);
      if (!(qty > 0)) continue;
      if (qty > l.requested) return `Only ${l.requested} of ${l.name} was requested.`;
      if (!(Number(l.price) > 0)) return `Give the price for ${l.name}.`;
      ordered += 1;
    }
    if (!ordered) return "Order at least one item.";
    return "";
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const problem = validate();
    setError(problem);
    if (problem) return;
    try {
      setSaving(true);
      const { data } = await API.post(`/purchase-requests/${request.id}/order`, {
        vendorCode,
        poDate,
        dueDate,
        remarks: remarks.trim(),
        lines: lines.map((l) => ({
          itemCode: l.itemCode,
          qty: Number(l.qty || 0),
          price: Number(l.price || 0),
          taxCode: l.taxCode,
        })),
      });
      showToast(`PO for ${data.id} saved. The SAP sync posts it.`, "success");
      onSaved?.(data);
      onClose();
    } catch (err) {
      setError(err.response?.data?.message || "Could not save the purchase order.");
    } finally {
      setSaving(false);
    }
  };

  const noVendors = published && vendors.length === 0;

  return (
    <div className="modal max-w-5xl">
      <div className="modal-head">
        <div className="min-w-0">
          <h3 className="modal-title">
            <FileText className="h-[18px] w-[18px] text-brand-700 shrink-0" />
            {again ? "Make the PO again" : "Make PO"}
          </h3>
          <p className="modal-sub">
            {request.id}
            {request.sapDocNumber ? ` · SAP PR ${request.sapDocNumber}` : ""} ·{" "}
            {request.companyName || request.company}
          </p>
        </div>
        <button onClick={onClose} className="modal-close" aria-label="Close">
          <X className="h-5 w-5" />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="contents" noValidate>
        <div className="modal-body space-y-4">
          {!published ? (
            <div className="flex items-center gap-2 text-slate-500 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading the SAP suppliers…
            </div>
          ) : noVendors ? (
            <div className="note note-amber">
              <AlertCircle className="h-4 w-4 shrink-0 mt-px" />
              <span>
                The SAP sync has not published the supplier list for {request.company} yet, so a PO
                cannot be made here. It arrives with the next sync.
              </span>
            </div>
          ) : (
            <>
              <div className="relative">
                <label className="field-label" htmlFor="po-vendor">
                  Vendor
                </label>
                {vendor && !open ? (
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(true);
                      setTimeout(() => searchRef.current?.focus(), 0);
                    }}
                    className="field flex items-center justify-between gap-3 text-left cursor-pointer"
                  >
                    <span className="min-w-0 truncate">
                      {vendor.name} <span className="mono text-[11px] text-slate-500">{vendor.code}</span>
                    </span>
                    <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
                  </button>
                ) : (
                  <div className="relative">
                    <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-slate-400 pointer-events-none">
                      <Search className="h-4 w-4" />
                    </span>
                    <input
                      id="po-vendor"
                      ref={searchRef}
                      type="text"
                      role="combobox"
                      aria-expanded={open}
                      aria-controls="po-vendors"
                      aria-autocomplete="list"
                      value={term}
                      onChange={(e) => {
                        setTerm(e.target.value);
                        setActive(0);
                        setOpen(true);
                      }}
                      onFocus={() => setOpen(true)}
                      onClick={() => setOpen(true)}
                      onBlur={() => setOpen(false)}
                      onKeyDown={onSearchKey}
                      placeholder={`Search ${vendors.length} suppliers by name or code…`}
                      className="field field-search"
                      autoComplete="off"
                    />
                  </div>
                )}
                {open && (
                  <ul
                    id="po-vendors"
                    role="listbox"
                    className="mt-1 max-h-60 overflow-y-auto divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white"
                  >
                    {shown.length === 0 ? (
                      <li className="px-3 py-2 text-[13px] text-slate-500">No supplier matches.</li>
                    ) : (
                      shown.map((v, i) => (
                        <li key={v.code} id={`po-vendor-${i}`} role="option" aria-selected={i === active}>
                          <button
                            type="button"
                            tabIndex={-1}
                            onMouseDown={(e) => e.preventDefault()}
                            onMouseEnter={() => setActive(i)}
                            onClick={() => pick(v)}
                            className={`flex w-full items-baseline justify-between gap-3 px-3 py-2 text-left text-[13px] ${
                              i === active ? "bg-slate-100" : "hover:bg-slate-50"
                            }`}
                          >
                            <span className="min-w-0 text-slate-800">{v.name}</span>
                            <span className="mono whitespace-nowrap text-[11px] text-slate-500">{v.code}</span>
                          </button>
                        </li>
                      ))
                    )}
                    {matches.length > shown.length && (
                      <li className="px-3 py-2 text-[12px] text-slate-500">
                        Showing {shown.length} of {matches.length}. Type to narrow the list.
                      </li>
                    )}
                  </ul>
                )}
              </div>

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
                    value={dueDate}
                    min={poDate || undefined}
                    onChange={(e) => setDueDate(e.target.value)}
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
                        <th className="text-right">Requested</th>
                        <th>Order qty</th>
                        <th>Unit price (₹)</th>
                        <th>Tax code</th>
                        <th className="text-right">Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((l) => {
                        const value = Number(l.qty) > 0 && Number(l.price) > 0 ? Number(l.qty) * Number(l.price) : 0;
                        return (
                          <tr key={l.itemCode}>
                            <td>
                              <div className="min-w-[160px] max-w-[280px]">
                                <div className="cell-title break-words leading-snug">{l.name}</div>
                                <div className="mono text-[11px] text-slate-500">SAP {l.sapItemCode || l.itemCode}</div>
                              </div>
                            </td>
                            <td className="text-right whitespace-nowrap text-slate-700">
                              {l.requested} {l.unit}
                            </td>
                            <td>
                              <input
                                type="number"
                                min="0"
                                max={l.requested}
                                step="any"
                                inputMode="decimal"
                                value={l.qty}
                                onChange={(ev) => setLine(l.itemCode, "qty", ev.target.value)}
                                className="field field-sm w-24"
                                aria-label={`Order quantity of ${l.name}`}
                              />
                            </td>
                            <td>
                              <input
                                type="number"
                                min="0"
                                step="any"
                                inputMode="decimal"
                                value={l.price}
                                onChange={(ev) => setLine(l.itemCode, "price", ev.target.value)}
                                className="field field-sm w-28"
                                aria-label={`Unit price of ${l.name}`}
                              />
                            </td>
                            <td>
                              <select
                                value={l.taxCode}
                                onChange={(ev) => setLine(l.itemCode, "taxCode", ev.target.value)}
                                className="field field-sm w-40 cursor-pointer"
                                aria-label={`Tax code for ${l.name}`}
                              >
                                <option value="">SAP default</option>
                                {taxCodes.map((t) => (
                                  <option key={t.code} value={t.code}>
                                    {t.code}
                                    {t.rate !== undefined && t.rate !== null ? ` · ${t.rate}%` : ""}
                                    {t.name && t.name !== t.code ? ` · ${t.name}` : ""}
                                  </option>
                                ))}
                              </select>
                            </td>
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
                  <span className="text-[12px] text-slate-500">
                    PO value, before tax. A quantity of 0 leaves the line off the PO.
                  </span>
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
            </>
          )}

          {error && <div className="note note-rose text-sm">{error}</div>}
        </div>

        <div className="modal-foot">
          <button type="button" onClick={onClose} className="btn btn-neutral">
            Cancel
          </button>
          <button type="submit" disabled={saving || !published || noVendors} className="btn btn-primary">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Save PO for SAP
          </button>
        </div>
      </form>
    </div>
  );
};

export default PurchaseOrderModal;
