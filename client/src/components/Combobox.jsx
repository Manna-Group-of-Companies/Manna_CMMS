import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";

/**
 * A text box with suggestions, drawn like the app's dropdowns (21 Oct 2026).
 *
 * The <input list> + <datalist> it replaces opened the browser's own dark
 * list, which no stylesheet reaches. Anything may still be typed - the store
 * meets units nobody listed - and the suggestions narrow to what is typed.
 * The list sits in a portal so a scrolling form cannot clip it.
 *
 * `suggestions` are strings or `{ value, label }` (the label is what is shown
 * in the list, the value what goes in the box). `onChange` gets the text.
 */
const Combobox = ({ id, value, onChange, suggestions = [], placeholder, disabled = false, className = "field", wrapClassName = "", "aria-label": ariaLabel }) => {
  const listId = useId();
  const input = useRef(null);
  const list = useRef(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [typed, setTyped] = useState(false);
  const [box, setBox] = useState(null);

  const items = useMemo(
    () => suggestions.map((s) => (typeof s === "object" ? { value: String(s.value), label: s.label ?? String(s.value) } : { value: String(s), label: String(s) })),
    [suggestions]
  );
  // All of them on opening; once something is typed, the ones that start with it.
  // At most a couple of hundred - an HSN list runs to thousands, and typing a
  // few digits is quicker than scrolling them.
  const shown = useMemo(() => {
    const q = String(value ?? "").trim().toLowerCase();
    const hits = !typed || !q ? items : items.filter((i) => i.value.toLowerCase().startsWith(q) || i.label.toLowerCase().includes(q));
    return hits.slice(0, 200);
  }, [items, value, typed]);

  const place = () => {
    const r = input.current?.getBoundingClientRect();
    if (!r) return;
    const below = window.innerHeight - r.bottom;
    const up = below < 240 && r.top > below;
    setBox({ left: r.left, width: Math.max(r.width, 140), top: up ? undefined : r.bottom + 4, bottom: up ? window.innerHeight - r.top + 4 : undefined });
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

  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => {
      if (!input.current?.parentElement?.contains(e.target) && !list.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  useEffect(() => {
    if (active >= 0) list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const openList = () => {
    if (disabled) return;
    setTyped(false);
    setActive(Math.max(-1, items.findIndex((i) => i.value === String(value ?? ""))));
    setOpen(true);
  };

  const choose = (item) => {
    onChange?.(item.value);
    setOpen(false);
    input.current?.focus();
  };

  const onKeyDown = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) return openList();
      setActive((a) => Math.min(shown.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter" && open && shown[active]) {
      e.preventDefault();
      choose(shown[active]);
    } else if (e.key === "Escape" || e.key === "Tab") {
      setOpen(false);
    }
  };

  return (
    <div className={`relative ${wrapClassName}`}>
      <input
        ref={input}
        id={id}
        type="text"
        value={value ?? ""}
        onChange={(e) => {
          onChange?.(e.target.value);
          setTyped(true);
          setActive(-1);
          setOpen(true);
        }}
        onFocus={openList}
        onClick={() => !open && openList()}
        onKeyDown={onKeyDown}
        disabled={disabled}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-autocomplete="list"
        aria-label={ariaLabel}
        className={`${className} w-full pr-7 ${open ? "border-brand-500 ring-2 ring-brand-500/20" : ""}`}
      />
      <button
        type="button"
        tabIndex={-1}
        disabled={disabled}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => (open ? setOpen(false) : (input.current?.focus(), openList()))}
        className="absolute inset-y-0 right-1.5 flex items-center text-slate-400 disabled:opacity-50"
        aria-label="Show the choices"
      >
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open &&
        box &&
        shown.length > 0 &&
        createPortal(
          <ul
            ref={list}
            id={listId}
            role="listbox"
            className="fixed z-[1000] max-h-60 overflow-auto rounded-xl border border-slate-200 bg-white py-1 shadow-xl shadow-slate-900/10"
            style={{ left: box.left, width: box.width, top: box.top, bottom: box.bottom }}
          >
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
                  className={`mx-1 cursor-pointer rounded-lg px-2.5 py-1.5 text-[13px] ${
                    i === active ? "bg-brand-50 text-brand-800" : "text-slate-700"
                  } ${selected ? "font-semibold" : ""}`}
                >
                  {item.label}
                </li>
              );
            })}
          </ul>,
          document.body
        )}
    </div>
  );
};

export default Combobox;
