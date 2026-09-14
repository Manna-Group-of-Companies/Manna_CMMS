import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Keeps a half-finished form so closing it is not the same as throwing it away.
 *
 * Held in the browser, not on the server, and that is the right home for it: a
 * draft is one person's unfinished thought on one machine. Sending it to
 * ERPNext would make it a record other people can see and would leave the
 * catalog littered with requests nobody meant to raise.
 *
 * Every access is wrapped, because `localStorage` is not always there to be
 * written to — a private window, a browser set to block site data, or storage
 * that is simply full all throw on access rather than returning nothing. A
 * draft that cannot be saved is a small loss; a form that will not open because
 * saving one threw is a large one.
 */

const PREFIX = "cmms:draft:";

const read = (key) => {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const write = (key, value) => {
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
};

const remove = (key) => {
  try {
    window.localStorage.removeItem(PREFIX + key);
  } catch {
    /* nothing worth doing about it */
  }
};

/**
 * @param key      identifies the form; one draft per key
 * @param enabled  false turns the whole thing off, for a form that should not
 *                 keep one — editing an existing record, for instance, where a
 *                 stale draft would silently overwrite the real values
 * @param isWorthKeeping  decides whether what has been typed is worth calling a
 *                 draft. Without it, opening and closing a form with nothing
 *                 typed leaves a "draft" of its own default values.
 */
export const useFormDraft = (key, { enabled = true, isWorthKeeping = () => true } = {}) => {
  // Read once, on the first render, before anything has been typed. Reading
  // later would race the form's own initialisation and restore over it.
  const [restored] = useState(() => (enabled ? read(key) : null));
  const [savedAt, setSavedAt] = useState(() => restored?.savedAt || null);
  const timer = useRef(null);

  /**
   * Saves, but not on every keystroke.
   *
   * Debounced because this runs on each character typed, and localStorage
   * writes are synchronous — they block the main thread, which is felt as a
   * stutter in the field being typed into.
   */
  const save = useCallback(
    (payload) => {
      if (!enabled) return;

      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        if (!isWorthKeeping(payload)) {
          // What was typed has since been cleared out, so the draft should go
          // too rather than linger as something the user already abandoned.
          remove(key);
          setSavedAt(null);
          return;
        }
        const at = new Date().toISOString();
        if (write(key, { ...payload, savedAt: at })) setSavedAt(at);
      }, 400);
    },
    [key, enabled, isWorthKeeping]
  );

  /** Writes immediately, for closing — a debounce would not survive unmount. */
  const saveNow = useCallback(
    (payload) => {
      if (!enabled) return;
      if (timer.current) clearTimeout(timer.current);

      if (!isWorthKeeping(payload)) {
        remove(key);
        return;
      }
      write(key, { ...payload, savedAt: new Date().toISOString() });
    },
    [key, enabled, isWorthKeeping]
  );

  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    remove(key);
    setSavedAt(null);
  }, [key]);

  useEffect(() => () => timer.current && clearTimeout(timer.current), []);

  return { restored, savedAt, save, saveNow, clear };
};

/** "just now", "8 minutes ago" — a timestamp nobody has to decode. */
export const describeWhen = (iso) => {
  if (!iso) return "";
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "";

  const seconds = Math.round((Date.now() - then.getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) {
    const m = Math.round(seconds / 60);
    return `${m} minute${m === 1 ? "" : "s"} ago`;
  }
  if (seconds < 86_400) {
    const h = Math.round(seconds / 3600);
    return `${h} hour${h === 1 ? "" : "s"} ago`;
  }
  return then.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
};

export default useFormDraft;
