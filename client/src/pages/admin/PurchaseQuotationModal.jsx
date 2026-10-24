import { useEffect, useMemo, useRef, useState } from "react";
import API from "../../services/api";
import { useNotifications } from "../../context/NotificationContext";
import { formatCurrency } from "../../utils/currency";
import { hsnDigits, hsnProblem } from "../../utils/hsn";
import { AlertCircle, ChevronDown, FileText, Loader2, Search, X } from "lucide-react";

/**
 * The chosen vendor's quotation, entered against a purchase request (24 Oct
 * 2026). Vendors quote outside the system and management picks one; this
 * records that one, in the vendor's own unit, for the printout management signs
 * and the PO made from it once SAP has it.
 *
 * A request line goes on one quotation: lines already quoted or dropped are
 * shown, not offered. The vendors, tax codes and units are the ones the sync
 * publishes for the company - the server refuses anything else, so this offers
 * nothing else.
 *
 * An item with no HSN code asks for one on its line, as a goods receipt does:
 * SAP needs it on a line with a GST tax code. It is written onto the item too.
 *
 * Opened from a request card (`request`), from the quotation page with no
 * request (it asks which), or on a quotation SAP does not have yet to change it
 * (`quotation`).
 */

const pad = (n) => String(n).padStart(2, "0");
/** Local date; toISOString would give yesterday for the first hours of an Indian day. */
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => ymd(new Date());
const plusDays = (day, n) => {
  const d = new Date(`${day}T00:00:00`);
  d.setDate(d.getDate() + n);
  return ymd(d);
};

/** The dropdown lists this many at most; typing narrows it. A company may have hundreds. */
const MAX_SHOWN = 100;
const REMARKS_MAX = 200;

/** One row per request line: offered when open (or already this quotation's), shown otherwise. */
const rowsFor = (request, quotation) => {
  const quoted = new Map((quotation?.lines || []).map((l) => [l.prLine, l]));
  return (request?.lines || []).map((l) => {
    const mine = quoted.get(l.lineId);
    const open = !l.coverage || (quotation && l.quotation === quotation.id);
    return {
      lineId: l.lineId,
      itemCode: l.itemCode,
      name: l.name,
      sapItemCode: l.sapItemCode,
      requested: l.qty,
      unit: l.unit,
      coverage: l.coverage,
      quotation: l.quotation,
      open,
      include: open && (!quotation || Boolean(mine)),
      vendorUnit: mine?.vendorUnit || "",
      qty: mine ? String(mine.qty) : "",
      price: mine ? String(mine.price) : "",
      taxCode: mine?.taxCode || "",
      hsnCode: mine?.hsnCode || "",
      // An HSN this quotation brought stays editable: saving it already put it on the item.
      broughtHsn: Boolean(mine?.hsnCode),
    };
  });
};

