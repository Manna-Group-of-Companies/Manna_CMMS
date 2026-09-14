import crypto from "node:crypto";

import { issueToken } from "../middleware/session.js";
import {
  describe,
  forgetSession,
  rememberSession,
  signIn,
  signOut,
} from "../integrations/erpnext/auth.js";
import { erpCanAuthenticate } from "../integrations/erpnext/config.js";
import { recordLoginFailure, recordLoginSuccess } from "../middleware/loginLimit.js";
import { STORES, verifyWarehouses } from "../integrations/erpnext/stores.js";

/**
 * Signing in against ERPNext.
 *
 * Replaces the name-and-PIN login. Frappe has no PIN, and the point of moving
 * onto ERPNext is one list of people rather than two that drift apart.
 */

/** What the clients keep about the signed-in person. */
const publicUser = (profile) => ({
  email: profile.email,
  name: profile.fullName,
  role: profile.role,
  erpRoles: profile.erpRoles || [],
});

/**
 * @desc    Sign in with an ERPNext email and password
 * @route   POST /api/session/login
 * @access  Public
 */
export const login = async (req, res) => {
  const { email, password, pin, name } = req.body || {};

  if (!erpCanAuthenticate()) {
    return res.status(503).json({
      message: "ERPNEXT_URL is not set on this server",
      code: "ERP_NOT_CONFIGURED",
    });
  }

  // A tablet running the old build still posts a name and a PIN. Answering
  // with a plain "invalid login" would send a supervisor to an admin to have
  // their PIN reset, which would not help, so it is named for what it is.
  if (!password && (pin || name)) {
    return res.status(426).json({
      message:
        "This version of the app signs in with a PIN, which is no longer supported. Update the app and sign in with your ERPNext email and password.",
      code: "APP_UPDATE_REQUIRED",
    });
  }

  if (!email || !password) {
    return res.status(400).json({ message: "Email and password are required" });
  }

  try {
    const profile = await signIn(email, password);

    // The Frappe session id stays here; the client is given a token that only
    // this server can exchange for it.
    const sessionToken = crypto.randomBytes(32).toString("hex");
    rememberSession(sessionToken, {
      sid: profile.sid,
      email: profile.email,
      role: profile.role,
    });

    recordLoginSuccess(req);

    return res.json({
      ...publicUser(profile),
      token: issueToken({ sessionToken, email: profile.email, role: profile.role }),
    });
  } catch (error) {
    if (error?.status === 401) {
      // Counted here rather than in the middleware: only this handler knows
      // whether the password actually matched, as opposed to ERPNext being
      // unreachable, which must not count against the person trying.
      recordLoginFailure(req);
      return res.status(401).json({ message: "Wrong email or password" });
    }
    if (error?.status === 403) {
      return res.status(403).json({ message: error.message });
    }

    // Said plainly rather than folded into "try again in a moment", which is
    // advice that never comes true: a rejected API key does not recover on its
    // own and somebody has to go and reissue it.
    if (error?.code === "ERP_KEY_REJECTED") {
      console.error("ERPNext sign-in failed: the integration API key was rejected.");
      return res.status(503).json({ message: error.message, code: error.code });
    }

    // Anything else is our problem, not theirs. Telling somebody to check
    // their password while Frappe Cloud is down wastes their morning.
    console.error("ERPNext sign-in failed:", error.message);
    return res.status(503).json({
      message: "Could not reach ERPNext to sign you in. Try again in a moment.",
      code: "ERP_UNREACHABLE",
    });
  }
};

/**
 * @desc    Sign out
 * @route   POST /api/session/logout
 * @access  Private
 */
export const logout = async (req, res) => {
  // Dropped here first, and outside the try: even if ERPNext cannot be reached
  // to end the Frappe session, this server must stop honouring the token.
  const sid = forgetSession(req.user?.sessionToken || "") || req.user?.sid || "";

  try {
    await signOut(sid);
  } catch (error) {
    // A session that outlives this call expires on its own, and telling
    // somebody their sign-out failed when their token is already dead would
    // be both alarming and untrue.
    console.error("Sign-out could not reach ERPNext:", error.message);
  }

  return res.json({ message: "Signed out" });
};

/**
 * @desc    The signed-in person, re-read from ERPNext
 * @route   GET /api/session/me
 * @access  Private
 *
 * Re-read rather than echoed back from the token, so a role changed in ERPNext
 * this morning takes effect on the next screen rather than in thirty days.
 */
export const me = async (req, res) => {
  try {
    const profile = await describe(req.user.email);
    return res.json({
      ...publicUser(profile),
      // Tells the client its ERPNext session lapsed and reads are currently
      // being made with the integration account rather than as this person.
      sessionExpired: Boolean(req.user.sessionExpired),
    });
  } catch (error) {
    if (error?.status === 403) return res.status(403).json({ message: error.message });
    console.error("Could not read profile:", error.message);
    return res.status(503).json({ message: "ERPNext is unreachable" });
  }
};

/**
 * @desc    What the client needs before showing anything
 * @route   GET /api/session/bootstrap
 * @access  Private
 *
 * One call rather than three. The tablets fetch this on every launch over a
 * shop-floor connection, and the store list plus a health check in a single
 * round trip is the difference between a screen that appears and one that
 * fills in piece by piece.
 */
export const bootstrap = async (req, res) => {
  try {
    const warehouses = await verifyWarehouses();

    return res.json({
      user: {
        email: req.user.email,
        role: req.user.role,
        sessionExpired: Boolean(req.user.sessionExpired),
      },
      stores: STORES.map((store) => ({
        key: store.key,
        label: store.label,
        isMain: Boolean(store.isMain),
      })),
      // Surfaced rather than logged: a warehouse renamed in ERPNext breaks
      // every issue from that store, and the failure would otherwise appear
      // as an unrelated error the first time somebody tried.
      warehousesOk: warehouses.ok,
      missingWarehouses: warehouses.missing,
    });
  } catch (error) {
    console.error("Bootstrap failed:", error.message);
    return res.status(503).json({ message: "ERPNext is unreachable" });
  }
};
