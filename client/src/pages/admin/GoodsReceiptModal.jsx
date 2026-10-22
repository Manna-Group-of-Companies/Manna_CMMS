import { useEffect, useMemo, useRef, useState } from "react";
import API from "../../services/api";
import { useNotifications } from "../../context/NotificationContext";
import { describeWhen } from "../../hooks/useFormDraft";
import { formatCurrency } from "../../utils/currency";
import { AlertCircle, Loader2, RefreshCw, Truck, X } from "lucide-react";
import { hsnDigits, hsnProblem } from "../../utils/hsn";

/**
 * Goods receipt: stock in from a supplier's bill, against an open SAP purchase
 * order (decided 9 Oct 2026).
 *
 * Vendor, price and SAP tax code come from the PO; the store enters the bill
 * number and date, the quantity received on each line, and each line's HSN and
 * tax rate as the bill states them. The record is queued and the SAP server
 * posts the GRPO and the ERPNext receipt within about a minute. An item at nil
 * value takes this receipt's price as its value.
 *
 * The open POs are a snapshot the SAP server writes; "Refresh from SAP" asks it
 * for a new one and waits for it to land.
 *
 * An item billed in another unit than it is stocked in (its bill unit - flex
 * billed in KGS, stocked in MTR) also takes the quantity on the bill. The
 * quantity received stays in the stock unit, as on every other line.
 */

/** Units counted in whole things, in SAP's and ERPNext's spellings. */
const COUNTED = new Set(["nos", "no", "pcs", "pc", "pair", "pairs", "prs", "set", "sets", "box", "boxes", "roll", "rolls", "rol", "pkt", "packet", "unit", "units"]);
const isCountUnit = (unit) => COUNTED.has(String(unit || "").trim().toLowerCase());

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

