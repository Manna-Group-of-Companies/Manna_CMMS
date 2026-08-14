import { useEffect, useRef } from "react";

/** How often a screen re-reads the API when nothing else prompts it. */
export const REFRESH_INTERVAL_MS = 10000;

/**
 * Keeps a page in step with the backend without the user reloading.
 *
 * The Admin console and the Supervisor app write to the same records, so a
 * page that fetched once would drift as soon as the other side changed
 * something. This re-runs [fetcher]:
 *
 *   - on an interval while the tab is visible,
 *   - the moment the tab becomes visible again,
 *   - when the window regains focus.
 *
 * Polling stops while the tab is hidden — a background tab that nobody is
 * reading does not need to keep hitting the API, and the visibility handler
 * brings it right back up to date on return.
 *
 * [fetcher] is held in a ref, so callers can pass a plain inline function
 * without wrapping it in `useCallback` or restarting the timer every render.
 */
export const useAutoRefresh = (fetcher, { intervalMs = REFRESH_INTERVAL_MS, enabled = true } = {}) => {
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    if (!enabled) return undefined;

    const run = () => fetcherRef.current?.();

    let timer = null;
    const start = () => {
      if (timer === null) timer = setInterval(run, intervalMs);
    };
    const stop = () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        run();
        start();
      } else {
        stop();
      }
    };

    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", run);

    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", run);
    };
  }, [intervalMs, enabled]);
};

export default useAutoRefresh;
