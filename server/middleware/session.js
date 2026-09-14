import jwt from "jsonwebtoken";

import { jwtSecret } from "../config/jwt.js";
import { asIntegration, asUser } from "../integrations/erpnext/client.js";
import { describe, recallSession } from "../integrations/erpnext/auth.js";

/**
 * Authentication for the routes that talk to ERPNext.
 *
 * Deliberately separate from `middleware/auth.js`, which still signs people in
 * against MongoDB with a PIN. Both exist while the controllers are moved over
 * one at a time; a route uses whichever matches the world it reads from, and
 * the two cannot be confused because their tokens carry different claims —
 * this one requires `sessionToken`, the old one requires `id`, and neither
 * accepts the other's.
 *
 * The old middleware goes when the last controller stops using it.
 */

/**
 * How long a person stays signed in.
 *
 * Long, because the alternative is a supervisor holding a tablet in a store
 * room being asked to type an email and password again mid-shift. The Frappe
 * session behind it is much shorter-lived; see below for what happens when it
 * expires first.
 */
const TOKEN_TTL = "30d";

/** Issues this server's own token. The ERPNext session never leaves the server. */
export const issueToken = ({ sessionToken, email, role }) =>
  jwt.sign({ sessionToken, email, role }, jwtSecret(), { expiresIn: TOKEN_TTL });

/**
 * Establishes `req.user` from the bearer token.
 *
 * Two paths, and the second is the one that matters in practice.
 *
 * Normally the token maps to a live Frappe session, and the request can be
 * made as that person so ERPNext applies their permissions.
 *
 * But Frappe sessions expire and this server restarts on every deploy, while
 * the tablets hold their token for a month. So a valid token whose session has
 * gone is *not* treated as a sign-out. The identity is still proven — the
 * token is signed — and the role is re-read from ERPNext rather than trusted
 * from the token, so somebody demoted this morning does not keep yesterday's
 * access until their token expires. Reads then fall back to the integration
 * account. The alternative, logging everyone out whenever the server restarts,
 * would make a deploy indistinguishable from an outage to the shop floor.
 */
export const protect = async (req, res, next) => {
  const header = req.headers.authorization || "";

  if (!header.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Not authorized, no token" });
  }

  const token = header.slice("Bearer ".length).trim();
  if (!token) return res.status(401).json({ message: "Not authorized, no token" });

  let claims;
  try {
    claims = jwt.verify(token, jwtSecret());
  } catch (error) {
    // An unset signing key is a server fault, not a bad token. Saying "token
    // failed" would send everyone chasing their login instead of the config.
    if (error.name !== "JsonWebTokenError" && error.name !== "TokenExpiredError") {
      console.error("Session middleware misconfiguration:", error.message);
      return res.status(500).json({ message: "Authentication is misconfigured on the server" });
    }
    return res.status(401).json({ message: "Not authorized, token failed" });
  }

  // A token minted by the old PIN login carries `id` and no session; it must
  // not be accepted here, or a legacy client would appear signed in with no
  // ERPNext identity behind it.
  if (!claims?.sessionToken || !claims?.email) {
    return res.status(401).json({ message: "Not authorized, token failed" });
  }

  const session = recallSession(claims.sessionToken);

  if (session) {
    req.user = {
      email: session.email,
      role: session.role,
      sid: session.sid,
      // Carried so signing out can drop the right session rather than
      // searching for it by identity, which would end every session a person
      // has open on other devices.
      sessionToken: claims.sessionToken,
      // Reads can be made as this person, so ERPNext hides what they may not
      // see rather than this server having to remember to.
      as: asUser(session.sid),
    };
    return next();
  }

  // The session is gone but the token is sound. Re-establish who they are.
  try {
    const profile = await describe(claims.email);
    req.user = {
      email: profile.email,
      role: profile.role,
      sid: "",
      as: asIntegration(),
      sessionExpired: true,
    };
    return next();
  } catch (error) {
    // 403 from `describe` means the account was disabled or stripped of its
    // stock role — a real revocation, and the token must stop working now.
    if (error?.status === 403) {
      return res.status(403).json({ message: error.message });
    }
    console.error("Could not re-establish session:", error.message);
    return res.status(503).json({ message: "ERPNext is unreachable, cannot verify your account" });
  }
};

/** Restricts a route to particular CMMS roles. */
export const requireRole = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(403).json({
      message: `Role (${req.user?.role || "none"}) is not allowed to access this resource`,
    });
  }
  return next();
};
