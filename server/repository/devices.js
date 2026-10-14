import { createDoc, deleteDoc, listDocs, updateDoc } from "../integrations/erpnext/client.js";
import { DEVICE_DOCTYPE } from "../integrations/erpnext/deviceDoctype.js";
import { erpNow } from "../integrations/erpnext/time.js";

/**
 * The phones registered for push notifications - see deviceDoctype.js.
 *
 * Keyed by the push token, which is the one thing about a phone that is
 * stable across sign-ins and unique across phones. A token registered again
 * under another account simply moves to that account: it is the same phone.
 */

const byToken = (token) =>
  listDocs(DEVICE_DOCTYPE, {
    fields: ["name"],
    filters: [[DEVICE_DOCTYPE, "token", "=", token]],
    limit: 5,
  });

/** Records (or refreshes) a phone. Returns the row's name. */
export const registerDevice = async ({ token, user, role, platform = "", appVersion = "" }) => {
  if (!String(token || "").trim()) throw new Error("A push token is required");
  const fields = {
    user,
    role: role || "",
    platform: platform || "",
    app_version: appVersion || "",
    last_seen: erpNow(),
  };

  const [existing] = await byToken(token);
  if (existing) {
    await updateDoc(DEVICE_DOCTYPE, existing.name, fields);
    return existing.name;
  }
  const created = await createDoc(DEVICE_DOCTYPE, { doctype: DEVICE_DOCTYPE, token, ...fields });
  return created.name;
};

/** Forgets a phone, on sign-out. Returns how many rows went. */
export const removeDevice = async (token) => {
  const rows = await byToken(token);
  for (const row of rows) await deleteDoc(DEVICE_DOCTYPE, row.name);
  return rows.length;
};

/** Every phone signed in under a role: `{ name, token, user }` each. */
export const devicesForRole = (role) =>
  listDocs(DEVICE_DOCTYPE, {
    fields: ["name", "token", "user"],
    filters: [[DEVICE_DOCTYPE, "role", "=", role]],
    limit: 500,
  });

/** Drops rows whose tokens Firebase has reported dead. */
export const forgetDevices = async (devices) => {
  for (const device of devices) {
    await deleteDoc(DEVICE_DOCTYPE, device.name).catch((error) => {
      console.error(`Could not forget device ${device.name}: ${error.message}`);
    });
  }
};
