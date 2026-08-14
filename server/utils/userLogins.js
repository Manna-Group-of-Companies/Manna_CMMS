import mongoose from "mongoose";
import User, { PIN_LENGTH, isValidPin } from "../models/User.js";

/** The PIN the first Admin account is unlocked with. Override in `.env`. */
const BOOTSTRAP_ADMIN_PIN = process.env.ADMIN_PIN || "1234";

/**
 * Moves an existing database off email + password logins.
 *
 * Installs seeded before this change carry a unique index on `email` and a
 * hashed `password` on every user. The index is the blocking part: accounts are
 * created without an email now, and a second one would collide on the empty
 * string.
 */
export const migrateUserLogins = async () => {
  const users = mongoose.connection.collection("users");

  // A duplicate name makes "sign in with your name" ambiguous, so it has to be
  // resolved by hand rather than papered over with an index that will not build.
  const duplicates = await users
    .aggregate([
      { $group: { _id: { $toLower: "$name" }, count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
    ])
    .toArray();

  if (duplicates.length > 0) {
    console.warn(
      `Users share a name (${duplicates
        .map((d) => `"${d._id}" ×${d.count}`)
        .join(", ")}). Rename them in the database — until then those accounts ` +
        "cannot sign in reliably."
    );
    return;
  }

  // syncIndexes drops indexes the schema no longer declares (the legacy
  // email_1) and builds the ones it does (name_1, unique).
  try {
    await User.syncIndexes();
  } catch (error) {
    console.warn(`Could not sync user indexes: ${error.message}`);
  }

  const { modifiedCount } = await users.updateMany(
    { password: { $exists: true } },
    { $unset: { password: "" } }
  );
  if (modifiedCount > 0) {
    console.log(`Dropped the stored password on ${modifiedCount} user(s).`);
  }
};

/**
 * Gives the Admin account a PIN when no account has one at all.
 *
 * Every other account waits for an admin to issue its PIN — but the admin has
 * to be able to sign in to do that, so this is the one automatic unlock.
 */
export const bootstrapAdminPin = async () => {
  const anyPin = await User.findOne({ pin: { $ne: null } }).select("+pin");
  if (anyPin) return;

  const admin = await User.findOne({ role: "Admin" });
  if (!admin) return;

  if (!isValidPin(BOOTSTRAP_ADMIN_PIN)) {
    console.warn(
      `ADMIN_PIN must be exactly ${PIN_LENGTH} digits — no PIN was issued, ` +
        "so nobody can sign in yet."
    );
    return;
  }

  admin.pin = BOOTSTRAP_ADMIN_PIN;
  await admin.save();

  console.log(
    `No account had a PIN. "${admin.name}" can now sign in with PIN ` +
      `${BOOTSTRAP_ADMIN_PIN} — change it, and issue the other PINs, from ` +
      "Users in the admin console."
  );
};
