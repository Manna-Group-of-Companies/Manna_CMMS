import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Search } from "lucide-react";

/**
 * A dropdown that looks like the rest of the app (21 Oct 2026).
 *
 * A native <select> opens the browser's own grey list, which no stylesheet
 * reaches. This draws the list itself - in a portal, so a modal's scrolling
 * body cannot clip it - and takes the same props a <select> did: `value`, and
 * an `onChange` handed an event-shaped `{ target: { value, name } }`, so a
 * handler written for a <select> keeps working unchanged.
 *
 * `options` is a list of strings or `{ value, label }`. `placeholder` is the
 * empty choice ("All categories", "Choose…"), offered first when given. Long
 * lists get a search box. `required` is enforced by the browser as before,
 * through a hidden input that carries the value. `className` styles the field
 * itself (the usual `field field-sm`); `wrapClassName` places it in a layout
 * (width, grid span), which on a <select> the same className did.
 */
const SEARCH_FROM = 10;

const Select = ({
  value,
  onChange,
  options = [],
  placeholder,
  disabled = false,
  required = false,
  className = "field",
  wrapClassName = "w-full",
  id,
  name,
  "aria-label": ariaLabel,
}) => {
  const listId = useId();
  const button = useRef(null);
  const list = useRef(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [box, setBox] = useState(null);

  const items = useMemo(() => {
    const all = options.map((o) => (typeof o === "object" ? { value: String(o.value), label: o.label ?? String(o.value) } : { value: String(o), label: String(o) }));
    return placeholder !== undefined ? [{ value: "", label: placeholder, empty: true }, ...all] : all;
  }, [options, placeholder]);
  const searchable = items.length > SEARCH_FROM;
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? items.filter((i) => !i.empty && i.label.toLowerCase().includes(q)) : items;
  }, [items, query]);

  const current = items.find((i) => i.value === String(value ?? ""));
  const label = current ? current.label : value ? String(value) : placeholder ?? "";

  // Where the list goes: under the button, or above it when the page has no room below.
  const place = () => {
    const r = button.current?.getBoundingClientRect();
    if (!r) return;
    const below = window.innerHeight - r.bottom;
    const up = below < 260 && r.top > below;
    setBox({ left: r.left, width: Math.max(r.width, 180), top: up ? undefined : r.bottom + 4, bottom: up ? window.innerHeight - r.top + 4 : undefined });
  };

  useLayoutEffect(() => {
    if (!open) return undefined;
    place();
    const follow = () => place();
    window.addEventListener("resize", follow);
    window.addEventListener("scroll", follow, true);
    return () => {
      window.removeEventListener("resize", follow);
      window.removeEventListener("scroll", follow, true);
    };
  }, [open]);

  // A click anywhere else closes it.
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => {
      if (!button.current?.contains(e.target) && !list.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  // Opening starts on the chosen option, and keeps it in view.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(Math.max(0, items.findIndex((i) => i.value === String(value ?? ""))));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const choose = (item) => {
    setOpen(false);
    button.current?.focus();
    if (item.value !== String(value ?? "")) onChange?.({ target: { value: item.value, name } });
  };

  const onKeyDown = (e) => {
    if (disabled) return;
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (e.key === "Escape" || e.key === "Tab") {
      if (e.key === "Escape") e.preventDefault();
      setOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(shown.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (shown[active]) choose(shown[active]);
    }
  };

  return (
    <div className={`relative ${wrapClassName}`}>
      <button
        ref={button}
        id={id}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={ariaLabel}
        className={`${className} flex w-full cursor-pointer items-center justify-between gap-2 text-left disabled:cursor-not-allowed disabled:opacity-60 ${
          open ? "border-brand-500 ring-2 ring-brand-500/20" : ""
        }`}
      >
        <span className={`min-w-0 flex-1 truncate ${current?.empty || !label ? "text-slate-400" : "text-slate-900"}`}>{label || " "}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {/* The browser still enforces `required`, on this. */}
      {required && (
        <input
          tabIndex={-1}
          aria-hidden="true"
          required
          value={value ?? ""}
          onChange={() => {}}
          onFocus={() => button.current?.focus()}
          className="pointer-events-none absolute inset-x-0 bottom-0 h-px opacity-0"
        />
      )}

      {open &&
        box &&
        createPortal(
          <div
            ref={list}
            className="fixed z-[1000] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl shadow-slate-900/10"
            style={{ left: box.left, width: box.width, top: box.top, bottom: box.bottom }}
            onKeyDown={onKeyDown}
          >
            {searchable && (
              <div className="relative border-b border-slate-100 p-2">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setActive(0);
                  }}
                  placeholder="Search…"
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 py-1.5 pl-7 pr-2 text-[13px] outline-none focus:border-brand-500 focus:bg-white"
                />
              </div>
            )}
            <ul id={listId} role="listbox" className="max-h-64 overflow-auto py-1">
              {shown.map((item, i) => {
                const selected = item.value === String(value ?? "");
                return (
                  <li
                    key={`${item.value}-${i}`}
                    data-index={i}
                    role="option"
                    aria-selected={selected}
                    onMouseEnter={() => setActive(i)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => choose(item)}
                    className={`mx-1 flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] ${
                      i === active ? "bg-brand-50 text-brand-800" : "text-slate-700"
                    } ${item.empty ? "text-slate-500" : ""} ${selected ? "font-semibold" : ""}`}
                  >
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {selected && <Check className="h-3.5 w-3.5 shrink-0 text-brand-600" />}
                  </li>
                );
              })}
              {!shown.length && <li className="px-3 py-2 text-[13px] text-slate-400">Nothing matches</li>}
            </ul>
          </div>,
          document.body
        )}
    </div>
  );
};

export default Select;
