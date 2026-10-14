import { useEffect, useMemo, useRef, useState } from "react";
import API from "../../services/api";
import { useNotifications } from "../../context/NotificationContext";
import { AlertCircle, ChevronDown, Loader2, Search, ShoppingCart, Trash2, X } from "lucide-react";

/**
 * Purchase request: the Maintenance Manager asks Purchase to buy items for one
 * SAP company (decided 9 Oct 2026).
 *
 * The record is queued and the SAP server creates a SAP Purchase Request within
 * about a minute; the purchase manager at the maintenance office turns it into
 * a Purchase Order in SAP, and that PO is what Goods receipt receives against.
 *
 * Every line must be an item of the one company that already has a SAP code,
 * so the company is fixed by the first item: by the starting products when
 * opened with some, else picked here before items can be searched.
 *
 * Opened from Low Stock it arrives with the ticked shortfalls already on it,
 * each carrying `suggestedQty` - the units that bring that shelf back to its
 * minimum. A starting quantity, not a decision: every line is still typed over
 * before it is sent, and buying exactly the shortfall only reaches the minimum
 * again, which for a fast-moving item is the next shortage rather than the end
 * of one.
 */

const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Today as YYYY-MM-DD in local time; toISOString would give yesterday's date
    for the first five and a half hours of an Indian day. */
const today = () => ymd(new Date());

const daysAhead = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return ymd(d);
};

/** The dropdown lists this many at most; typing narrows it. */
const MAX_SHOWN = 100;

const matchesTerm = (p, q) =>
  !q || [p.name, p.code, p.sap?.code].some((v) => String(v || "").toLowerCase().includes(q));

/** Only an item of this company that SAP already knows can be requested. */
const eligible = (product, company) =>
  Boolean(product?.sap?.code) && Boolean(company) && product?.sapCategory?.company === company;

const lineFrom = (product) => ({
  code: product.code,
  name: product.name,
  sapCode: product.sap?.code || "",
  quantity: product.quantity,
  minStock: product.minStock,
  unit: product.unit || "",
  // Low Stock sends the shortfall through; everywhere else the quantity is the
  // one thing nobody can guess.
  qty: product.suggestedQty > 0 ? String(product.suggestedQty) : "",
  remarks: "",
});

