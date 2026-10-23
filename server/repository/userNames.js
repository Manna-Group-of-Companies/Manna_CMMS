import { listAll } from "../integrations/erpnext/client.js";

/**
 * People's names for the accounts records are stamped with.
 *
 * ERPNext stamps "raised by", "requested by", "reported by" and "attended
 * by" with the account's login - an email address - and the screens were
 * printing that. The name lives on the User record; this reads every user
 * once and keeps the map for ten minutes, so a list of a hundred requests
 * costs one lookup rather than a hundred.
 *
 * The email itself is never replaced: permission checks and "is this mine"
 * compare against it. Callers add a `<field>Name` beside it instead.
 */
const TTL_MS = 10 * 60 * 1000;
let cache = { at: 0, names: new Map(), pending: null };

const load = async () => {
  const users = await listAll("User", { fields: ["name", "full_name"] });
  return new Map(users.map((u) => [u.name, (u.full_name || "").trim()]));
};

/** email -> full name. A failed read leaves the last map in place (or empty). */
export const userNames = async () => {
  if (Date.now() - cache.at < TTL_MS) return cache.names;
  if (!cache.pending) {
    cache.pending = load()
      .then((names) => {
        cache = { at: Date.now(), names, pending: null };
        return names;
      })
      .catch(() => {
        cache.pending = null;
        return cache.names;
      });
  }
  return cache.pending;
};

/** The name for one account: its full name, or the login itself when it has none. */
export const nameFor = (names, email) => (email ? names.get(email) || email : "");

/**
 * Adds `<field>Name` to each row for the listed email fields, in place, and
 * returns the rows. Works on one row or a list.
 *
 *   await withNames(rows, ["raisedBy"])   // each row gains raisedByName
 */
export const withNames = async (rowsOrRow, fields) => {
  const rows = Array.isArray(rowsOrRow) ? rowsOrRow : [rowsOrRow];
  if (!rows.length) return rowsOrRow;
  const names = await userNames();
  for (const row of rows) {
    if (!row) continue;
    for (const f of fields) {
      // Never overwrite a name a record already carries (Miscellaneous
      // Requests store their own raisedByName).
      if (row[`${f}Name`]) continue;
      if (row[f]) row[`${f}Name`] = nameFor(names, row[f]);
    }
  }
  return rowsOrRow;
};
