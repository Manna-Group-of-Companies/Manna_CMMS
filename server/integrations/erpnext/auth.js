import { ErpError, asUser, getDoc, request } from "./client.js";
import { erpBaseUrl, erpHasCredentials } from "./config.js";

/**
 * Signing people in against ERPNext.
 *
 * Replaces the name-and-PIN login the tablets used, because Frappe has no
 * concept of a PIN — its accounts are an email and a password, and the whole
 * point of moving onto ERPNext is that there is one list of people rather than
 * two that drift apart.
 *
 * --- What this does and does not do ------------------------------------
 *
 * A sign-in is verified against ERPNext, so the password is ERPNext's and is
 * never stored here. The Frappe session id that comes back is kept on the
 * server; the client is given this server's own token instead, so an ERPNext
 * credential never reaches a tablet or a browser bundle.
 *
 * Reads can then be made as that person, which is what makes ERPNext apply
 * their permissions and hide what they are not allowed to see.
 *
 * Writes are deliberately made as the integration account instead. Frappe
 * applies CSRF validation to cookie-authenticated writes — a protection aimed
 * at browsers, which a server-to-server caller has to work around — while
 * token authentication is exempt. Attribution does not suffer for it: every
 * CMMS DocType carries a Link to User (`supervisor`, `counted_by`,
 * `returned_by`, `requested_by`), so who did what is recorded on the document
 * itself rather than inferred from which key made the HTTP call.
 *
 * If you would rather have ERPNext enforce permissions on writes too, pass
 * `as: asUser(sid)` to the write helpers. That path is built but has not been
 * exercised against this instance, so verify it before relying on it.
 */

/**
 * ERPNext role to the role this application uses.
 *
 * A mapping rather than a rename, because the two vocabularies answer
 * different questions. ERPNext's roles say what a person may do to stock
 * documents; these say which screens they get. Somebody can hold several
 * ERPNext roles, so the most privileged wins.
 *
 * The three `Store …` roles are this application's own, created because the
 * names the business uses were either taken or too general to sit safely among
 * ERPNext's forty-nine: `Maintenance Manager` already exists as a built-in for
 * Asset Maintenance, and a bare `Manager` or `Supervisor` would be ambiguous
 * in the role picker.
 *
 * `System Manager` is kept above them so whoever administers ERPNext can
 * always get in — otherwise a misassigned role locks everybody out with no way
 * back in through this application.
 *
 * The old `Branch` role is gone. It existed so a branch could ask its store
 * for stock, and that request flow has been retired.
 */
const ROLE_MAP = [
  ["System Manager", "Manager"],
  ["Store Manager", "Manager"],
  ["Store Maintenance Manager", "Maintenance Manager"],
  /**
   * The board and the operations office.
   *
   * `Higher Management` is one role covering the MD, the executive director
   * and the general manager: the business asked for them to be treated as a
   * single audience, and three roles that were always assigned together would
   * only be three places to forget to change.
   *
   * Both sit above `Plant Manager` so that somebody who is both — a director
   * who also runs a site — keeps the group-wide view rather than being
   * narrowed to one plant.
   */
  ["Higher Management", "Higher Management"],
  ["VP Operations", "VP Operations"],
  ["Store Supervisor", "Supervisor"],
  /**
   * The production managers, one per company.
   *
   * They are not store people: they browse the whole catalog to find out who
   * holds a spare, and they report breakdowns on their own plant. The ERPNext
   * role is called "Plant Manager" because that is what Module 2's workflow
   * already names in its transitions; the CMMS calls it Production Manager
   * because that is what these people are called on site.
   *
   * Below the store roles deliberately: somebody who is both keeps the store
   * view, which is the more capable one.
   */
  ["Plant Manager", "Production Manager"],
  // Kept below the Store roles so an existing stock account still reaches the
  // store screens while people are being moved across.
  ["Stock Manager", "Supervisor"],
  ["Stock User", "Supervisor"],
];

