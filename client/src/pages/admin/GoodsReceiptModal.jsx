import { useEffect, useMemo, useRef, useState } from "react";
import API from "../../services/api";
import { useNotifications } from "../../context/NotificationContext";
import { describeWhen } from "../../hooks/useFormDraft";
import { formatCurrency } from "../../utils/currency";
import { AlertCircle, Loader2, RefreshCw, Truck, X } from "lucide-react";
import { hsnDigits, hsnProblem } from "../../utils/hsn";

/**
 * Goods receipt: stock in from a supplier's bill, against an open purchase
 * order (decided 9 Oct 2026).
 *
 * Two kinds of PO are offered:
 *
 *   SAP POs        the open POs a snapshot from the SAP server lists - made in
 *                  SAP, or on a request before quotations. Vendor and price
 *                  come from the PO; the store enters the quantity received on
 *                  each line, in the item's own unit.
 *   CMMS POs       made from a quotation (24 Oct 2026, phase 4), in the
 *                  vendor's unit. Per line the store enters the billed qty and
 *                  the bill price per vendor unit (the quoted price unless the
 *                  bill says otherwise), and what came in: the quantity in the
 *                  item's own unit, or how many of those per vendor unit. The
 *                  cost per unit follows from the bill, and the bill is the
 *                  value booked.
 *
 * Either way the store enters the bill number and date, and from the bill each
 * line's tax code - the one document that asks for it (27 Oct 2026). HSN and
 * tax rate are asked only for an item that has none; an item's own are shown
 * and cannot be changed. The record is queued and the SAP server
 * posts the GRPO and the ERPNext receipt within about a minute. An item at nil
 * value takes this receipt's cost as its value.
 *
 * "Refresh from SAP" asks the SAP server for a new snapshot and waits for it.
 */

/** Today as YYYY-MM-DD in local time; toISOString would give yesterday's date
    for the first five and a half hours of an Indian day. */
const today = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const POLL_MS = 5000;
// About two minutes of waiting for the SAP server before giving up on it.
const POLL_TRIES = 24;

/** CGST+SGST from a supplier in the company's own state, IGST from another; null when either is not known. Mirrors gstKindFor. */
const gstKindFor = (supplierState, companyState) => {
  const a = String(supplierState || "").trim().toUpperCase();
  const b = String(companyState || "").trim().toUpperCase();
  return a && b ? (a === b ? "cgst_sgst" : "igst") : null;
};

/** A box left empty, or a number. */
const num = (value) => (String(value ?? "").trim() === "" ? null : Number(value));
/** ERPNext keeps quantities to 3 decimals; the server rounds the same way. */
const qty3 = (value) => Math.round(value * 1000) / 1000;
const keyOf = (p) => String(p.order || p.entry);

/**
 * What a CMMS PO line comes to, as typed: the received qty (typed, or billed x
 * ratio), the bill price (the quote when left empty), the line value and the
 * cost per inventory unit. Null fields where nothing usable is typed yet.
 */
const orderLine = (l, e = {}) => {
  const vendorQty = num(e.vendorQty);
  const price = num(e.billPrice) ?? Number(l.price || 0);
  const ratio = num(e.ratio);
  const typedQty = num(e.receivedQty);
  const receivedQty =
    e.mode === "ratio"
      ? vendorQty > 0 && ratio > 0
        ? qty3(vendorQty * ratio)
        : null
      : typedQty > 0
        ? qty3(typedQty)
        : null;
  const value = vendorQty > 0 && price > 0 ? Math.round(vendorQty * price * 100) / 100 : null;
  return {
    vendorQty,
    price,
    receivedQty,
    value,
    cost: value !== null && receivedQty ? value / receivedQty : null,
    started: [e.vendorQty, e.receivedQty, e.ratio].some((v) => num(v)),
    changed: Math.abs(price - Number(l.price || 0)) >= 0.005,
  };
};

