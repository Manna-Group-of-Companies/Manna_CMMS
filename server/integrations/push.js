import fs from "node:fs";

import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";

import { devicesForRole, forgetDevices } from "../repository/devices.js";

/**
 * Rings the Maintenance Manager's phone the moment a plant raises something.
 *
 * Sent through Firebase Cloud Messaging, which is the only road to a phone
 * that is locked or has the app closed: Google keeps one connection open to
 * every Android phone and wakes the app through it. Before this, the phone
 * polled - every 20 seconds with the app open, every 15 minutes closed - and a
 * breakdown reported at night could sit a quarter of an hour before anybody
 * was told.
 *
 * The message carries data only, no ready-made notification: the phone draws
 * it itself (`mobile/lib/core/push_messages.dart`), with the same channels,
 * wording and tap-to-open as the notifications it raises from polling, and
 * through the same ledger, so a record never rings twice.
 *
 * Off until the Firebase service account is configured - see `.env.example`.
 * Without it everything else still works and the phones keep polling.
 */

/** The role the phones are rung for; the app registers only this role. */
export const PUSH_ROLE = "Maintenance Manager";

/**
 * The service account, from `FIREBASE_SERVICE_ACCOUNT_FILE` (a path) or
 * `FIREBASE_SERVICE_ACCOUNT` (the JSON itself, or that JSON base64-encoded -
 * hosting dashboards do not take kindly to multi-line values).
 */
export const readServiceAccount = (env = process.env) => {
  let text = "";
  if (env.FIREBASE_SERVICE_ACCOUNT_FILE) {
    text = fs.readFileSync(env.FIREBASE_SERVICE_ACCOUNT_FILE, "utf8");
  } else if (env.FIREBASE_SERVICE_ACCOUNT) {
    const raw = env.FIREBASE_SERVICE_ACCOUNT.trim();
    text = raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
  }
  if (!text.trim()) return null;
  const account = JSON.parse(text);
  if (!account.project_id || !account.private_key || !account.client_email) {
    throw new Error("The Firebase service account JSON is missing project_id, private_key or client_email");
  }
  return account;
};

let app = null;
let disabledReason = "";

const messaging = () => {
  if (app) return getMessaging(app);
  if (disabledReason) return null;
  try {
    const account = readServiceAccount();
    if (!account) {
      disabledReason = "FIREBASE_SERVICE_ACCOUNT is not set";
      console.log(`Push notifications off: ${disabledReason} (phones poll instead).`);
      return null;
    }
    app = getApps()[0] || initializeApp({ credential: cert(account) });
    console.log(`Push notifications on (Firebase project ${account.project_id}).`);
    return getMessaging(app);
  } catch (error) {
    disabledReason = error.message;
    console.error(`Push notifications off: ${disabledReason}`);
    return null;
  }
};

export const pushEnabled = () => Boolean(messaging());
export const pushDisabledReason = () => disabledReason;

// Firebase data payloads are strings, all of them.
const text = (value) => (value == null ? "" : String(value));

/** What the phone needs to draw a breakdown notification and open the record. */
export const breakdownMessage = (b) => ({
  kind: "breakdown",
  id: text(b.id),
  title: text(b.machineName || b.machine),
  detail: text(b.whatHappened),
  plant: text(b.plant),
  priority: text(b.priority),
  state: text(b.state),
  waitingOn: text(b.waitingOn),
  raisedBy: text(b.reportedBy),
  // ERPNext's own "YYYY-MM-DD HH:mm:ss", in the site's timezone, passed
  // through untouched - the same string the list API hands the phone.
  raisedAt: text(b.stoppedAt),
  machineName: "",
});

/** The same for a maintenance request. */
export const requestMessage = (r) => ({
  kind: "request",
  id: text(r.id),
  title: text(r.title),
  detail: text(r.whatIsNeeded),
  plant: text(r.plant),
  priority: text(r.priority),
  state: text(r.state),
  waitingOn: text(r.waitingOn),
  raisedBy: text(r.requestedBy),
  raisedAt: text(r.requestedAt),
  machineName: text(r.machineName),
});

/** Firebase's ways of saying "that phone is gone" - the row is dropped. */
const DEAD_TOKEN = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
  "messaging/invalid-argument",
]);

/**
 * Sends one data message to every phone registered under [PUSH_ROLE].
 *
 * High priority, so Android delivers it through Doze rather than holding it
 * for the next maintenance window; an hour's time-to-live, because a
 * breakdown announced tomorrow is not news.
 */
export const pushToMaintenanceManagers = async (data) => {
  const fcm = messaging();
  if (!fcm) return { sent: 0, skipped: disabledReason };

  const devices = await devicesForRole(PUSH_ROLE);
  if (!devices.length) return { sent: 0, skipped: "no phones registered" };

  const dead = [];
  let sent = 0;
  // Firebase takes 500 tokens a call.
  for (let i = 0; i < devices.length; i += 500) {
    const batch = devices.slice(i, i + 500);
    const result = await fcm.sendEachForMulticast({
      tokens: batch.map((d) => d.token),
      data,
      android: { priority: "high", ttl: 60 * 60 * 1000 },
    });
    result.responses.forEach((response, index) => {
      if (response.success) {
        sent += 1;
      } else if (DEAD_TOKEN.has(response.error?.code)) {
        dead.push(batch[index]);
      } else {
        console.error(`Push to ${batch[index].user} failed: ${response.error?.message}`);
      }
    });
  }

  if (dead.length) await forgetDevices(dead);
  return { sent, dropped: dead.length };
};

/**
 * For a controller: send after answering, never before. The person who just
 * reported a breakdown is owed their response now, not after Google.
 */
export const pushLater = (data, label) => {
  pushToMaintenanceManagers(data)
    .then((result) => {
      if (result.sent) console.log(`${label}: pushed to ${result.sent} phone(s)`);
      else if (result.skipped && result.skipped !== disabledReason) console.log(`${label}: not pushed, ${result.skipped}`);
    })
    .catch((error) => console.error(`${label}: push failed: ${error.message}`));
};
