import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Ban, CheckCircle2, Loader2, PackageCheck, Printer, ShoppingBag, Undo2, X } from "lucide-react";

import API from "../../services/api";
import { useNotifications } from "../../context/NotificationContext";
import { formatCurrency } from "../../utils/currency";

/**
 * One low value purchase request, laid out as the plant's paper purchase
 * requisition: the header, the item rows, the purchase and receipt sections,
 * and the three signature blocks - so the printout can sit in the same file as
 * the paper ones it replaces.
 *
 * The step forms sit above the sheet and never print. Which of them is offered
 * comes from `may` on the record: the server decides who may order, receive,
 * reject or withdraw a particular request, and this does not second-guess it.
 *
 * Rendered into `document.body` through a portal, like ChecklistSheet, so the
 * print rules in index.css can hide the whole console behind it.
 */

const STATUS_STYLE = {
  Requested: "badge-amber",
  Ordered: "badge-cyan",
  Received: "badge-emerald",
  Rejected: "badge-rose",
  Withdrawn: "badge-slate",
};

const pad = (n) => String(n).padStart(2, "0");
/** Local date; toISOString would give yesterday for the first hours of an Indian day. */
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const when = (value) => {
  if (!value) return "";
  const d = new Date(String(value).replace(" ", "T"));
  return Number.isNaN(d.getTime())
    ? String(value)
    : d.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
};

/** A calendar date; no time, and no timezone shift. */
const day = (value) => {
  if (!value) return "";
  const d = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString("en-IN", { dateStyle: "medium" });
};

const num = (n) => (Number(n) ? Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 }) : "");

/* "Rupees in words", the line every Indian requisition and voucher carries. */
const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven",
  "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