/** Most privileged first, so `find` picks the right one. */
export const cmmsRoleFor = (erpRoles) => {
  const held = new Set(erpRoles || []);
  const match = ROLE_MAP.find(([erpRole]) => held.has(erpRole));
  return match ? match[1] : null;
};

/**
 * Pulls the session id out of the login response.
 *
 * `getSetCookie` returns the headers unmerged, which matters: a login sets
 * several cookies and reading the combined string would splice them together
 * and pick up whatever followed `sid=`.
 */
const readSid = (headers) => {
  const cookies =
    typeof headers.getSetCookie === "function"
      ? headers.getSetCookie()
      : [headers.get("set-cookie")].filter(Boolean);

  for (const cookie of cookies) {
    const match = /(?:^|;\s*)sid=([^;]+)/.exec(cookie);
    if (match && match[1] && match[1] !== "Guest") return match[1];
  }
  return "";
};

/**
 * Verifies an email and password against ERPNext.
 *
 * Returns the person, their roles, and the session id — or throws an ErpError
 * whose 401 the caller turns into "wrong email or password". The distinction
 * between a bad password and an unreachable ERPNext matters: one is the user's
 * problem and the other is ours, and telling a supervisor to check their
 * password while Frappe Cloud is down wastes everybody's morning.
 */
export const signIn = async (email, password) => {
  if (!erpBaseUrl()) {
    throw new ErpError("ERPNext is not configured", { retryable: false });
  }
  if (!email || !password) {
    throw new ErpError("Email and password are required", { status: 401 });
  }

  // No credentials on this call: it is the call that establishes them.
  const { headers } = await request("POST", "/api/method/login", {
    body: { usr: String(email).trim(), pwd: String(password) },
    raw: true,
    skipConfigCheck: true,
    as: { kind: "none" },
  });

  const sid = readSid(headers);
  if (!sid) {
    throw new ErpError("ERPNext accepted the login but issued no session", {
      status: 502,
      retryable: true,
    });
  }

  // Read as the person who just signed in. Frappe lets a user read their own
  // User record, so this needs no integration key — which is what keeps a
  // sign-in working before the background sync has been configured.
  const profile = await describe(String(email).trim(), { as: asUser(sid) });
  return { ...profile, sid };
};

/**
 * Who a person is, as far as this application is concerned.
 *
 * Read as the person themselves when a session is passed, because Frappe lets
 * a user read their own User record and that avoids needing the integration
 * key just to sign somebody in. Falls back to the integration account, which
 * is what the middleware uses when it has to re-establish an identity after a
 * restart and no session survives.
 */
const rolesOf = (user) => (user?.roles || []).map((row) => row.role).filter(Boolean);

/**
 * A 401 from the integration account is this server's problem, not the
 * person's.
 *
 * Both failures are a bare 401 and they mean opposite things: the sign-in
 * handler turns a 401 into "Wrong email or password", so a rejected API key
 * told everybody their password was wrong while it was perfectly correct. The
 * only clue was that admins could still sign in - a System Manager reads its
 * own roles and never reaches this lookup - which made it look like an account
 * problem on exactly the accounts that were fine.
 */
const asKeyFailure = (error) => {
  if (error?.status !== 401) return error;
  return new ErpError(
    "Your password was accepted, but this server's own ERPNext API key was rejected, " +
      "so your roles could not be read. Ask an administrator to reissue " +
      "ERPNEXT_API_KEY and ERPNEXT_API_SECRET in server/.env.",
    { status: 503, code: "ERP_KEY_REJECTED" }
  );
};