const PurchaseQuotationModal = ({ request: given = null, quotation = null, onClose, onSaved }) => {
  const { showToast } = useNotifications();
  const editing = Boolean(quotation);
  const [request, setRequest] = useState(given);
  const [choices, setChoices] = useState(null);
  const [published, setPublished] = useState(null);
  const [vendorCode, setVendorCode] = useState(quotation?.vendorCode || "");
  const [term, setTerm] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const searchRef = useRef(null);
  const [quotationDate, setQuotationDate] = useState(String(quotation?.date || today()).slice(0, 10));
  const [validUntil, setValidUntil] = useState(String(quotation?.validUntil || plusDays(today(), 30)).slice(0, 10));
  const [remarks, setRemarks] = useState(quotation?.remarks || "");
  const [rows, setRows] = useState(() => rowsFor(given, quotation));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Changing a quotation: its request, as it stands now.
  useEffect(() => {
    if (!quotation) return;
    API.get(`/purchase-requests/${quotation.request}`)
      .then(({ data }) => {
        setRequest(data);
        setRows(rowsFor(data, quotation));
      })
      .catch((e) => setError(e.response?.data?.message || "Could not load the purchase request."));
  }, [quotation]);

  // Opened from the quotation page: which request it is for.
  useEffect(() => {
    if (given || quotation) return;
    API.get("/purchase-quotations/requests")
      .then(({ data }) => setChoices(Array.isArray(data) ? data : []))
      .catch((e) => {
        setChoices([]);
        setError(e.response?.data?.message || "Could not load the purchase requests.");
      });
  }, [given, quotation]);

  const company = request?.company;
  useEffect(() => {
    if (!company) return;
    setPublished(null);
    API.get("/purchase-quotations/options", { params: { company } })
      .then(({ data }) => setPublished(data))
      .catch((e) => {
        setPublished({ vendors: [], taxCodes: [], units: [] });
        setError(e.response?.data?.message || "Could not load the SAP lists.");
      });
  }, [company]);

  const vendors = useMemo(() => published?.vendors || [], [published]);
  const units = useMemo(() => published?.units || [], [published]);
  const vendor = vendors.find((v) => v.code === vendorCode) || null;
  // The item's own HSN, from the catalog; "" when it has none and the line must bring one.
  const itemHsn = (code) => hsnDigits(published?.itemHsn?.[code]);
  // The HSN a row stands on without asking: the item's own, when SAP has that code and this quotation did not
  // bring it. Otherwise the line carries it, so a code SAP has not got is still asked for. Mirrors checkQuotation.
  const ownHsn = (r) => {
    const h = itemHsn(r.itemCode);
    const list = published?.hsn || [];
    return !h || r.broughtHsn || (list.length && !list.includes(h)) ? "" : h;
  };
  // Only the GST codes of the kind this supplier needs: CGST+SGST in the company's
  // own state, IGST from another (SAP refuses the rest). Mirrors gstKindFor on the
  // server, which refuses a mismatch; with either state unknown, every code is offered.
  const companyState = String(published?.companyState || "").trim().toUpperCase();
  const vendorState = String(vendor?.state || "").trim().toUpperCase();
  const gstKind = companyState && vendorState ? (companyState === vendorState ? "cgst_sgst" : "igst") : null;
  const taxCodes = useMemo(() => {
    const all = published?.taxCodes || [];
    return gstKind ? all.filter((t) => t.kind === gstKind) : all;
  }, [published, gstKind]);

  // A code picked for another supplier, of the other kind, is cleared rather than kept.
  useEffect(() => {
    if (!gstKind) return;
    const ok = new Set(taxCodes.map((t) => t.code));
    setRows((prev) => (prev.some((r) => r.taxCode && !ok.has(r.taxCode)) ? prev.map((r) => (r.taxCode && !ok.has(r.taxCode) ? { ...r, taxCode: "" } : r)) : prev));
  }, [gstKind, taxCodes]);

  const matches = useMemo(() => {
    const q = term.trim().toLowerCase();
    return q ? vendors.filter((v) => `${v.name} ${v.code}`.toLowerCase().includes(q)) : vendors;
  }, [vendors, term]);
  const shown = matches.slice(0, MAX_SHOWN);

  useEffect(() => {
    if (open) document.getElementById(`pq-vendor-${active}`)?.scrollIntoView({ block: "nearest" });
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

  const chooseRequest = (id) => {
    const r = (choices || []).find((c) => c.id === id) || null;
    setRequest(r);
    setRows(rowsFor(r, null));
    setVendorCode("");
    setError("");
  };

  const setRow = (lineId, key, value) =>
    setRows((prev) => prev.map((r) => (r.lineId === lineId ? { ...r, [key]: value } : r)));

  // The request's own unit is the likeliest vendor unit, when SAP has it -
  // in SAP's spelling, since the item says "Nos" where SAP says "NOS".
  useEffect(() => {
    if (!units.length) return;
    const sap = (unit) => units.find((u) => u.toUpperCase() === String(unit || "").toUpperCase()) || "";
    setRows((prev) => prev.map((r) => (r.vendorUnit ? r : { ...r, vendorUnit: sap(r.unit) })));
  }, [units]);

  const included = rows.filter((r) => r.include);
  // The HSN column only when a line on the quotation is for an item that has none.
  const needsHsn = included.some((r) => !ownHsn(r));

  // An item that carries an HSN SAP has not got yet offers it, so the line asks SAP for it rather than typing it again.
  useEffect(() => {
    const list = published?.hsn || [];
    if (!list.length) return;
    setRows((prev) =>
      prev.some((r) => !r.hsnCode && hsnDigits(published?.itemHsn?.[r.itemCode]) && !list.includes(hsnDigits(published?.itemHsn?.[r.itemCode])))
        ? prev.map((r) => {
            const h = hsnDigits(published?.itemHsn?.[r.itemCode]);
            return !r.hsnCode && h && !list.includes(h) ? { ...r, hsnCode: h } : r;
          })
        : prev
    );
  }, [published, request]);
  // Before tax: the tax codes carry their rates in SAP.
  const total = included.reduce((sum, r) => {
    const qty = Number(r.qty);
    const price = Number(r.price);
    return qty > 0 && price > 0 ? sum + qty * price : sum;
  }, 0);

  const validate = () => {
    if (!request) return "Choose the purchase request.";
    if (!vendor) return "Choose the vendor.";
    if (!quotationDate) return "Give the quotation date.";
    if (quotationDate > today()) return "The quotation date cannot be in the future.";
    if (!validUntil) return "Give the date the quotation is valid until.";
    if (validUntil < quotationDate) return "The quotation cannot expire before its own date.";
    if (remarks.trim().length > REMARKS_MAX) return `Keep the remarks to ${REMARKS_MAX} characters.`;
    if (!included.length) return "Quote at least one item.";
    for (const r of included) {
      if (!r.vendorUnit) return `Give the vendor's unit for ${r.name}.`;
      if (!(Number(r.qty) > 0)) return `Give the quantity for ${r.name}.`;
      if (!(Number(r.price) > 0)) return `Give the unit price for ${r.name}.`;
      if (!r.taxCode) return `Give the tax code for ${r.name}.`;
      if (!ownHsn(r)) {
        const hsn = hsnDigits(r.hsnCode);
        if (!hsn) return `${r.name} has no HSN code. Give it - SAP needs one on a line with a GST tax code.`;
        const problem = hsnProblem(hsn);
        if (problem) return `${r.name}: HSN ${hsn} - ${problem}.`;
      }
    }
    return "";
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const problem = validate();
    setError(problem);
    if (problem) return;
    const payload = {
      request: request.id,
      vendorCode,
      quotationDate,
      validUntil,
      remarks: remarks.trim(),
      lines: included.map((r) => ({
        lineId: r.lineId,
        vendorUnit: r.vendorUnit,
        qty: Number(r.qty),
        price: Number(r.price),
        taxCode: r.taxCode,
        hsnCode: ownHsn(r) ? "" : hsnDigits(r.hsnCode),
      })),
    };
    try {
      setSaving(true);
      const { data } = editing
        ? await API.put(`/purchase-quotations/${quotation.id}`, payload)
        : await API.post("/purchase-quotations", payload);
      showToast(`Quotation ${data.id} saved. The SAP sync posts it.`, "success");
      onSaved?.(data);
      onClose();
    } catch (err) {
      setError(err.response?.data?.message || "Could not save the quotation.");
    } finally {
      setSaving(false);
    }
  };

  const loadingLists = request && !published;
  const missing = published && (!vendors.length || !units.length);

  return (
    <div className="modal max-w-6xl">
      <div className="modal-head">
        <div className="min-w-0">
          <h3 className="modal-title">
            <FileText className="h-[18px] w-[18px] text-brand-700 shrink-0" />
            {editing ? `Change quotation ${quotation.id}` : "New quotation"}
          </h3>
          {request && (
            <p className="modal-sub">
              {request.id}
              {request.sapDocNumber ? ` · SAP PR ${request.sapDocNumber}` : ""} · {request.companyName || request.company}
            </p>
          )}
        </div>
        <button onClick={onClose} className="modal-close" aria-label="Close">
          <X className="h-5 w-5" />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="contents" noValidate>
        <div className="modal-body space-y-4">
          {!given && !editing && (
            <div>
              <label className="field-label" htmlFor="pq-request">
                Purchase request
              </label>
              {!choices ? (
                <div className="flex items-center gap-2 text-slate-500 text-sm">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading the purchase requests…
                </div>
              ) : choices.length === 0 ? (
                <div className="note note-amber">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-px" />
                  <span>No purchase request in SAP has a line waiting for a quotation.</span>
                </div>
              ) : (
                <select
                  id="pq-request"
                  value={request?.id || ""}
                  onChange={(e) => chooseRequest(e.target.value)}
                  className="field cursor-pointer"
                >
                  <option value="">Choose a purchase request…</option>
                  {choices.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.id}
                      {c.sapDocNumber ? ` · SAP PR ${c.sapDocNumber}` : ""} · {c.companyName || c.company}
                      {c.reason ? ` · ${c.reason.slice(0, 60)}` : ""}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          {!request ? null : loadingLists ? (
            <div className="flex items-center gap-2 text-slate-500 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading the SAP suppliers, tax codes and units…
            </div>
          ) : missing ? (
            <div className="note note-amber">
              <AlertCircle className="h-4 w-4 shrink-0 mt-px" />
              <span>
                The SAP sync has not published the {vendors.length ? "unit" : "supplier"} list for {request.company} yet,
                so a quotation cannot be entered. It arrives with the next sync.
              </span>
            </div>
          ) : (
            <>
              {request.reason && <p className="text-xs text-slate-600 italic">“{request.reason}”</p>}

              <div className="relative">
                <label className="field-label" htmlFor="pq-vendor">
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
                      id="pq-vendor"
                      ref={searchRef}
                      type="text"
                      role="combobox"
                      aria-expanded={open}
                      aria-controls="pq-vendors"
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
                    id="pq-vendors"
                    role="listbox"
                    className="mt-1 max-h-60 overflow-y-auto divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white"
                  >
                    {shown.length === 0 ? (
                      <li className="px-3 py-2 text-[13px] text-slate-500">No supplier matches.</li>
                    ) : (
                      shown.map((v, i) => (
                        <li key={v.code} id={`pq-vendor-${i}`} role="option" aria-selected={i === active}>
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
                {vendor && gstKind && (
                  <p className="mt-1.5 text-[12px] text-slate-500">
                    {gstKind === "cgst_sgst"
                      ? `${vendor.name} is in ${vendorState}, the company's own state: CGST+SGST tax codes only.`
                      : `${vendor.name} is in ${vendorState}, another state than the company's (${companyState}): IGST tax codes only.`}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3 sm:max-w-md">
                <div>
                  <label className="field-label" htmlFor="pq-date">
                    Quotation date
                  </label>
                  <input
                    id="pq-date"
                    type="date"
                    value={quotationDate}
                    max={today()}
                    onChange={(e) => setQuotationDate(e.target.value)}
                    className="field"
                    required
                  />
                </div>
                <div>
                  <label className="field-label" htmlFor="pq-valid">
                    Valid until
                  </label>
                  <input
                    id="pq-valid"
                    type="date"
                    value={validUntil}
                    min={quotationDate || undefined}
                    onChange={(e) => setValidUntil(e.target.value)}
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
                        <th className="w-8">
                          <span className="sr-only">Quote</span>
                        </th>
                        <th>Item</th>
                        <th className="text-right">Requested</th>
                        <th>Vendor unit</th>
                        <th>Qty</th>
                        <th>Unit price (₹)</th>
                        <th>Tax code</th>
                        {needsHsn && <th>HSN</th>}
                        <th className="text-right">Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => {
                        const value = r.include && Number(r.qty) > 0 && Number(r.price) > 0 ? Number(r.qty) * Number(r.price) : 0;
                        return (
                          <tr key={r.lineId} className={r.open ? "" : "opacity-60"}>
                            <td>
                              <input
                                type="checkbox"
                                checked={r.include}
                                disabled={!r.open}
                                onChange={(ev) => setRow(r.lineId, "include", ev.target.checked)}
                                className="h-4 w-4 cursor-pointer accent-brand-600"
                                aria-label={`Quote ${r.name}`}
                              />
                            </td>
                            <td>
                              <div className="min-w-[160px] max-w-[260px]">
                                <div className="cell-title break-words leading-snug">{r.name}</div>
                                <div className="mono text-[11px] text-slate-500">SAP {r.sapItemCode}</div>
                                {!r.open && (
                                  <div className="text-[11px] text-slate-500">
                                    {r.coverage === "Dropped" ? "Dropped" : `On quotation ${r.quotation}`}
                                  </div>
                                )}
                              </div>
                            </td>
                            <td className="text-right whitespace-nowrap text-slate-700">
                              {r.requested} {r.unit}
                            </td>
                            {r.include ? (
                              <>
                                <td>
                                  <select
                                    value={r.vendorUnit}
                                    onChange={(ev) => setRow(r.lineId, "vendorUnit", ev.target.value)}
                                    className="field field-sm w-28 cursor-pointer"
                                    aria-label={`Vendor unit for ${r.name}`}
                                  >
                                    <option value="">Unit…</option>
                                    {units.map((u) => (
                                      <option key={u} value={u}>
                                        {u}
                                      </option>
                                    ))}
                                  </select>
                                </td>
                                <td>
                                  <input
                                    type="number"
                                    min="0"
                                    step="any"
                                    inputMode="decimal"
                                    value={r.qty}
                                    onChange={(ev) => setRow(r.lineId, "qty", ev.target.value)}
                                    className="field field-sm w-24"
                                    aria-label={`Quantity of ${r.name} in the vendor's unit`}
                                  />
                                </td>
                                <td>
                                  <input
                                    type="number"
                                    min="0"
                                    step="any"
                                    inputMode="decimal"
                                    value={r.price}
                                    onChange={(ev) => setRow(r.lineId, "price", ev.target.value)}
                                    className="field field-sm w-28"
                                    aria-label={`Unit price of ${r.name} per vendor unit`}
                                  />
                                </td>
                                <td>
                                  <select
                                    value={r.taxCode}
                                    onChange={(ev) => setRow(r.lineId, "taxCode", ev.target.value)}
                                    className="field field-sm w-40 cursor-pointer"
                                    aria-label={`Tax code for ${r.name}`}
                                  >
                                    <option value="">Tax code…</option>
                                    {taxCodes.map((t) => (
                                      <option key={t.code} value={t.code}>
                                        {t.code}
                                        {t.rate !== undefined && t.rate !== null ? ` · ${t.rate}%` : ""}
                                        {t.name && t.name !== t.code ? ` · ${t.name}` : ""}
                                      </option>
                                    ))}
                                  </select>
                                </td>
                                {needsHsn && (
                                  <td>
                                    {ownHsn(r) ? (
                                      <span className="mono text-[12px] text-slate-500" title="The item's own HSN">
                                        {ownHsn(r)}
                                      </span>
                                    ) : (
                                      <input
                                        type="text"
                                        inputMode="numeric"
                                        value={r.hsnCode}
                                        onChange={(ev) => setRow(r.lineId, "hsnCode", ev.target.value)}
                                        placeholder="Item has none"
                                        className="field field-sm w-32"
                                        aria-label={`HSN code for ${r.name}`}
                                      />
                                    )}
                                  </td>
                                )}
                                <td className="text-right whitespace-nowrap tabular-nums text-slate-800">
                                  {value ? formatCurrency(value) : "—"}
                                </td>
                              </>
                            ) : (
                              <td colSpan={needsHsn ? 6 : 5} className="text-[12px] text-slate-400">
                                {r.open ? "Not on this quotation" : ""}
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="flex items-baseline justify-between gap-3 border-t border-slate-200 px-4 py-3">
                  <span className="text-[12px] text-slate-500">
                    Quotation value, before tax. Quantities and prices are in the vendor's unit.
                  </span>
                  <span className="text-base font-bold tabular-nums text-slate-900">{formatCurrency(total)}</span>
                </div>
              </div>

              <div>
                <label className="field-label" htmlFor="pq-remarks">
                  Remarks
                </label>
                <textarea
                  id="pq-remarks"
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  className="field field-area"
                  rows={2}
                  maxLength={REMARKS_MAX}
                  placeholder="Optional - printed on the quotation, and goes to its comments in SAP"
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
          <button type="submit" disabled={saving || !request || !published || missing} className="btn btn-primary">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Save quotation for SAP
          </button>
        </div>
      </form>
    </div>
  );
};

export default PurchaseQuotationModal;
