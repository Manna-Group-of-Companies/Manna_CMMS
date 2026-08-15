/**
 * Brute-force guard for the one route that has to stay public.
 *
 * Every account signs in with a name and a four-digit PIN — ten thousand
 * possibilities. An endpoint that answers as fast as it can give that up in
 * minutes, and a PIN is the whole credential: there is no second factor and no
 * password behind it. So failures are counted and, past a threshold, refused
 * for a while.
 *
 * Counted two ways, because either one alone is easy to walk around:
 *
 *   by account — one name cannot be hammered from a hundred addresses
 *   by address — one address cannot sweep a hundred names
 *
 * Held in memory rather than in the database. A restart clears it, which is a
 * real limit, but it costs no round trip on the hot path and survives the case
 * that matters: a sustained run against a live server.
 */

/** How long failures are remembered for. */
const WINDOW_MS = 15 * 60_000;

/** Failures allowed inside the window before the lock applies. */
const MAX_PER_ACCOUNT = 5;
const MAX_PER_ADDRESS = 20;

/** How long a locked key stays refused. */
const LOCK_MS = 15 * 60_000;

/** Old entries are swept on write rather than on a timer. */
const SWEEP_EVERY = 500;

const accounts = new Map();
const addresses = new Map();
let writes = 0;

const now = () => Date.now();

const sweep = () => {
  const cutoff = now();
  for (const map of [accounts, addresses]) {
    for (const [key, entry] of map) {
      if (entry.lockedUntil <= cutoff && entry.windowEndsAt <= cutoff) map.delete(key);
    }
  }
};

const accountKeyOf = (req) => String(req.body?.name ?? "").trim().toLowerCase();

/**
 * The client address. `trust proxy` is set on the app, so this is the real
 * caller behind Render's load balancer rather than the balancer itself —
 * without it every request in production shares one address and the per-address
 * counter would lock out the whole site at once.
 */
const addressKeyOf = (req) => req.ip || req.socket?.remoteAddress || "unknown";

const readEntry = (map, key) => {
  const entry = map.get(key);
  if (!entry) return null;

  // A window that has run out starts the count again; a lock that has run out
  // clears with it.
  if (entry.windowEndsAt <= now() && entry.lockedUntil <= now()) {
    map.delete(key);
    return null;
  }
  return entry;
};

const bump = (map, key, max) => {
  if (!key) return;

  const entry = readEntry(map, key) ?? {
    count: 0,
    windowEndsAt: now() + WINDOW_MS,
    lockedUntil: 0,
  };

  entry.count += 1;
  if (entry.count >= max) {
    entry.lockedUntil = now() + LOCK_MS;
    // The next attempt after the lock starts from a clean window, so a locked
    // account is not locked again by the failures that locked it.
    entry.count = 0;
    entry.windowEndsAt = now() + LOCK_MS + WINDOW_MS;
  }

  map.set(key, entry);

  writes += 1;
  if (writes % SWEEP_EVERY === 0) sweep();
};

const lockedFor = (map, key) => {
  if (!key) return 0;
  const entry = readEntry(map, key);
  if (!entry) return 0;
  const remaining = entry.lockedUntil - now();
  return remaining > 0 ? remaining : 0;
};

/**
 * Refuses the attempt while either counter is locked. Sits in front of the
 * login handler, so a locked caller never reaches the PIN comparison.
 */
export const loginRateLimit = (req, res, next) => {
  const remaining = Math.max(
    lockedFor(accounts, accountKeyOf(req)),
    lockedFor(addresses, addressKeyOf(req))
  );

  if (remaining <= 0) return next();

  const minutes = Math.ceil(remaining / 60_000);
  res.set("Retry-After", String(Math.ceil(remaining / 1000)));
  return res.status(429).json({
    message: `Too many failed sign-in attempts. Try again in ${minutes} minute${
      minutes === 1 ? "" : "s"
    }.`,
  });
};

/** Called by the login handler when a PIN did not match. */
export const recordLoginFailure = (req) => {
  bump(accounts, accountKeyOf(req), MAX_PER_ACCOUNT);
  bump(addresses, addressKeyOf(req), MAX_PER_ADDRESS);
};

/** Called on a successful sign-in, so an honest typo costs nothing. */
export const recordLoginSuccess = (req) => {
  accounts.delete(accountKeyOf(req));
  addresses.delete(addressKeyOf(req));
};