export const describe = async (email, { as } = {}) => {
  const canUseIntegration = erpHasCredentials();

  let user = await getDoc("User", email, { as }).catch(async (error) => {
    // A user who cannot read their own record at all is unusual but possible,
    // depending on how permissions have been tightened. Only worth falling
    // back when there is an integration account to fall back to; otherwise the
    // fallback fails on missing credentials and reports *that*, burying the
    // real reason.
    if (as && canUseIntegration && (error?.isPermissionError || error?.status === 404)) {
      return getDoc("User", email).catch((fallbackError) => {
        throw asKeyFailure(fallbackError);
      });
    }
    throw error;
  });

  let roles = rolesOf(user);

  /**
   * The roles table is the part a person cannot see about themselves.
   *
   * ERPNext lets somebody read their own User record but strips the `roles`
   * child table unless they can also read `Has Role` — which a Stock Manager
   * cannot. So a perfectly good account comes back looking as though it holds
   * no roles at all. Re-read as the integration account, which can see them.
   */
  if (roles.length === 0 && as && canUseIntegration) {
    user = await getDoc("User", email).catch((error) => {
      throw asKeyFailure(error);
    });
    roles = rolesOf(user);
  }

  if (user.enabled === 0) {
    throw new ErpError("That ERPNext account is disabled", { status: 403 });
  }

  // Without the integration account there is no way to tell "this person holds
  // no stock role" from "this server was not allowed to look". Saying the
  // first when it might be the second sends somebody to an administrator to
  // fix a permission that was never wrong.
  if (roles.length === 0 && !canUseIntegration) {
    throw new ErpError(
      "This server could not read your ERPNext roles. Set ERPNEXT_API_KEY and ERPNEXT_API_SECRET so it can look them up.",
      { status: 503 }
    );
  }

  const role = cmmsRoleFor(roles);

  if (!role) {
    throw new ErpError(
      "That account holds no CMMS role in ERPNext. Ask an administrator to give it " +
        "Store Manager, Store Maintenance Manager, Store Supervisor, Plant Manager, " +
        "Higher Management or VP Operations.",
      { status: 403 }
    );
  }

  return {
    email: user.name,
    fullName: user.full_name || user.name,
    role,
    erpRoles: roles,
  };
};

/** Ends a Frappe session. Best effort: a stale session expires by itself. */
export const signOut = async (sid) => {
  if (!sid) return;
  try {
    await request("GET", "/api/method/logout", { as: asUser(sid) });
  } catch {
    // A session that is already gone is the outcome we wanted.
  }
};

/** The user a session belongs to, or "" if it has expired. */
export const whoami = async (sid) => {
  try {
    const user = await request("GET", "/api/method/frappe.auth.get_logged_user", {
      as: asUser(sid),
    });
    return user && user !== "Guest" ? String(user) : "";
  } catch (error) {
    if (error instanceof ErpError && (error.isAuthError || error.isPermissionError)) return "";
    throw error;
  }
};

/**
 * Frappe sessions expire, and this server may restart, so a session id is not
 * something to depend on for the life of a login.
 *
 * Held in memory on purpose for now: the alternative is another datastore, and
 * removing one is the point of this work. The consequence is that a deploy
 * drops every session — reads then fall back to the integration account rather
 * than failing, and the next sign-in re-establishes one.
 */
const sessions = new Map();

/** How long a session is trusted before the user is asked to sign in again. */
const SESSION_TTL_MS = 12 * 60 * 60_000;

export const rememberSession = (token, { sid, email, role }) => {
  sessions.set(token, { sid, email, role, expiresAt: Date.now() + SESSION_TTL_MS });
};

export const recallSession = (token) => {
  const session = sessions.get(token);
  if (!session) return null;

  if (session.expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }
  return session;
};

export const forgetSession = (token) => {
  const session = sessions.get(token);
  sessions.delete(token);
  return session?.sid || "";
};

/** Drops expired sessions. Called on a timer so the map cannot grow forever. */
export const pruneSessions = () => {
  const now = Date.now();
  let dropped = 0;
  for (const [token, session] of sessions) {
    if (session.expiresAt <= now) {
      sessions.delete(token);
      dropped += 1;
    }
  }
  return dropped;
};

/** Only for the health endpoint and tests. */
export const sessionCount = () => sessions.size;
