import dotenv from "dotenv";

dotenv.config();

/**
 * How this server reaches ERPNext.
 *
 * Everything is read from the environment. The key and secret belong to a
 * dedicated integration account — not to a person — so that a posting is
 * attributable to the sync rather than to whoever happened to set it up, and
 * so revoking it does not lock a human out of ERPNext.
 *
 * Nothing here ever reaches a client. The tablets and the web console talk to
 * this server, and this server talks to ERPNext; putting the secret anywhere
 * near a Flutter build or a Vite bundle would publish it.
 */

/** Base URL of the ERPNext site, without a trailing slash. */
export const erpBaseUrl = () =>
  String(process.env.ERPNEXT_URL || "").trim().replace(/\/+$/, "");

const apiKey = () => String(process.env.ERPNEXT_API_KEY || "").trim();
const apiSecret = () => String(process.env.ERPNEXT_API_SECRET || "").trim();

/**
 * Whether people can sign in against ERPNext.
 *
 * Only the address is needed. A sign-in carries its own credentials and reads
 * the person's own record with the session it just established, so it does not
 * depend on the integration key — which means logins keep working on an
 * install where the background sync has never been configured.
 */
export const erpCanAuthenticate = () => Boolean(erpBaseUrl());

/**
 * Whether the integration account can be used.
 *
 * Distinct from `erpEnabled` below, and the distinction matters: this asks
 * whether a call made as the robot can be authenticated, while that one asks
 * whether the background sync should be running. Conflating them once meant a
 * sign-in failed because the *sync* was switched off, which had nothing to do
 * with it.
 */
export const erpHasCredentials = () => Boolean(erpBaseUrl() && apiKey() && apiSecret());

/**
 * Whether the sync should run at all.
 *
 * Off unless it is switched on *and* fully configured. Module 1 works without
 * ERPNext, so a half-configured install must keep serving the store rather
 * than failing every issue on a connection that was never going to work.
 */
export const erpEnabled = () =>
  process.env.ERPNEXT_SYNC_ENABLED === "true" &&
  Boolean(erpBaseUrl() && apiKey() && apiSecret());

/**
 * Why the sync is off, for the boot log. Returns "" when it is on.
 */
export const erpDisabledReason = () => {
  if (erpEnabled()) return "";
  if (process.env.ERPNEXT_SYNC_ENABLED !== "true") {
    return "ERPNEXT_SYNC_ENABLED is not \"true\"";
  }
  const missing = [
    erpBaseUrl() ? null : "ERPNEXT_URL",
    apiKey() ? null : "ERPNEXT_API_KEY",
    apiSecret() ? null : "ERPNEXT_API_SECRET",
  ].filter(Boolean);
  return `missing ${missing.join(", ")}`;
};

/**
 * Frappe's token scheme: `token <key>:<secret>`.
 *
 * Not a Bearer token and not Basic auth — Frappe rejects both.
 */
export const erpAuthHeader = () => `token ${apiKey()}:${apiSecret()}`;

/**
 * How long the worker waits on one ERPNext call.
 *
 * Generous, because a Stock Entry submission runs the whole valuation chain
 * server-side and Frappe Cloud can be slow under load. Nothing is waiting on
 * it: the store's request finished long before the worker picked the job up.
 */
export const ERP_TIMEOUT_MS = 30_000;

/** How often the worker looks for queued work. */
export const ERP_POLL_MS = Number(process.env.ERPNEXT_POLL_MS || 15_000);

/** Give up on a job after this many attempts and leave it for a human. */
export const ERP_MAX_ATTEMPTS = Number(process.env.ERPNEXT_MAX_ATTEMPTS || 6);