const GoodsReceiptModal = ({ onClose, onSaved }) => {
  const { showToast } = useNotifications();
  const [companies, setCompanies] = useState(null);
  const [company, setCompany] = useState("");
  const [snapshot, setSnapshot] = useState(null);
  const [poLoading, setPoLoading] = useState(false);
  // The CMMS PO name for a PO made from a quotation, else the SAP DocEntry.
  const [poKey, setPoKey] = useState("");
  // Per PO line, keyed by its line: { qty, taxCode, hsnCode, taxRate }, or for a CMMS PO
  // { vendorQty, billPrice, receivedQty, ratio, mode, taxCode, hsnCode, taxRate }.
  const [entries, setEntries] = useState({});
  const [billNo, setBillNo] = useState("");
  const [billDate, setBillDate] = useState(today());
  const [remarks, setRemarks] = useState("");
  const [waitingOnSap, setWaitingOnSap] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const pollTimer = useRef(null);

  const companyOptions = useMemo(
    () => (companies || []).find((c) => c.abbr === company) || null,
    [companies, company]
  );
  const po = useMemo(() => (snapshot?.pos || []).find((p) => keyOf(p) === poKey) || null, [snapshot, poKey]);
  const isOrder = Boolean(po?.order);

  // The companies, with each one's HSN and tax-rate lists.
  useEffect(() => {
    API.get("/naming-requests/options")
      .then(({ data }) => {
        const list = Array.isArray(data) ? data : [];
        setCompanies(list);
        if (list.length === 1) setCompany(list[0].abbr);
      })
      .catch((e) => setError(e.response?.data?.message || "Could not load the SAP companies."));
  }, []);

  // A pending poll must not outlive the dialog.
  useEffect(() => () => pollTimer.current && clearTimeout(pollTimer.current), []);

  const loadPos = async (abbr) => {
    const { data } = await API.get("/goods-receipts/open-po", { params: { company: abbr } });
    setSnapshot(data);
    return data;
  };

  useEffect(() => {
    setSnapshot(null);
    setPoKey("");
    setEntries({});
    if (!company) return undefined;
    let live = true;
    setPoLoading(true);
    API.get("/goods-receipts/open-po", { params: { company } })
      .then(({ data }) => live && setSnapshot(data))
      .catch((e) => live && setError(e.response?.data?.message || "Could not load the open purchase orders."))
      .finally(() => live && setPoLoading(false));
    return () => {
      live = false;
    };
  }, [company]);

  // Pre-fill each line: the item's own HSN and tax rate, which stand (an item
  // without them takes the bill's), and on a CMMS PO the quoted price. The tax
  // code starts empty: it is read off the bill. Entries already typed for a
  // line that is still there are kept, so a refresh does not wipe them.
  useEffect(() => {
    if (!po) return;
    setEntries((prev) => {
      const next = {};
      for (const l of po.lines) {
        next[l.line] =
          prev[l.line] ||
          (po.order
            ? {
                vendorQty: "",
                billPrice: String(l.price ?? ""),
                receivedQty: "",
                ratio: "",
                mode: "qty",
                taxCode: "",
                hsnCode: l.hsnCode || "",
                taxRate: l.taxRate || "",
              }
            : { qty: "", taxCode: "", hsnCode: l.hsnCode || "", taxRate: l.taxRate || "" });
      }
      return next;
    });
  }, [po]);

  // A refresh can close the chosen PO (received in full, or cancelled in SAP).
  useEffect(() => {
    if (snapshot && poKey && !po) {
      setPoKey("");
      setEntries({});
    }
  }, [snapshot, poKey, po]);

  const handlePoChange = (value) => {
    setPoKey(value);
    setEntries({});
  };

  const setEntry = (line, key, value) =>
    setEntries((prev) => ({ ...prev, [line]: { ...prev[line], [key]: value } }));
  // The received qty and the ratio are two ways of saying one thing: the last one typed counts.
  const setReceived = (line, key, value) =>
    setEntries((prev) => ({ ...prev, [line]: { ...prev[line], [key]: value, mode: key === "ratio" ? "ratio" : "qty" } }));

  /** Asks the SAP server to re-read the open POs, then waits for the new
      snapshot: done when it is no longer refreshing and its time has moved. */
  const refreshFromSap = async () => {
    if (!company || waitingOnSap) return;
    setError("");
    const before = snapshot?.refreshedAt || null;
    const abbr = company;
    try {
      setWaitingOnSap(true);
      await API.post("/goods-receipts/refresh-po", { company: abbr });
    } catch (e) {
      setWaitingOnSap(false);
      setError(e.response?.data?.message || "Could not ask SAP for the purchase orders.");
      return;
    }

    let tries = 0;
    const poll = async () => {
      tries += 1;
      try {
        const data = await loadPos(abbr);
        if (!data.refreshing && data.refreshedAt && data.refreshedAt !== before) {
          setWaitingOnSap(false);
          showToast("Purchase orders read from SAP", "success");
          return;
        }
      } catch {
        // A missed poll is retried on the next tick.
      }
      if (tries >= POLL_TRIES) {
        setWaitingOnSap(false);
        setError("SAP has not answered yet. The list updates when it does; try again in a minute.");
        return;
      }
      pollTimer.current = setTimeout(poll, POLL_MS);
    };
    pollTimer.current = setTimeout(poll, POLL_MS);
  };

  const entered = useMemo(() => {
    if (!po) return [];
    if (po.order) return po.lines.filter((l) => orderLine(l, entries[l.line]).started);
    return po.lines.filter((l) => Number(entries[l.line]?.qty) > 0);
  }, [po, entries]);
  const billValue = entered.reduce(
    (sum, l) =>
      sum + (isOrder ? orderLine(l, entries[l.line]).value || 0 : Number(entries[l.line].qty) * Number(l.price || 0)),
    0
  );

  const validate = () => {
    if (!po) return "Pick a purchase order.";
    if (!billNo.trim()) return "Enter the bill number.";
    if (!billDate) return "Enter the bill date.";
    if (billDate > today()) return "The bill date cannot be in the future.";
    if (isOrder) {
      if (entered.length === 0) return "Enter the billed quantity on at least one line.";
      for (const l of entered) {
        const e = entries[l.line];
        const c = orderLine(l, e);
        if (!(c.vendorQty > 0)) return `${l.name}: enter the quantity on the bill, in ${l.vendorUnit}.`;
        if (c.vendorQty > Number(l.receivableQty) + 1e-9) {
          return `${l.name}: only ${l.receivableQty} ${l.vendorUnit} is still pending on this PO.`;
        }
        if (!(c.price > 0)) return `${l.name}: the bill price must be more than zero.`;
        if (!c.receivedQty) return `${l.name}: enter what came in, in ${l.unit}, or the ${l.unit} per ${l.vendorUnit}.`;
        const tax = billTaxProblem(l, e);
        if (tax) return `${l.name}: ${tax}`;
      }
      return "";
    }
    for (const l of po.lines) {
      const raw = entries[l.line]?.qty;
      if (raw !== "" && raw !== undefined && !(Number(raw) >= 0)) {
        return `${l.name}: the quantity received is not a valid number.`;
      }
    }
    if (entered.length === 0) return "Enter the quantity received on at least one line.";
    for (const l of entered) {
      const e = entries[l.line];
      if (Number(e.qty) > Number(l.receivableQty)) {
        return `${l.name}: only ${l.receivableQty} ${l.unit || ""} is still open on this PO.`;
      }
      const tax = billTaxProblem(l, e);
      if (tax) return `${l.name}: ${tax}`;
    }
    return "";
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const problem = validate();
    setError(problem);
    if (problem) return;
    const head = { company, billNo: billNo.trim(), billDate, remarks: remarks.trim() };
    const body = isOrder
      ? {
          ...head,
          purchaseOrder: po.order,
          lines: entered.map((l) => {
            const en = entries[l.line];
            const c = orderLine(l, en);
            return {
              orderLine: l.line,
              vendorQty: c.vendorQty,
              billPrice: c.price,
              ...(en.mode === "ratio" ? { ratio: num(en.ratio) } : { receivedQty: num(en.receivedQty) }),
              ...billTaxes(l, en),
            };
          }),
        }
      : {
          ...head,
          poEntry: po.entry,
          lines: entered.map((l) => ({
            poLine: l.line,
            qty: Number(entries[l.line].qty),
            ...billTaxes(l, entries[l.line]),
          })),
        };
    try {
      setSaving(true);
      await API.post("/goods-receipts", body);
      showToast(
        "Goods receipt saved. SAP posts it within a minute; the stock shows once it is posted.",
        "success"
      );
      onSaved?.();
      onClose();
    } catch (err) {
      setError(err.response?.data?.message || "Could not save the goods receipt.");
    } finally {
      setSaving(false);
    }
  };

  /**
   * The HSN typed for an item that has none, as the server will take it:
   * required, the shape of a real code, and either in SAP's list or new, which
   * the save asks SAP to add. An item's own HSN is not checked here - it stands.
   */
  const hsnCheck = (e) => {
    const digits = hsnDigits(e.hsnCode);
    if (!digits) return { error: "enter the HSN code from the bill." };
    const problem = hsnProblem(digits);
    if (problem) return { error: `${problem}.` };
    if ((companyOptions?.hsn || []).includes(digits)) return { digits };
    return { digits, isNew: true };
  };

  /** What a line still needs from the bill, or "" - mirrors billTaxes on the server. */
  const billTaxProblem = (l, e) => {
    if (!e.taxCode) return "pick the tax code from the bill.";
    if (!l.hsnCode) {
      const hsn = hsnCheck(e);
      if (hsn.error) return hsn.error;
    }
    if (!l.taxRate && !e.taxRate) return "pick the tax rate from the bill.";
    return "";
  };

  /** What a line sends: the tax code always, the HSN and tax rate only for an item without its own. */
  const billTaxes = (l, e) => ({
    taxCode: e.taxCode,
    hsnCode: l.hsnCode ? "" : hsnDigits(e.hsnCode),
    taxRate: l.taxRate ? "" : e.taxRate,
  });

  const pos = snapshot?.pos || [];
  const taxRates = companyOptions?.taxRates || [];
  // The supplier's kind of GST narrows the codes, as the server does; every code when a state is not known.
  const gstKind = gstKindFor(po?.vendorState, snapshot?.companyState);
  const taxCodes = useMemo(() => {
    const all = snapshot?.taxCodes || [];
    return gstKind ? all.filter((t) => t.kind === gstKind) : all;
  }, [snapshot, gstKind]);
  const billCells = (l, e, closed) => (
    <BillTaxCells
      line={l}
      entry={e}
      closed={closed}
      company={company}
      taxCodes={taxCodes}
      taxRates={taxRates}
      hsnShown={!l.hsnCode && String(e.hsnCode || "").trim() ? hsnCheck(e) : {}}
      onChange={(key, value) => setEntry(l.line, key, value)}
    />
  );

  return (
    <div className="modal max-w-6xl">
      <div className="modal-head">
        <div className="min-w-0">
          <h3 className="modal-title">
            <Truck className="h-[18px] w-[18px] text-brand-700 shrink-0" />
            Goods receipt
          </h3>
          <p className="modal-sub">Stock in from a supplier's bill, against an open purchase order.</p>
        </div>
        <button onClick={onClose} className="modal-close" aria-label="Close">
          <X className="h-5 w-5" />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="contents" noValidate>
        <div className="modal-body space-y-4">
          {!companies && !error && (
            <div className="flex items-center gap-2 text-slate-500 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          )}

          {companies && (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
              <div>
                <label className="field-label" htmlFor="gr-company">
                  Company
                </label>
                <select
                  id="gr-company"
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  className="field cursor-pointer"
                  required
                >
                  <option value="">Pick a company</option>
                  {companies.map((c) => (
                    <option key={c.abbr} value={c.abbr}>
                      {c.company} ({c.sapDb})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="field-label" htmlFor="gr-po">
                  Purchase order
                </label>
                <select
                  id="gr-po"
                  value={poKey}
                  onChange={(e) => handlePoChange(e.target.value)}
                  disabled={!company || pos.length === 0}
                  className="field cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
                  required
                >
                  <option value="">
                    {poLoading ? "Loading…" : pos.length ? "Pick a purchase order" : "No open purchase orders"}
                  </option>
                  {pos.map((p) => (
                    <option key={keyOf(p)} value={keyOf(p)}>
                      PO {p.number}
                      {p.order ? ` (${p.order}, from a quotation)` : ""} — {p.vendorName} — {p.date}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {company && snapshot && (
            <div className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-slate-500">
              <span>
                {snapshot.refreshedAt
                  ? `Purchase orders read from SAP ${describeWhen(snapshot.refreshedAt)}.`
                  : "Purchase orders have not been read from SAP yet."}
                {(waitingOnSap || snapshot.refreshing) && " Waiting for SAP…"}
              </span>
              <button
                type="button"
                onClick={refreshFromSap}
                disabled={waitingOnSap}
                className="btn btn-sm btn-neutral"
              >
                <RefreshCw className={`h-4 w-4 ${waitingOnSap ? "animate-spin" : ""}`} />
                Refresh from SAP
              </button>
            </div>
          )}

          {company && snapshot && pos.length === 0 && !poLoading && (
            <div className="note note-slate">
              <AlertCircle className="h-4 w-4 shrink-0 mt-px" />
              <span>
                No open purchase orders for this company. A PO made from a quotation shows here once SAP
                has it; one raised in SAP comes in with Refresh from SAP. Stock that came without a bill
                goes in as the opening quantity when the item is added with Add Engineering Stock.
              </span>
            </div>
          )}

          {po && (
            <>
              <div className="text-[13px] text-slate-700">
                <span className="font-semibold">{po.vendorName}</span>{" "}
                <span className="mono text-slate-500">{po.vendorCode}</span> · PO {po.number}
                {po.order && ` · ${po.order}`}
                {po.request && ` · ${po.request}`} · {po.date}
              </div>

              <div className="table-card">
                <div className="table-scroll">
                  {isOrder ? (
                    <table className="tbl tbl-compact">
                      <thead>
                        <tr>
                          <th>Item</th>
                          <th className="text-right">Pending</th>
                          <th>Billed qty</th>
                          <th>Bill price</th>
                          <th>Received</th>
                          <th className="text-right">Cost</th>
                          <th>Tax code</th>
                          <th>HSN</th>
                          <th>Tax rate</th>
                        </tr>
                      </thead>
                      <tbody>
                        {po.lines.map((l) => {
                          const e = entries[l.line] || {};
                          const c = orderLine(l, e);
                          const closed = Number(l.receivableQty) <= 0;
                          const diff = c.price - Number(l.price || 0);
                          return (
                            <tr key={l.line}>
                              <td>
                                <ItemCell line={l} />
                              </td>
                              <td className="text-right whitespace-nowrap">
                                {l.receivableQty} {l.vendorUnit}
                                <div className="text-[11px] text-slate-500">
                                  of {l.orderedQty}
                                  {Number(l.waitingQty) > 0 && ` · ${l.waitingQty} entered`}
                                </div>
                              </td>
                              <td>
                                <div className="flex items-center gap-1">
                                  <input
                                    type="number"
                                    min="0"
                                    max={l.receivableQty}
                                    step="any"
                                    inputMode="decimal"
                                    value={e.vendorQty ?? ""}
                                    onChange={(ev) => setEntry(l.line, "vendorQty", ev.target.value)}
                                    disabled={closed}
                                    placeholder={closed ? "Entered" : ""}
                                    className="field field-sm w-20 disabled:cursor-not-allowed disabled:opacity-60"
                                    aria-label={`Quantity billed of ${l.name}, in ${l.vendorUnit}`}
                                  />
                                  <span className="text-[12px] text-slate-500">{l.vendorUnit}</span>
                                </div>
                              </td>
                              <td>
                                <input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  inputMode="decimal"
                                  value={e.billPrice ?? ""}
                                  onChange={(ev) => setEntry(l.line, "billPrice", ev.target.value)}
                                  disabled={closed}
                                  className={`field field-sm w-24 disabled:opacity-60 ${c.changed ? "border-amber-400" : ""}`}
                                  aria-label={`Bill price of ${l.name}, per ${l.vendorUnit}`}
                                />
                                <div className="mt-0.5 text-[11px] leading-tight text-slate-500">
                                  per {l.vendorUnit} · quoted {formatCurrency(l.price)}
                                </div>
                                {c.changed && Number(l.price) > 0 && (
                                  <div className="text-[11px] leading-tight text-amber-700">
                                    {diff > 0 ? "+" : ""}
                                    {formatCurrency(diff)} ({diff > 0 ? "+" : ""}
                                    {((diff / Number(l.price)) * 100).toFixed(2)}%)
                                  </div>
                                )}
                              </td>
                              <td>
                                <div className="flex items-center gap-1">
                                  <input
                                    type="number"
                                    min="0"
                                    step="any"
                                    inputMode="decimal"
                                    value={e.mode === "ratio" ? (c.receivedQty ?? "") : (e.receivedQty ?? "")}
                                    onChange={(ev) => setReceived(l.line, "receivedQty", ev.target.value)}
                                    disabled={closed}
                                    className={`field field-sm w-20 disabled:opacity-60 ${e.mode === "ratio" ? "text-slate-500" : ""}`}
                                    aria-label={`Quantity received of ${l.name}, in ${l.unit}`}
                                  />
                                  <span className="text-[12px] text-slate-500">{l.unit}</span>
                                </div>
                                <div className="mt-1 flex items-center gap-1">
                                  <span className="text-[11px] text-slate-500">or</span>
                                  <input
                                    type="number"
                                    min="0"
                                    step="any"
                                    inputMode="decimal"
                                    value={
                                      e.mode === "ratio"
                                        ? (e.ratio ?? "")
                                        : c.receivedQty && c.vendorQty > 0
                                          ? String(Math.round((c.receivedQty / c.vendorQty) * 10000) / 10000)
                                          : ""
                                    }
                                    onChange={(ev) => setReceived(l.line, "ratio", ev.target.value)}
                                    disabled={closed}
                                    className={`field field-sm w-16 disabled:opacity-60 ${e.mode === "ratio" ? "" : "text-slate-500"}`}
                                    aria-label={`${l.unit} per ${l.vendorUnit} of ${l.name}`}
                                  />
                                  <span className="text-[11px] text-slate-500">
                                    {l.unit}/{l.vendorUnit}
                                  </span>
                                </div>
                              </td>
                              <td className="text-right whitespace-nowrap">
                                {c.cost !== null ? (
                                  <>
                                    {formatCurrency(c.cost)}
                                    <span className="text-[11px] text-slate-500"> /{l.unit}</span>
                                    <div className="text-[11px] text-slate-500">{formatCurrency(c.value)}</div>
                                  </>
                                ) : (
                                  "—"
                                )}
                              </td>
                              {billCells(l, e, closed)}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  ) : (
                    <table className="tbl tbl-compact">
                      <thead>
                        <tr>
                          <th>Item</th>
                          <th className="text-right">Open</th>
                          <th className="text-right">PO price</th>
                          <th>Qty received</th>
                          <th>Tax code</th>
                          <th>HSN</th>
                          <th>Tax rate</th>
                        </tr>
                      </thead>
                      <tbody>
                        {po.lines.map((l) => {
                          const e = entries[l.line] || { qty: "", taxCode: "", hsnCode: "", taxRate: "" };
                          const closed = Number(l.receivableQty) <= 0;
                          return (
                            <tr key={l.line}>
                              <td>
                                <ItemCell line={l} />
                              </td>
                              <td className="text-right whitespace-nowrap">
                                {l.receivableQty} {l.unit}
                                {Number(l.waitingQty) > 0 && (
                                  <div className="text-[11px] text-slate-500">{l.waitingQty} already entered</div>
                                )}
                              </td>
                              <td className="text-right whitespace-nowrap">{formatCurrency(l.price)}</td>
                              <td>
                                <input
                                  type="number"
                                  min="0"
                                  max={l.receivableQty}
                                  step="any"
                                  inputMode="decimal"
                                  value={e.qty}
                                  onChange={(ev) => setEntry(l.line, "qty", ev.target.value)}
                                  disabled={closed}
                                  placeholder={closed ? "Fully entered" : ""}
                                  className="field field-sm w-28 disabled:cursor-not-allowed disabled:opacity-60"
                                  aria-label={`Quantity received of ${l.name}`}
                                />
                              </td>
                              {billCells(l, e, closed)}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>

              <datalist id={`gr-hsn-${company}`}>
                {(companyOptions?.hsn || []).map((h) => (
                  <option key={h} value={h} />
                ))}
              </datalist>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="field-label" htmlFor="gr-bill-no">
                    Bill no.
                  </label>
                  <input
                    id="gr-bill-no"
                    type="text"
                    value={billNo}
                    onChange={(e) => setBillNo(e.target.value)}
                    className="field"
                    maxLength={100}
                    required
                  />
                </div>
                <div>
                  <label className="field-label" htmlFor="gr-bill-date">
                    Bill date
                  </label>
                  <input
                    id="gr-bill-date"
                    type="date"
                    value={billDate}
                    max={today()}
                    onChange={(e) => setBillDate(e.target.value)}
                    className="field"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="field-label" htmlFor="gr-remarks">
                  Remarks <span className="text-slate-400 font-normal">(optional)</span>
                </label>
                <textarea
                  id="gr-remarks"
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  className="field field-area"
                  rows={2}
                  maxLength={250}
                />
              </div>

              {entered.length > 0 && (
                <p className="text-[12px] text-slate-600">
                  {entered.length} line{entered.length === 1 ? "" : "s"} · {formatCurrency(billValue)}{" "}
                  {isOrder ? "at bill prices" : "at PO prices"}, before tax
                </p>
              )}
            </>
          )}

          {error && <div className="note note-rose text-sm">{error}</div>}
        </div>

        <div className="modal-foot">
          <button type="button" onClick={onClose} className="btn btn-neutral">
            Cancel
          </button>
          <button type="submit" disabled={saving || !po} className="btn btn-primary">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Save goods receipt
          </button>
        </div>
      </form>
    </div>
  );
};

const ItemCell = ({ line: l }) => (
  <div className="min-w-[180px] max-w-[300px]">
    <div className="cell-title break-words leading-snug">{l.name}</div>
    <div className="mono text-[11px] text-slate-500">{l.sapItemCode}</div>
    {!l.inCatalog && <span className="badge badge-slate badge-soft text-[10px] mt-0.5">Not in the catalog yet</span>}
    {Number(l.itemValue) === 0 && (
      <div className="text-[11px] text-amber-700 mt-0.5">Nil value now — this receipt's cost becomes its value</div>
    )}
  </div>
);

/** An item's own value, shown and not offered for change. */
const OwnValue = ({ value, what }) => (
  <span className="mono text-[12px] text-slate-600" title={`The item's own ${what} - not changed on a receipt`}>
    {value}
  </span>
);

/**
 * What a line takes from the bill: the tax code always; the HSN and tax rate
 * only when the item has none - an item's own are shown, not editable.
 */
const BillTaxCells = ({ line: l, entry: e, closed, company, taxCodes, taxRates, hsnShown, onChange }) => {
  const rates = e.taxRate && !taxRates.includes(e.taxRate) ? [e.taxRate, ...taxRates] : taxRates;
  return (
    <>
      <td>
        <select
          value={e.taxCode ?? ""}
          onChange={(ev) => onChange("taxCode", ev.target.value)}
          disabled={closed}
          className="field field-sm w-36 cursor-pointer disabled:opacity-60"
          aria-label={`Tax code of ${l.name}`}
        >
          <option value="">Tax code…</option>
          {taxCodes.map((t) => (
            <option key={t.code} value={t.code}>
              {t.code}
              {t.rate !== undefined && t.rate !== null ? ` · ${t.rate}%` : ""}
            </option>
          ))}
        </select>
      </td>
      <td>
        {l.hsnCode ? (
          <OwnValue value={l.hsnCode} what="HSN" />
        ) : (
          <>
            <input
              type="text"
              list={`gr-hsn-${company}`}
              value={e.hsnCode ?? ""}
              onChange={(ev) => onChange("hsnCode", ev.target.value)}
              disabled={closed}
              inputMode="numeric"
              placeholder="Item has none"
              className={`field field-sm w-32 mono disabled:opacity-60 ${hsnShown.error ? "border-rose-400" : ""}`}
              aria-label={`HSN code of ${l.name}`}
              aria-invalid={Boolean(hsnShown.error)}
            />
            {hsnShown.error && (
              <div className="mt-0.5 max-w-[10rem] text-[11px] leading-tight text-rose-700">{hsnShown.error}</div>
            )}
            {!hsnShown.error && hsnShown.isNew && (
              <div className="mt-0.5 max-w-[10rem] text-[11px] leading-tight text-amber-700">New HSN - will be added to SAP</div>
            )}
          </>
        )}
      </td>
      <td>
        {l.taxRate ? (
          <OwnValue value={l.taxRate} what="tax rate" />
        ) : (
          <select
            value={e.taxRate ?? ""}
            onChange={(ev) => onChange("taxRate", ev.target.value)}
            disabled={closed}
            className="field field-sm w-24 cursor-pointer disabled:opacity-60"
            aria-label={`Tax rate of ${l.name}`}
          >
            <option value="">—</option>
            {rates.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        )}
      </td>
    </>
  );
};

export default GoodsReceiptModal;