const twoDigits = (n) => (n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]} ${ONES[n % 10]}`.trim());
const threeDigits = (n) =>
  [n >= 100 ? `${ONES[Math.floor(n / 100)]} Hundred` : "", twoDigits(n % 100)].filter(Boolean).join(" ");
const indianWords = (n) => {
  if (n === 0) return "Zero";
  const parts = [];
  const crore = Math.floor(n / 1e7);
  if (crore) parts.push(`${indianWords(crore)} Crore`);
  const lakh = Math.floor(n / 1e5) % 100;
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`);
  const thousand = Math.floor(n / 1000) % 100;
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`);
  if (n % 1000) parts.push(threeDigits(n % 1000));
  return parts.join(" ");
};
const rupeesInWords = (amount) => {
  const value = Math.round(Number(amount || 0) * 100);
  const rupees = Math.floor(value / 100);
  const paise = value % 100;
  return `Rupees ${indianWords(rupees)}${paise ? ` and ${twoDigits(paise)} Paise` : ""} Only`;
};

const LowValuePurchaseSheet = ({ id, onClose, onChanged }) => {
  const { showToast } = useNotifications();
  const [record, setRecord] = useState(null);
  const [error, setError] = useState("");
  const [step, setStep] = useState("");

  const load = useCallback(async () => {
    try {
      const { data } = await API.get(`/low-value-purchases/${id}`);
      setRecord(data);
      setError("");
    } catch (err) {
      setError(err.response?.data?.message || "Could not load that request");
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  // Escape closes it, unless a step form is open - half a reason typed is not
  // something to lose to a stray key.
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && !step && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, step]);

  const done = (updated, message) => {
    setRecord(updated);
    setStep("");
    showToast(message, "success");
    onChanged?.();
  };

  const may = record?.may || {};
  const anyStep = may.order || may.receive || may.reject || may.withdraw;

  return createPortal(
    <div className="print-sheet fixed inset-0 z-50 overflow-y-auto bg-slate-900/50 print:bg-white print:static print:overflow-visible">
      <style>{"@page { size: A4 portrait; margin: 10mm; }"}</style>
      <div className="mx-auto my-4 sm:my-6 max-w-[210mm] px-3 sm:px-0 print:my-0 print:px-0 print:max-w-none">
        <div className="flex flex-wrap justify-end items-center gap-2 mb-2 print:hidden">
          {record && (
            <div className="mr-auto flex flex-wrap items-center gap-2 text-white">
              <span className="mono text-sm font-semibold">{record.id}</span>
              <span className={`badge ${STATUS_STYLE[record.status] || "badge-slate"} bg-white`}>
                {record.status}
              </span>
            </div>
          )}
          <button className="btn btn-sm btn-primary" onClick={() => window.print()} disabled={!record}>
            <Printer className="h-4 w-4" />
            Print / save as PDF
          </button>
          <button className="btn btn-sm btn-neutral" onClick={onClose}>
            <X className="h-4 w-4" />
            Close
          </button>
        </div>

        {error ? (
          <div className="card p-5">
            <div className="note note-rose">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          </div>
        ) : !record ? (
          <div className="card h-60 grid place-items-center">
            <Loader2 className="h-7 w-7 animate-spin text-brand-500" />
          </div>
        ) : (
          <>
            <div className="card p-4 mb-3 space-y-3 print:hidden">
              {anyStep ? (
                <div className="flex flex-wrap items-center gap-2">
                  {may.order && (
                    <button
                      className={`btn btn-sm ${step === "order" ? "btn-primary" : "btn-neutral"}`}
                      onClick={() => setStep("order")}
                    >
                      <ShoppingBag className="h-4 w-4" />
                      Record purchase
                    </button>
                  )}
                  {may.receive && (
                    <button
                      className={`btn btn-sm ${step === "receive" ? "btn-primary" : "btn-neutral"}`}
                      onClick={() => setStep("receive")}
                    >
                      <PackageCheck className="h-4 w-4" />
                      Mark received
                    </button>
                  )}
                  {may.reject && (
                    <button
                      className={`btn btn-sm ${step === "reject" ? "btn-danger" : "btn-danger-soft"}`}
                      onClick={() => setStep("reject")}
                    >
                      <Ban className="h-4 w-4" />
                      Reject
                    </button>
                  )}
                  {may.withdraw && (
                    <button
                      className={`btn btn-sm ${step === "withdraw" ? "btn-primary" : "btn-neutral"}`}
                      onClick={() => setStep("withdraw")}
                    >
                      <Undo2 className="h-4 w-4" />
                      Withdraw
                    </button>
                  )}
                </div>
              ) : (
                <p className="flex items-center gap-2 text-[13px] text-slate-600">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-slate-400" />
                  {record.waitingOn ? `Waiting on: ${record.waitingOn}.` : `This request is ${record.status.toLowerCase()}.`}
                </p>
              )}

              {step === "order" && (
                <OrderForm record={record} onCancel={() => setStep("")} onDone={(r) => done(r, `${r.id} ordered`)} />
              )}
              {step === "receive" && (
                <ReceiveForm record={record} onCancel={() => setStep("")} onDone={(r) => done(r, `${r.id} received`)} />
              )}
              {(step === "reject" || step === "withdraw") && (
                <CloseForm
                  key={step}
                  record={record}
                  step={step}
                  onCancel={() => setStep("")}
                  onDone={(r) => done(r, `${r.id} ${step === "reject" ? "rejected" : "withdrawn"}`)}
                />
              )}
            </div>

            <Sheet record={record} />
          </>
        )}
      </div>
    </div>,
    document.body
  );
};

/* ------------------------------------------------------------------ the sheet */

const Sheet = ({ record: r }) => {
  const ordered = Boolean(r.order);
  const closedTitle = r.status === "Rejected" ? "Rejected" : "Withdrawn";
  return (
    <div className="bg-white p-4 sm:p-8 shadow-xl print:shadow-none print:p-0 text-slate-900 rounded-xl print:rounded-none">
      {/* --- heading --- */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b-2 border-slate-800 pb-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-600">Manna Group</p>
          <h1 className="text-lg sm:text-xl font-bold tracking-tight">Purchase Requisition</h1>
          <p className="text-xs text-slate-600">Low value · local purchase · not posted to SAP</p>
        </div>
        <div className="text-right">
          <p className="text-[10px] uppercase tracking-wider text-slate-500">Request no.</p>
          <p className="font-mono text-lg font-bold">{r.id}</p>
          <p className="mt-1 inline-block border-2 border-slate-800 px-2 py-0.5 text-xs font-bold uppercase tracking-wider">
            {r.status}
          </p>
        </div>
      </div>

      {/* --- the request --- */}
      <div className="grid grid-cols-2 sm:grid-cols-4 print:grid-cols-4 border-l border-t border-slate-300 mt-3 text-sm">
        <Cell label="Date" value={day(r.raisedAt)} />
        <Cell label="Plant" value={r.plant} />
        <Cell label="Department" value={r.department} />
        <Cell label="Urgency" value={r.urgency === "Urgent" ? "URGENT" : "Normal"} strong={r.urgency === "Urgent"} />
        <Cell label="Requested by" value={r.raisedBy} span={2} />
        <Cell label="Required by" value={day(r.requiredBy)} span={2} />
        <Cell label="Purpose" value={r.purpose} span={4} />
      </div>

      {/* --- the items --- */}
      <Section title="Items required" />
      <div className="overflow-x-auto print:overflow-visible">
        <table className="w-full min-w-[640px] print:min-w-0 border-collapse text-sm">
          <thead>
            <tr className="bg-slate-100">
              <Th className="w-10 text-center">S.No</Th>
              <Th>Item / description</Th>
              <Th>Specification / size / make</Th>
              <Th className="w-14 text-right">Qty</Th>
              <Th className="w-14">Unit</Th>
              <Th className="w-20 text-right">Est. rate</Th>
              <Th className="w-24 text-right">Est. amount</Th>
              <Th className="w-32">Remarks</Th>
            </tr>
          </thead>
          <tbody>
            {r.lines.map((l, i) => (
              <tr key={l.idx || i}>
                <Td className="text-center">{i + 1}</Td>
                <Td>{l.description}</Td>
                <Td className="text-slate-700">{l.specification}</Td>
                <Td className="text-right tabular-nums">{num(l.qty)}</Td>
                <Td>{l.unit}</Td>
                <Td className="text-right tabular-nums">{num(l.estRate)}</Td>
                <Td className="text-right tabular-nums">{num(l.estAmount)}</Td>
                <Td className="text-xs text-slate-700">{l.remarks}</Td>
              </tr>
            ))}
            <tr>
              <Td colSpan={6} className="text-right font-semibold">
                Estimated total
              </Td>
              <Td className="text-right font-bold tabular-nums">{formatCurrency(r.estTotal)}</Td>
              <Td />
            </tr>
          </tbody>
        </table>
      </div>
      <p className="mt-1 text-[11px] text-slate-600 italic">{rupeesInWords(r.estTotal)}</p>

      {/* --- purchase --- */}
      <div className="break-inside-avoid">
        <Section title="Purchase details (purchase department)" />
        <div className="grid grid-cols-2 sm:grid-cols-4 print:grid-cols-4 border-l border-t border-slate-300 text-sm">
          <Cell label="Vendor" value={r.order?.vendorName} span={2} />
          <Cell label="Vendor contact" value={r.order?.vendorContact} />
          <Cell label="Expected on" value={day(r.order?.expectedOn)} />
          {r.order?.remarks && <Cell label="Remarks" value={r.order.remarks} span={4} />}
        </div>
        {ordered && (
          <div className="mt-2 overflow-x-auto print:overflow-visible">
            <table className="w-full min-w-[480px] print:min-w-0 border-collapse text-sm">
              <thead>
                <tr className="bg-slate-100">
                  <Th className="w-10 text-center">S.No</Th>
                  <Th>Item</Th>
                  <Th className="w-20 text-right">Qty</Th>
                  <Th className="w-24 text-right">Actual rate</Th>
                  <Th className="w-28 text-right">Actual amount</Th>
                </tr>
              </thead>
              <tbody>
                {r.lines.map((l, i) => (
                  <tr key={l.idx || i}>
                    <Td className="text-center">{i + 1}</Td>
                    <Td>{l.description}</Td>
                    <Td className="text-right tabular-nums">
                      {num(l.qty)} {l.unit}
                    </Td>
                    <Td className="text-right tabular-nums">{num(l.rate)}</Td>
                    <Td className="text-right tabular-nums">{num(l.amount)}</Td>
                  </tr>
                ))}
                <tr>
                  <Td colSpan={4} className="text-right font-semibold">
                    Actual total
                    {r.total !== r.estTotal && (
                      <span className="ml-2 text-xs font-normal text-slate-600">
                        ({r.total > r.estTotal ? "+" : "−"}
                        {formatCurrency(Math.abs(r.total - r.estTotal))} on the estimate)
                      </span>
                    )}
                  </Td>
                  <Td className="text-right font-bold tabular-nums">{formatCurrency(r.total)}</Td>
                </tr>
              </tbody>
            </table>
            <p className="mt-1 text-[11px] text-slate-600 italic">{rupeesInWords(r.total)}</p>
          </div>
        )}
      </div>

      {/* --- receipt --- */}
      <div className="break-inside-avoid">
        <Section title="Material received" />
        <div className="grid grid-cols-2 sm:grid-cols-4 print:grid-cols-4 border-l border-t border-slate-300 text-sm">
          <Cell label="Bill / invoice no." value={r.received?.billNo} span={2} />
          <Cell label="Bill date" value={day(r.received?.billDate)} />
          <Cell label="Received on" value={day(r.received?.at)} />
          {r.received?.remarks && <Cell label="Remarks" value={r.received.remarks} span={4} />}
        </div>
      </div>

      {r.closed && (
        <div className="mt-4 border-2 border-slate-800 p-3 break-inside-avoid">
          <p className="text-xs font-bold uppercase tracking-wider">{closedTitle}</p>
          <p className="text-sm whitespace-pre-wrap">{r.closed.reason}</p>
          <p className="mt-1 text-[11px] text-slate-600">
            {r.closed.by} · {when(r.closed.at)}
          </p>
        </div>
      )}

      {/* --- signatures: the names and times the system recorded --- */}
      <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 print:grid-cols-3 gap-6 break-inside-avoid">
        <Sign role="Requested by" name={r.raisedBy} at={r.raisedAt} />
        {r.status === "Rejected" ? (
          <Sign role="Rejected by" name={r.closed?.by} at={r.closed?.at} />
        ) : (
          <Sign role="Purchased by" name={r.order?.by} at={r.order?.at} />
        )}
        <Sign role="Received by" name={r.received?.by} at={r.received?.at} />
      </div>

      <p className="mt-6 text-[10px] text-slate-500">
        Printed from Manna CMMS, {r.id}, {when(new Date().toISOString())}. Kept in ERPNext only.
      </p>
    </div>
  );
};

const Cell = ({ label, value, span = 1, strong }) => (
  <div
    className={`border-r border-b border-slate-300 px-2 py-1.5 min-w-0 ${
      span === 4
        ? "col-span-2 sm:col-span-4 print:col-span-4"
        : span === 2
          ? "col-span-2"
          : ""
    }`}
  >
    <p className="text-[10px] uppercase tracking-wider text-slate-500">{label}</p>
    <p className={`min-h-[1.25rem] break-words whitespace-pre-wrap ${strong ? "font-bold text-rose-700" : "font-medium"}`}>
      {value || ""}
    </p>
  </div>
);

const Section = ({ title }) => (
  <h2 className="mt-5 mb-1 text-xs font-bold uppercase tracking-wider text-slate-700">{title}</h2>
);

const Th = ({ children, className = "" }) => (
  <th className={`border border-slate-300 px-2 py-1 text-left text-[11px] font-semibold ${className}`}>
    {children}
  </th>
);

const Td = ({ children, className = "", colSpan }) => (
  <td colSpan={colSpan} className={`border border-slate-300 px-2 py-1 h-8 align-top ${className}`}>
    {children}
  </td>
);

const Sign = ({ role, name, at }) => (
  <div>
    <div className="h-10 border-b border-slate-800 flex items-end pb-0.5">
      <span className="text-[13px] font-medium truncate">{name || ""}</span>
    </div>
    <p className="mt-1 text-[10px] uppercase tracking-wider text-slate-600">{role}</p>
    <p className="text-[10px] text-slate-500">{at ? when(at) : "Name & date"}</p>
  </div>
);

/* ------------------------------------------------------------------ the steps */

const useStep = (record, step, onDone) => {
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState("");
  const send = async (body) => {
    setSaving(true);
    setProblem("");
    try {
      const { data } = await API.post(`/low-value-purchases/${record.id}/${step}`, body);
      onDone(data);
    } catch (err) {
      setProblem(err.response?.data?.message || "That step was refused");
    } finally {
      setSaving(false);
    }
  };
  return { saving, problem, setProblem, send };
};

const StepFoot = ({ saving, label, onCancel, danger }) => (
  <div className="flex justify-end gap-2">
    <button type="button" className="btn btn-sm btn-neutral" onClick={onCancel}>
      Cancel
    </button>
    <button type="submit" className={`btn btn-sm ${danger ? "btn-danger" : "btn-primary"}`} disabled={saving}>
      {saving && <Loader2 className="h-4 w-4 animate-spin" />}
      {label}
    </button>
  </div>
);

/** The purchase manager buys it: who from, and what each line actually cost. */
const OrderForm = ({ record, onCancel, onDone }) => {
  const { saving, problem, setProblem, send } = useStep(record, "order", onDone);
  const [form, setForm] = useState({ vendorName: "", vendorContact: "", expectedOn: "", remarks: "" });
  const [rates, setRates] = useState({});
  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  // A blank rate keeps the estimate, which is what most low value buys cost.
  const rateOf = (l) => (rates[l.idx] === undefined || rates[l.idx] === "" ? l.estRate : Number(rates[l.idx]));
  const total = record.lines.reduce((sum, l) => sum + (rateOf(l) > 0 ? rateOf(l) * l.qty : 0), 0);

  const submit = (e) => {
    e.preventDefault();
    if (!form.vendorName.trim()) return setProblem("Say who it is bought from.");
    if (form.expectedOn && form.expectedOn < today()) return setProblem("The expected date cannot be in the past.");
    const missing = record.lines.find((l) => !(rateOf(l) > 0));
    if (missing) return setProblem(`Give the rate paid for ${missing.description}.`);
    send({
      vendorName: form.vendorName.trim(),
      vendorContact: form.vendorContact.trim(),
      expectedOn: form.expectedOn,
      remarks: form.remarks.trim(),
      lines: record.lines.map((l) => ({ idx: l.idx, rate: rates[l.idx] ?? "" })),
    });
  };

  return (
    <form onSubmit={submit} className="space-y-3 border-t border-slate-200 pt-3" noValidate>
      <h3 className="section-title">Record the purchase</h3>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="field-label" htmlFor="lvp-vendor">
            Vendor
          </label>
          <input id="lvp-vendor" className="field" maxLength={140} value={form.vendorName} onChange={set("vendorName")} />
        </div>
        <div>
          <label className="field-label" htmlFor="lvp-contact">
            Vendor contact
          </label>
          <input
            id="lvp-contact"
            className="field"
            maxLength={60}
            value={form.vendorContact}
            onChange={set("vendorContact")}
            placeholder="Phone or person"
          />
        </div>
        <div>
          <label className="field-label" htmlFor="lvp-expected">
            Expected on
          </label>
          <input
            id="lvp-expected"
            type="date"
            className="field"
            min={today()}
            value={form.expectedOn}
            onChange={set("expectedOn")}
          />
        </div>
      </div>

      <div className="table-card">
        <div className="table-scroll">
          <table className="tbl tbl-compact">
            <thead>
              <tr>
                <th>Item</th>
                <th className="text-right">Qty</th>
                <th className="text-right">Est. rate</th>
                <th>Rate paid (₹)</th>
                <th className="text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {record.lines.map((l) => (
                <tr key={l.idx}>
                  <td>
                    <div className="min-w-[140px] max-w-[260px] cell-title break-words leading-snug">
                      {l.description}
                    </div>
                  </td>
                  <td className="text-right whitespace-nowrap">
                    {num(l.qty)} {l.unit}
                  </td>
                  <td className="text-right whitespace-nowrap tabular-nums">{l.estRate ? formatCurrency(l.estRate) : "—"}</td>
                  <td>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      inputMode="decimal"
                      className="field field-sm w-28"
                      value={rates[l.idx] ?? ""}
                      onChange={(e) => setRates((r) => ({ ...r, [l.idx]: e.target.value }))}
                      placeholder={l.estRate ? String(l.estRate) : "Rate"}
                      aria-label={`Rate paid for ${l.description}`}
                    />
                  </td>
                  <td className="text-right whitespace-nowrap tabular-nums">
                    {rateOf(l) > 0 ? formatCurrency(rateOf(l) * l.qty) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-baseline justify-between gap-3 border-t border-slate-200 px-4 py-3">
          <span className="text-[12px] text-slate-500">A blank rate keeps the estimate.</span>
          <span className="text-base font-bold tabular-nums text-slate-900">{formatCurrency(total)}</span>
        </div>
      </div>

      <div>
        <label className="field-label" htmlFor="lvp-order-remarks">
          Remarks
        </label>
        <textarea
          id="lvp-order-remarks"
          className="field field-area"
          rows={2}
          maxLength={500}
          value={form.remarks}
          onChange={set("remarks")}
          placeholder="Optional"
        />
      </div>
      {problem && <div className="note note-rose">{problem}</div>}
      <StepFoot saving={saving} label="Save purchase" onCancel={onCancel} />
    </form>
  );
};

/** It arrived: the bill it came with. */
const ReceiveForm = ({ record, onCancel, onDone }) => {
  const { saving, problem, setProblem, send } = useStep(record, "receive", onDone);
  const [form, setForm] = useState({ billNo: "", billDate: today(), remarks: "" });
  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const submit = (e) => {
    e.preventDefault();
    if (form.billDate && form.billDate > today()) return setProblem("The bill date cannot be in the future.");
    send({ billNo: form.billNo.trim(), billDate: form.billDate, remarks: form.remarks.trim() });
  };

  return (
    <form onSubmit={submit} className="space-y-3 border-t border-slate-200 pt-3" noValidate>
      <h3 className="section-title">Mark it received</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:max-w-lg">
        <div>
          <label className="field-label" htmlFor="lvp-bill">
            Bill / invoice no.
          </label>
          <input id="lvp-bill" className="field" maxLength={60} value={form.billNo} onChange={set("billNo")} />
        </div>
        <div>
          <label className="field-label" htmlFor="lvp-bill-date">
            Bill date
          </label>
          <input
            id="lvp-bill-date"
            type="date"
            className="field"
            max={today()}
            value={form.billDate}
            onChange={set("billDate")}
          />
        </div>
      </div>
      <div>
        <label className="field-label" htmlFor="lvp-receive-remarks">
          Remarks
        </label>
        <textarea
          id="lvp-receive-remarks"
          className="field field-area"
          rows={2}
          maxLength={500}
          value={form.remarks}
          onChange={set("remarks")}
          placeholder="Optional - short supply, damage, anything to note"
        />
      </div>
      {problem && <div className="note note-rose">{problem}</div>}
      <StepFoot saving={saving} label="Mark received" onCancel={onCancel} />
    </form>
  );
};

/** Rejected by the buyer, or withdrawn by whoever asked - always with the reason. */
const CloseForm = ({ record, step, onCancel, onDone }) => {
  const { saving, problem, setProblem, send } = useStep(record, step, onDone);
  const [reason, setReason] = useState("");
  const reject = step === "reject";

  const submit = (e) => {
    e.preventDefault();
    if (!reason.trim()) return setProblem("Say why.");
    send({ reason: reason.trim() });
  };

  return (
    <form onSubmit={submit} className="space-y-3 border-t border-slate-200 pt-3" noValidate>
      <h3 className="section-title">{reject ? "Reject the request" : "Withdraw the request"}</h3>
      <textarea
        className="field field-area"
        rows={2}
        maxLength={500}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder={reject ? "Why it will not be bought" : "Why it is no longer needed"}
        aria-label="Reason"
      />
      {problem && <div className="note note-rose">{problem}</div>}
      <StepFoot saving={saving} label={reject ? "Reject" : "Withdraw"} danger={reject} onCancel={onCancel} />
    </form>
  );
};

export default LowValuePurchaseSheet;