const PurchaseRequestModal = ({ product = null, products = null, onClose, onSaved }) => {
  const { showToast } = useNotifications();
  // One item or a basket of them: the same request either way.
  const seed = useMemo(
    () => (products?.length ? products : product ? [product] : []),
    [products, product]
  );
  const startCompany = seed[0]?.sapCategory?.company || "";
  const [companies, setCompanies] = useState(null);
  const [company, setCompany] = useState(startCompany);
  const [lines, setLines] = useState(() =>
    seed.filter((p) => eligible(p, startCompany)).map(lineFrom)
  );
  const [term, setTerm] = useState("");
  // The company's Engineering Stock items the request can take; null while loading.
  const [items, setItems] = useState(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const searchRef = useRef(null);
  const [requiredBy, setRequiredBy] = useState(daysAhead(7));
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  // Anything handed in that SAP does not know yet is dropped rather than
  // carried as a line that cannot be sent - and said out loud, because a basket
  // that quietly arrives one item short is worse than one that explains itself.
  const [error, setError] = useState(() => {
    const left = seed.filter((p) => !eligible(p, startCompany));
    if (left.length === 0) return "";
    if (left.length === seed.length) {
      return seed.length === 1
        ? "This item has no SAP code or SAP company yet, so it cannot be requested."
        : "None of those items has a SAP code yet, so none can be requested.";
    }
    return `${left.length} of ${seed.length} left out - no SAP code yet: ${left
      .map((p) => p.code)
      .join(", ")}`;
  });

  // Opened with items the company is theirs; opened bare, it is picked.
  const companyFixed = seed.length > 0;
  const companyName = useMemo(() => {
    const c = (companies || []).find((x) => x.abbr === company);
    return c ? `${c.company} (${company})` : seed[0]?.homeStore || company;
  }, [companies, company, seed]);

  // The companies: the picker when opened bare, the full name otherwise.
  useEffect(() => {
    API.get("/naming-requests/options")
      .then(({ data }) => {
        const list = Array.isArray(data) ? data : [];
        setCompanies(list);
        if (!startCompany && list.length === 1) setCompany(list[0].abbr);
      })
      .catch((e) => setError(e.response?.data?.message || "Could not load the SAP companies."));
  }, [startCompany]);

  // The company's items from Engineering Stock, loaded once per company so the
  // dropdown can list them before anything is typed. Only items with a SAP code
  // can be requested.
  useEffect(() => {
    if (!company) {
      setItems(null);
      return undefined;
    }
    let live = true;
    setItems(null);
    API.get("/products")
      .then(({ data }) => {
        if (!live) return;
        const list = (Array.isArray(data) ? data : []).filter((p) => eligible(p, company));
        list.sort((a, b) => String(a.name).localeCompare(String(b.name)));
        setItems(list);
      })
      .catch((e) => {
        if (!live) return;
        setItems([]);
        setError(e.response?.data?.message || "Could not load the Engineering Stock items.");
      });
    return () => {
      live = false;
    };
  }, [company]);

  const onRequest = useMemo(() => new Set(lines.map((l) => l.code)), [lines]);
  // Not on the request already, and matching what is typed (name, code or SAP code).
  const matches = useMemo(() => {
    const q = term.trim().toLowerCase();
    return (items || []).filter((p) => !onRequest.has(p.code) && matchesTerm(p, q));
  }, [items, term, onRequest]);
  const shown = matches.slice(0, MAX_SHOWN);

  // Keep the keyboard-highlighted row in view as it moves.
  useEffect(() => {
    if (open) document.getElementById(`pr-opt-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const addLine = (p) => {
    setLines((prev) => (prev.some((l) => l.code === p.code) ? prev : [...prev, lineFrom(p)]));
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
      // Picks the highlighted item; never submits the request from here.
      e.preventDefault();
      if (shown[active]) addLine(shown[active]);
    } else if (e.key === "Escape" && open) {
      e.stopPropagation();
      setOpen(false);
    }
  };

  const setLine = (code, key, value) =>
    setLines((prev) => prev.map((l) => (l.code === code ? { ...l, [key]: value } : l)));

  const removeLine = (code) => setLines((prev) => prev.filter((l) => l.code !== code));

  const validate = () => {
    if (!company) return "Pick a company.";
    if (lines.length === 0) return "Add at least one item.";
    for (const l of lines) {
      if (!(Number(l.qty) > 0)) return `${l.name}: enter a quantity above zero.`;
      if (l.remarks.trim().length > 100) return `${l.name}: keep the remarks to 100 characters.`;
    }
    if (!requiredBy) return "Enter the date it is required by.";
    if (requiredBy < today()) return "The required-by date cannot be in the past.";
    if (!reason.trim()) return "Enter the reason for the request.";
    if (reason.trim().length > 250) return "Keep the reason to 250 characters.";
    return "";
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const problem = validate();
    setError(problem);
    if (problem) return;
    try {
      setSaving(true);
      const { data } = await API.post("/purchase-requests", {
        company,
        requiredBy,
        reason: reason.trim(),
        lines: lines.map((l) => ({
          itemCode: l.code,
          qty: Number(l.qty),
          remarks: l.remarks.trim(),
        })),
      });
      showToast(`Purchase request ${data.id} saved. SAP gets it within a minute.`, "success");
      onSaved?.();
      onClose();
    } catch (err) {
      setError(err.response?.data?.message || "Could not save the purchase request.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal max-w-4xl">
      <div className="modal-head">
        <div className="min-w-0">
          <h3 className="modal-title">
            <ShoppingCart className="h-[18px] w-[18px] text-brand-700 shrink-0" />
            Purchase request
          </h3>
          <p className="modal-sub">Ask Purchase to buy items for one SAP company.</p>
        </div>
        <button onClick={onClose} className="modal-close" aria-label="Close">
          <X className="h-5 w-5" />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="contents" noValidate>
        <div className="modal-body space-y-4">
          <div className="note note-slate">
            <AlertCircle className="h-4 w-4 shrink-0 mt-px" />
            <span>
              SAP gets a Purchase Request within a minute; the purchase manager turns it into a
              Purchase Order, which you then receive with Goods receipt.
            </span>
          </div>

          {companyFixed ? (
            <div className="kv">
              <span className="kv-label">Company</span>
              <span className="kv-value">{companyName || "—"}</span>
            </div>
          ) : !companies && !error ? (
            <div className="flex items-center gap-2 text-slate-500 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : (
            companies && (
              <div className="max-w-sm">
                <label className="field-label" htmlFor="pr-company">
                  Company
                </label>
                {/* Every line is one company's, so the company holds once an
                    item is on the request. */}
                <select
                  id="pr-company"
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  disabled={lines.length > 0}
                  className="field cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
                  required
                >
                  <option value="">Pick a company</option>
                  {companies.map((c) => (
                    <option key={c.abbr} value={c.abbr}>
                      {c.company} ({c.sapDb})
                    </option>
                  ))}
                </select>
                {lines.length > 0 && (
                  <p className="mt-1 text-[11px] text-slate-500">
                    Remove the items to pick another company.
                  </p>
                )}
              </div>
            )
          )}

          {company && (
            <div className="relative">
              <label className="field-label" htmlFor="pr-search">
                Add an item
              </label>
              {/* A dropdown of the company's Engineering Stock items: opens on
                  click, narrows as you type. */}
              <div className="relative">
                <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-slate-400 pointer-events-none">
                  {items === null ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                </span>
                <input
                  id="pr-search"
                  ref={searchRef}
                  type="text"
                  role="combobox"
                  aria-expanded={open}
                  aria-controls="pr-items"
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
                  placeholder="Pick from the list, or type a code or name…"
                  className="field field-search pr-10"
                  autoComplete="off"
                />
                <button
                  type="button"
                  tabIndex={-1}
                  // mousedown, not click, so the input keeps its focus.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setOpen((o) => !o);
                    searchRef.current?.focus();
                  }}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600"
                  aria-label={open ? "Hide items" : "Show items"}
                >
                  <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
                </button>
              </div>
              {open && items && (
                <ul
                  id="pr-items"
                  role="listbox"
                  className="mt-1 max-h-60 overflow-y-auto divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white"
                >
                  {shown.length === 0 ? (
                    <li className="px-3 py-2 text-[13px] text-slate-500">
                      {items.length === 0
                        ? "No item of this company has a SAP code yet."
                        : term.trim()
                          ? "No item of this company with a SAP code matches."
                          : "Every item of this company is on the request already."}
                    </li>
                  ) : (
                    shown.map((p, i) => (
                      <li key={p.code} id={`pr-opt-${i}`} role="option" aria-selected={i === active}>
                        <button
                          type="button"
                          tabIndex={-1}
                          onMouseDown={(e) => e.preventDefault()}
                          onMouseEnter={() => setActive(i)}
                          onClick={() => addLine(p)}
                          className={`flex w-full items-baseline justify-between gap-3 px-3 py-2 text-left text-[13px] ${
                            i === active ? "bg-slate-100" : "hover:bg-slate-50"
                          }`}
                        >
                          <span className="min-w-0">
                            <span className="text-slate-800">{p.name}</span>{" "}
                            <span className="mono text-[11px] text-slate-500">SAP {p.sap.code}</span>
                          </span>
                          <span className="whitespace-nowrap text-[12px] text-slate-500">
                            {p.quantity} / min {p.minStock ?? 0} {p.unit}
                          </span>
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
          )}

          {lines.length > 0 && (
            <div className="table-card">
              <div className="table-scroll">
                <table className="tbl tbl-compact">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th className="text-right">On hand / min</th>
                      <th>Qty</th>
                      <th>Remarks</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l) => {
                      const low = Number(l.quantity) <= Number(l.minStock || 0);
                      return (
                        <tr key={l.code}>
                          <td>
                            <div className="min-w-[180px] max-w-[300px]">
                              <div className="cell-title break-words leading-snug">{l.name}</div>
                              <div className="mono text-[11px] text-slate-500">SAP {l.sapCode}</div>
                            </div>
                          </td>
                          <td
                            className={`text-right whitespace-nowrap ${low ? "text-amber-700" : "text-slate-700"}`}
                          >
                            {l.quantity} / {l.minStock ?? 0} {l.unit}
                          </td>
                          <td>
                            <input
                              type="number"
                              min="0"
                              step="any"
                              inputMode="decimal"
                              value={l.qty}
                              onChange={(ev) => setLine(l.code, "qty", ev.target.value)}
                              className="field field-sm w-28"
                              aria-label={`Quantity of ${l.name}`}
                            />
                          </td>
                          <td>
                            <input
                              type="text"
                              value={l.remarks}
                              onChange={(ev) => setLine(l.code, "remarks", ev.target.value)}
                              maxLength={100}
                              placeholder="Optional"
                              className="field field-sm w-48"
                              aria-label={`Remarks for ${l.name}`}
                            />
                          </td>
                          <td className="text-right">
                            <button
                              type="button"
                              onClick={() => removeLine(l.code)}
                              className="icon-btn icon-btn-danger"
                              title="Remove"
                              aria-label={`Remove ${l.name}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {company && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
              <div>
                <label className="field-label" htmlFor="pr-required-by">
                  Required by
                </label>
                <input
                  id="pr-required-by"
                  type="date"
                  value={requiredBy}
                  min={today()}
                  onChange={(e) => setRequiredBy(e.target.value)}
                  className="field"
                  required
                />
              </div>
              <div>
                <label className="field-label" htmlFor="pr-reason">
                  Reason
                </label>
                <textarea
                  id="pr-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="field field-area"
                  rows={2}
                  maxLength={250}
                  placeholder="Breakdown of mixer 3 / below minimum"
                  required
                />
              </div>
            </div>
          )}

          {error && <div className="note note-rose text-sm">{error}</div>}
        </div>

        <div className="modal-foot">
          <button type="button" onClick={onClose} className="btn btn-neutral">
            Cancel
          </button>
          <button type="submit" disabled={saving || lines.length === 0} className="btn btn-primary">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Raise purchase request
          </button>
        </div>
      </form>
    </div>
  );
};

export default PurchaseRequestModal;
