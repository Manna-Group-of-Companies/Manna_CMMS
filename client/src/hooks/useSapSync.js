import { useEffect, useRef } from "react";

/**
 * "A SAP run just finished" - announced in the top bar, heard by the page.
 *
 * The sync button used to sit on Engineering Stock and reload that list through
 * an `onDone` prop when a run finished. It lives in the top bar now, which has
 * no idea what is underneath it, and a run that finishes without the page
 * noticing is the worst of both: the quantities on screen are exactly the ones
 * the user pressed the button to replace.
 *
 * A window event rather than a context because the only thing being shared is
 * "it finished" - no state, no ordering, and a page that does not care simply
 * does not listen.
 */
export const SAP_SYNC_DONE = "manna:sap-sync-done";

export const announceSapSyncDone = () => window.dispatchEvent(new Event(SAP_SYNC_DONE));

/**
 * Run `handler` whenever a SAP sync finishes.
 *
 * The handler goes through a ref so a page can pass an inline arrow - which is
 * a new function on every render - without the listener being torn down and
 * re-added each time.
 */
export const useSapSyncDone = (handler) => {
  const ref = useRef(handler);
  ref.current = handler;

  useEffect(() => {
    const fire = () => ref.current?.();
    window.addEventListener(SAP_SYNC_DONE, fire);
    return () => window.removeEventListener(SAP_SYNC_DONE, fire);
  }, []);
};
