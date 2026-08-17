import { useEffect, useRef, useState } from "react";
import API from "../services/api";
import { Copy, MapPin, Loader2 } from "lucide-react";

/**
 * Duplicate item prevention (ST-14).
 *
 * The store's problem is not people typing the same name twice — it is the
 * same bearing arriving under a slightly different name a year apart. The
 * matching is done on the server (`utils/duplicateCheck.js`); this shows what
 * it found, with enough of each match (room, rack, stock) to tell at a glance
 * whether it really is the same thing.
 */

/** Below this many characters a name is too vague to check usefully. */
const MIN_NAME = 3;

/**
 * Watches the name/code being entered and reports catalog items that look like
 * it. Debounced, and tolerant of failure — the same check runs again on save,
 * where it can actually stop the write.
 */
export const useDuplicateCheck = ({
  name = "",
  code = "",
  brand = "",
  category = "",
  excludeId = "",
  enabled = true,
}) => {
  const [matches, setMatches] = useState([]);
  const [checking, setChecking] = useState(false);
  const latest = useRef(0);

  const trimmedName = name.trim();
  const active = enabled && trimmedName.length >= MIN_NAME;

  useEffect(() => {
    if (!active) {
      setMatches([]);
      return undefined;
    }

    const ticket = ++latest.current;
    const timer = setTimeout(async () => {
      try {
        setChecking(true);
        const { data } = await API.get("/products/duplicates", {
          params: { name: trimmedName, code, brand, category, excludeId },
        });
        if (latest.current === ticket) setMatches(data.matches || []);
      } catch {
        if (latest.current === ticket) setMatches([]);
      } finally {
        if (latest.current === ticket) setChecking(false);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [active, trimmedName, code, brand, category, excludeId]);

  return { matches, checking };
};

/**
 * The warning panel. Renders nothing when there is nothing to warn about, so
 * it can be dropped into a form unconditionally.
 */
const DuplicateWarning = ({ matches = [], checking = false, heading }) => {
  if (checking && !matches.length) {
    return (
      <p className="text-[11px] text-slate-400 flex items-center gap-1">
        <Loader2 className="h-3 w-3 animate-spin" /> Checking for existing items…
      </p>
    );
  }

  if (!matches.length) return null;

  const exact = matches.some((match) => match.exact);

  return (
    <div className={`note ${exact ? "note-rose" : "note-amber"} flex-col gap-2 items-start`}>
      <span className="font-bold flex items-center gap-1.5">
        <Copy className="h-4 w-4" />
        {heading ||
          (exact
            ? "This item is already in the catalog"
            : `${matches.length} similar item${matches.length > 1 ? "s" : ""} already exist${
                matches.length > 1 ? "" : "s"
              }`)}
      </span>

      <ul className="w-full space-y-1.5">
        {matches.map((match) => (
          <li
            key={match._id}
            className="flex items-start justify-between gap-3 rounded-lg bg-white/70 px-2.5 py-2"
          >
            <div className="min-w-0">
              <p className="font-bold text-slate-900 text-xs break-words">{match.name}</p>
              <p className="text-[11px] text-slate-500 flex flex-wrap items-center gap-x-2">
                <span>{match.code}</span>
                <span className="inline-flex items-center gap-0.5">
                  <MapPin className="h-3 w-3" />
                  {match.storeRoom}
                  {match.rackNumber ? ` · ${match.rackNumber}` : ""}
                </span>
                <span>
                  {match.quantity} {match.unit} in stock
                </span>
              </p>
            </div>
            <span className="badge badge-slate shrink-0 text-[10px]">{match.reason}</span>
          </li>
        ))}
      </ul>

      <span className="text-slate-500">
        Add stock to the existing item instead of creating a second record — or confirm below
        if this really is a different item.
      </span>
    </div>
  );
};

export default DuplicateWarning;
