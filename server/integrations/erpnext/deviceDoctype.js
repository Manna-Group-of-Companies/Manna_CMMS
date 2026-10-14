/**
 * A phone that wants to be told the moment a plant raises something.
 *
 * One row per app install that has signed in: the push token Firebase gave
 * that phone, whose session registered it and with which role. The server
 * reads this to decide where a push goes - see `integrations/push.js` - and
 * drops a row the moment Firebase says the token is dead.
 *
 * Lives in ERPNext rather than a file on the server because the server has
 * nowhere else that survives a redeploy: a phone that registered last week and
 * has not been opened since would otherwise be forgotten by the next deploy
 * and stop ringing until somebody noticed.
 *
 * Pushed by `scripts/syncDevices.js`.
 */

export const DEVICE_DOCTYPE = "CMMS Device";

const f = (fieldname, label, fieldtype, extra = {}) => ({ fieldname, label, fieldtype, ...extra });

export const DEVICE_DOCTYPE_DEFINITION = {
  doctype: "DocType",
  name: DEVICE_DOCTYPE,
  module: "Custom",
  custom: 1,
  istable: 0,
  editable_grid: 0,
  track_changes: 0,
  allow_rename: 0,
  // A push token runs to 160-odd characters, past what a document name may
  // hold, so the row takes a random name and the token is a field.
  naming_rule: "Random",
  autoname: "hash",
  permissions: [
    { role: "System Manager", read: 1, write: 1, create: 1, delete: 1, report: 1, export: 1 },
  ],
  fields: [
    f("user", "User", "Link", { options: "User", reqd: 1, in_list_view: 1, in_standard_filter: 1 }),
    f("role", "Role", "Data", { in_list_view: 1, in_standard_filter: 1 }),
    f("platform", "Platform", "Data"),
    f("app_version", "App Version", "Data", { in_list_view: 1 }),
    f("last_seen", "Last Seen", "Datetime", { in_list_view: 1 }),
    // Small Text rather than Data: Data is capped at 140 characters.
    f("token", "Push Token", "Small Text", { reqd: 1 }),
  ],
};
