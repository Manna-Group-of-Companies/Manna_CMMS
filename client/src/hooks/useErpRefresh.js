import { useEffect, useRef, useSyncExternalStore } from "react";

/**
 * "Read ERPNext again" - pressed in the top bar, carried out by the page.
 *
 * The same split as the SAP sync (useSapSync.js): the button lives in the
 * Navbar, which knows nothing of the list underneath it. Unlike the sync, the
 * bar needs to know whether anybody is listening - a Refresh button on a
 * screen that ignores it is a button that does nothing - so the handlers are
 * kept in a set the bar can count, rather than a window event.
 *
 * The page's own reload is used, not a remount, so the filters and search a
 * person has set survive the refresh.
 */
const handlers = new Set();
const watchers = new Set();

const notify = () => watchers.forEach((w) => w());

const subscribe = (watcher) => {
  watchers.add(watcher);
  return () => watchers.delete(watcher);
};

/**
 * The console's own reload, for a screen that registers none: the layout
 * remounts the page, which reads everything again (23 Oct 2026 - Refresh is
 * offered on every view). A page's own reload, where it has one, is preferred
 * because it keeps the filters and search.
 */
let fallback = null;

/** True while the open page has a reload registered, or the console has one. */
export const useHasErpRefresh = () =>
  useSyncExternalStore(subscribe, () => handlers.size > 0 || fallback !== null);

/** Runs every registered reload, and settles when they all have. */
export const refreshFromErp = () => {
  const run = handlers.size > 0 ? [...handlers] : fallback ? [fallback] : [];
  return Promise.allSettled(run.map((h) => Promise.resolve().then(h)));
};

/** Registers the console's remount as the reload for pages without their own. */
export const useErpRefreshFallback = (handler) => {
  const ref = useRef(handler);
  ref.current = handler;

  useEffect(() => {
    const run = () => ref.current?.();
    fallback = run;
    notify();
    return () => {
      if (fallback === run) fallback = null;
      notify();
    };
  }, []);
};

/**
 * Registers `handler` as this page's ERPNext reload for as long as it is
 * mounted. Held in a ref, so an inline arrow does not re-register each render.
 */
export const useErpRefresh = (handler) => {
  const ref = useRef(handler);
  ref.current = handler;

  useEffect(() => {
    const run = () => ref.current?.();
    handlers.add(run);
    notify();
    return () => {
      handlers.delete(run);
      notify();
    };
  }, []);
};