const GoodsReceiptModal = ({ onClose, onSaved }) => {
  const { showToast } = useNotifications();
  const [companies, setCompanies] = useState(null);
  const [company, setCompany] = useState("");
  const [snapshot, setSnapshot] = useState(null);
  const [poLoading, setPoLoading] = useState(false);
  const [poEntry, setPoEntry] = useState("");
  // Per PO line: { qty, billQty, hsnCode, taxRate }, keyed by line number.
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
  const po = useMemo(
    () => (snapshot?.pos || []).find((p) => String(p.entry) === String(poEntry)) || null,
    [snapshot, poEntry]
  );

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
    setPoEntry("");
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

  // Pre-fill each line from the PO: the HSN and tax rate SAP has for the item,
  // corrected by hand where the bill says otherwise. Entries already typed for
  // a line that is still there are kept, so a refresh does not wipe them.
  useEffect(() => {
    if (!po) return;
    setEntries((prev) => {
      const next = {};
      for (const l of po.lines) {
        next[l.line] = prev[l.line] || {
          qty: "",
          billQty: "",
          hsnCode: l.hsnCode || "",
          taxRate: l.taxRate || "",
        };
      }
      return next;
    });
  }, [po]);

  // A refresh can close the chosen PO (received in full, or cancelled in SAP).
  useEffect(() => {
    if (snapshot && poEntry && !po) {
      setPoEntry("");
      setEntries({});
    }
  }, [snapshot, poEntry, po]);

  const handlePoChange = (value) => {
    setPoEntry(value);
    setEntries({});
  };

  const setEntry = (line, key, value) =>
    setEntries((prev) => ({ ...prev, [line]: { ...prev[line], [key]: value } }));

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

  const entered = useMemo(
    () => (po ? po.lines.filter((l) => Number(entries[l.line]?.qty) > 0) : []),
    [po, entries]
  );
  const billValue = entered.reduce(
    (sum, l) => sum + Number(entries[l.line].qty) * Number(l.price || 0),
    0
  );

  const validate = () => {
    if (!po) return "Pick a purchase order.";
    if (!billNo.trim()) return "Enter the bill number.";
    if (!billDate) return "Enter the bill date.";
    if (billDate > today()) return "The bill date cannot be in the future.";
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
      if (l.billUnit) {
        if (!(Number(e.billQty) > 0)) return `${l.name}: enter the quantity on the bill, in ${l.billUnit}.`;
        if (isCountUnit(l.unit) && !Number.isInteger(Number(e.qty))) {
          return `${l.name}: ${l.unit} is counted in whole numbers.`;
        }
      }
      const hsn = hsnCheck(l, e);
      if (hsn.error) return `${l.name}: ${hsn.error}`;
      if (!e.taxRate) return `${l.name}: pick the tax rate from the bill.`;
    }
    return "";
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const problem = validate();
    setError(problem);
    if (problem) return;
    try {
      setSaving(true);
      const { data } = await API.post("/goods-receipts", {
        company,
        poEntry: po.entry,
        billNo: billNo.trim(),
        billDate,
        remarks: remarks.trim(),
        lines: entered.map((l) => ({
          poLine: l.line,
          qty: Number(entries[l.line].qty),
          ...(l.billUnit ? { billQty: Number(entries[l.line].billQty) } : {}),
          hsnCode: hsnDigits(entries[l.line].hsnCode),
          taxRate: entries[l.line].taxRate,
        })),
      });
      showToast(
        `Goods receipt ${data.id} saved. SAP posts it within a minute; the stock shows once it is posted.`,
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
   * One line's HSN, as the server will take it: required, the shape of a real
   * code, and either in SAP's list or - for an item that has no HSN yet - new,
   * which the save asks SAP to add.
   */
  const hsnCheck = (l, e) => {
    const digits = hsnDigits(e.hsnCode);
    if (!digits) return { error: "enter the HSN code from the bill." };
    const problem = hsnProblem(digits);
    if (problem) return { error: `${problem}.` };
    if ((companyOptions?.hsn || []).includes(digits)) return { digits };
    if (l.hsnCode) return { error: `HSN ${digits} is not in SAP's list - pick one from the list.` };
    return { digits, isNew: true };
  };

  const pos = snapshot?.pos || [];
  const taxRates = companyOptions?.taxRates || [];
  // The bill column only when this PO has an item billed in another unit.
  const anyBillUnit = Boolean(po?.lines.some((l) => l.billUnit));

  return (
    <div className="modal max-w-6xl">
      <div className="modal-head">
        <div className="min-w-0">
          <h3 className="modal-title">
            <Truck className="h-[18px] w-[18px] text-brand-700 shrink-0" />
            Goods receipt
          </h3>
          <p className="modal-sub">
            Stock in from a supplier's bill, against an open SAP purchase order.
          </p>
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
                  value={poEntry}
                  onChange={(e) => handlePoChange(e.target.value)}
                  disabled={!company || pos.length === 0}
                  className="field cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
                  required
                >
                  <option value="">
                    {poLoading ? "Loading…" : pos.length ? "Pick a purchase order" : "No open purchase orders"}
                  </option>
                  {pos.map((p) => (
                    <option key={p.entry} value={p.entry}>
                      PO {p.number} — {p.vendorName} — {p.date}
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
                No open purchase orders for this company. Purchase raises the PO in SAP; once it is
                there, use Refresh from SAP to bring it in. Stock that came without a bill goes in as
                the opening quantity when the item is added with Add Engineering Stock.
              </span>
            </div>
          )}

          {po && (
            <>
              <div className="text-[13px] text-slate-700">
                <span className="font-semibold">{po.vendorName}</span>{" "}
                <span className="mono text-slate-500">{po.vendorCode}</span> · PO {po.number} ·{" "}
                {po.date}
              </div>

              <div className="table-card">
                <div className="table-scroll">
                  <table className="tbl tbl-compact">
                    <thead>
                      <tr>
                        <th>Item</th>
                        <th className="text-right">Open</th>
                        <th className="text-right">PO price</th>
                        <th>Tax code</th>
                        <th>Qty received</th>
                        {anyBillUnit && <th>Qty on bill</th>}
                        <th>HSN</th>
                        <th>Tax rate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {po.lines.map((l) => {
                        const e = entries[l.line] || { qty: "", billQty: "", hsnCode: "", taxRate: "" };
                        const closed = Number(l.receivableQty) <= 0;
                        // Said as it is typed, but only once there is something to say.
                        const hsnShown = String(e.hsnCode || "").trim() ? hsnCheck(l, e) : {};
                        const rates =
                          e.taxRate && !taxRates.includes(e.taxRate) ? [e.taxRate, ...taxRates] : taxRates;
                        return (
                          <tr key={l.line}>
                            <td>
                              <div className="min-w-[180px] max-w-[300px]">
                                <div className="cell-title break-words leading-snug">{l.name}</div>
                                <div className="mono text-[11px] text-slate-500">
                                  {l.sapItemCode || l.itemCode}
                                </div>
                                {!l.inCatalog && (
                                  <span className="badge badge-slate badge-soft text-[10px] mt-0.5">
                                    Not in the catalog yet
                                  </span>
                                )}
                                {Number(l.itemValue) === 0 && (
                                  <div className="text-[11px] text-amber-700 mt-0.5">
                                    Nil value now — this price becomes its value
                                  </div>
                                )}
                              </div>
                            </td>
                            <td className="text-right whitespace-nowrap">
                              {l.receivableQty} {l.unit}
                              {Number(l.waitingQty) > 0 && (
                                <div className="text-[11px] text-slate-500">
                                  {l.waitingQty} already entered
                                </div>
                              )}
                            </td>
                            <td className="text-right whitespace-nowrap">{formatCurrency(l.price)}</td>
                            <td className="mono text-slate-600">{l.taxCode || "—"}</td>
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
                              {l.billUnit && <div className="mt-0.5 text-[11px] text-slate-500">{l.unit} received</div>}
                            </td>
                            {anyBillUnit && (
                              <td>
                                {l.billUnit && (
                                  <>
                                    <input
                                      type="number"
                                      min="0"
                                      step="any"
                                      inputMode="decimal"
                                      value={e.billQty}
                                      onChange={(ev) => setEntry(l.line, "billQty", ev.target.value)}
                                      disabled={closed}
                                      className="field field-sm w-28 disabled:cursor-not-allowed disabled:opacity-60"
                                      aria-label={`Quantity on the bill of ${l.name}, in ${l.billUnit}`}
                                    />
                                    <div className="mt-0.5 text-[11px] text-slate-500">{l.billUnit} on the bill</div>
                                  </>
                                )}
                              </td>
                            )}
                            <td>
                              <input
                                type="text"
                                list={`gr-hsn-${company}`}
                                value={e.hsnCode}
                                onChange={(ev) => setEntry(l.line, "hsnCode", ev.target.value)}
                                disabled={closed}
                                inputMode="numeric"
                                className={`field field-sm w-32 mono disabled:opacity-60 ${
                                  hsnShown.error ? "border-rose-400" : ""
                                }`}
                                aria-label={`HSN code of ${l.name}`}
                                aria-invalid={Boolean(hsnShown.error)}
                              />
                              {hsnShown.error && (
                                <div className="mt-0.5 max-w-[10rem] text-[11px] leading-tight text-rose-700">
                                  {hsnShown.error}
                                </div>
                              )}
                              {!hsnShown.error && hsnShown.isNew && (
                                <div className="mt-0.5 max-w-[10rem] text-[11px] leading-tight text-amber-700">
                                  New HSN - will be added to SAP
                                </div>
                              )}
                            </td>
                            <td>
                              <select
                                value={e.taxRate}
                                onChange={(ev) => setEntry(l.line, "taxRate", ev.target.value)}
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
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
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
                  at PO prices, before tax
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

export default GoodsReceiptModal;
