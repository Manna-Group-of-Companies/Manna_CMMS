import { useCallback, useEffect, useRef, useState } from "react";
import { CloudOff, Loader2, RefreshCw, Wifi, WifiOff } from "lucide-react";
import API from "../services/api";

/**
 * Tells the person when the app has lost its connection, and when it is back.
 *
 *   offline       the device has no network (Wi-Fi dropped, cable out)
 *   unreachable   the network is up but the server is not answering
 *                 (it is down or restarting) - raised by services/api.js
 *                 when a request gets no response at all
 *
 * While unreachable it checks again on its own every 15 seconds, and the
 * Retry button checks at once. Any answer from the server counts as back -
 * even an error status means it is there.
 */
const RECHECK_MS = 15_000;

const NetworkStatus = () => {
  const [offline, setOffline] = useState(() => typeof navigator !== "undefined" && !navigator.onLine);
  const [unreachable, setUnreachable] = useState(false);
  const [checking, setChecking] = useState(false);
  const [backOnline, setBackOnline] = useState(false);
  const wasDown = useRef(false);

  // A plain fetch rather than the API client: it carries no token, so a 401
  // here cannot trigger the client's sign-out redirect.
  const check = useCallback(async () => {
    setChecking(true);
    try {
      await fetch(API.defaults.baseURL, { method: "GET", cache: "no-store" });
      setUnreachable(false);
    } catch {
      setUnreachable(true);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    const goOffline = () => setOffline(true);
    const goOnline = () => {
      setOffline(false);
      check(); // the network is back; is the server?
    };
    const onReach = (e) => setUnreachable(!e.detail.reachable);
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    window.addEventListener("api:reachability", onReach);
    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
      window.removeEventListener("api:reachability", onReach);
    };
  }, [check]);

  // Keep trying while the server is away (no point while the device is offline).
  useEffect(() => {
    if (!unreachable || offline) return undefined;
    const timer = setInterval(check, RECHECK_MS);
    return () => clearInterval(timer);
  }, [unreachable, offline, check]);

  // "Back online" for a few seconds after a real outage ends.
  const down = offline || unreachable;
  useEffect(() => {
    if (down) {
      wasDown.current = true;
      setBackOnline(false);
      return undefined;
    }
    if (!wasDown.current) return undefined;
    wasDown.current = false;
    setBackOnline(true);
    const timer = setTimeout(() => setBackOnline(false), 3500);
    return () => clearTimeout(timer);
  }, [down]);

  if (!down && !backOnline) return null;

  const tone = offline
    ? {
        icon: WifiOff,
        title: "You're offline",
        text: "Check your internet connection. Changes won't save until it's back.",
        cls: "border-slate-700 bg-slate-900 text-white",
        tile: "bg-white/10 text-white",
        sub: "text-slate-300",
      }
    : unreachable
      ? {
          icon: CloudOff,
          title: "Can't reach the server",
          text: "Your internet is working, but the CMMS server isn't answering. Retrying…",
          cls: "border-amber-200 bg-amber-50 text-amber-950",
          tile: "bg-amber-100 text-amber-700",
          sub: "text-amber-800",
        }
      : {
          icon: Wifi,
          title: "Back online",
          text: "Connection restored.",
          cls: "border-emerald-200 bg-emerald-50 text-emerald-950",
          tile: "bg-emerald-100 text-emerald-700",
          sub: "text-emerald-800",
        };
  const Icon = tone.icon;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-[75] flex justify-center px-4">
      <div
        role={down ? "alert" : "status"}
        className={`pointer-events-auto flex w-full max-w-lg items-center gap-3 rounded-xl border px-3.5 py-3 shadow-[0_12px_32px_-8px_rgba(16,24,40,0.3)] animate-rise-in ${tone.cls}`}
      >
        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${tone.tile}`}>
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold leading-tight">{tone.title}</p>
          <p className={`mt-0.5 text-[13px] leading-snug ${tone.sub}`}>{tone.text}</p>
        </div>
        {unreachable && !offline && (
          <button
            type="button"
            onClick={check}
            disabled={checking}
            className="btn btn-sm shrink-0 border border-amber-300 bg-white text-amber-900 hover:bg-amber-100"
          >
            {checking ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
            )}
            Retry
          </button>
        )}
      </div>
    </div>
  );
};

export default NetworkStatus;
