import crypto from "node:crypto";
import dotenv from "dotenv";

import { createDoc, docExists } from "../integrations/erpnext/client.js";
import { erpHasCredentials } from "../integrations/erpnext/config.js";

dotenv.config();

/**
 * Creates a CMMS login: an ERPNext user holding one CMMS role (3 Nov 2026).
 *
 * Nobody signs up in the app - every login is an ERPNext account, and the role
 * on it decides what the app shows (ROLE_MAP in integrations/erpnext/auth.js).
 * This does the few clicks an ERPNext admin would otherwise make, and prints
 * the password once. An existing account is left alone rather than reset.
 *
 *   node scripts/createUser.js --email gm@mannarubber.com --name "General Manager" --role "Higher Management"
 *   node scripts/createUser.js ... --password "chosen-one"    instead of a generated one
 *
 * --role is the ERPNext role, e.g. Higher Management, Store Maintenance
 * Manager, Plant Manager.
 */

const arg = (name) => {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? undefined : process.argv[at + 1];
};

/** Twelve characters, never confused when read off a screen. */
const generatePassword = () => {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const body = Array.from(crypto.randomBytes(10), (b) => alphabet[b % alphabet.length]).join("");
  return `${body}@${crypto.randomInt(10, 100)}`;
};

const main = async () => {
  const email = arg("email")?.trim().toLowerCase();
  const name = arg("name")?.trim() || email;
  const role = arg("role")?.trim();
  if (!email || !role) {
    console.error('Usage: node scripts/createUser.js --email <email> --name "<full name>" --role "<ERPNext role>"');
    process.exit(1);
  }
  if (!erpHasCredentials()) {
    console.error("ERPNext is not configured: set ERPNEXT_URL, ERPNEXT_API_KEY and ERPNEXT_API_SECRET.");
    process.exit(1);
  }

  if (await docExists("User", email)) {
    console.log(`${email} already exists in ERPNext - left as it is. Reset its password there if needed.`);
    return;
  }

  const [firstName, ...rest] = name.split(" ");
  const password = arg("password") || generatePassword();
  await createDoc("User", {
    email,
    first_name: firstName,
    last_name: rest.join(" "),
    user_type: "System User",
    enabled: 1,
    send_welcome_email: 0,
    new_password: password,
    roles: [{ role }],
  });

  console.log(`Created ${email} with the ${role} role.`);
  console.log(`Password: ${password}`);
};

main().catch((error) => {
  console.error(`Could not create the user: ${error.message}`);
  process.exit(1);
});
