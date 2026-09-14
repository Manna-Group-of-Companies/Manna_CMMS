import mongoose from "mongoose";
import Company from "../models/Company.js";
import StockRoom from "../models/StockRoom.js";
import User from "../models/User.js";

/**
 * Creating the company records and attaching everything that belongs to one.
 *
 * PHASE-0 of the ERPNext integration, and a prerequisite for Module 2. It runs
 * entirely against MongoDB: nothing here calls ERPNext, and nothing here needs
 * ERPNext to be reachable.
 *
 * Every function is idempotent and runs on boot, in the same spirit as
 * `renameStockRooms` — a install that already has companies does no writes.
 *
 * --- The decision this code deliberately does not take ------------------
 *
 * ERPNext holds four companies (MRPPL, MT, MTR, MRU) and each is a real entity
 * with its own GST registration. Only MRPPL is used here: maintenance stock is
 * an MRPPL function serving every site, so each site's store is a warehouse
 * under it rather than a company of its own. See the note on `ERP_COMPANY` in
 * models/Company.js for what that buys.
 */

/**
 * Creates the default companies, and fills in an ERPNext mapping that is still
 * blank. Safe to call repeatedly.
 *
 * Two writes, because they answer to different rules. Creation uses
 * $setOnInsert so a company an admin has since renamed is left alone. The
 * mapping is then healed field by field and only where the stored value is
 * blank — an install that ran this before the warehouses existed holds empty
 * strings that should be filled, while an admin who has deliberately pointed a
 * company at a different warehouse must not have that overwritten on the next
 * restart.
 */
export const ensureDefaultCompanies = async () => {
  for (const { name, erpCompany, erpAbbr, erpWarehouse } of Company.DEFAULTS) {
    await Company.updateOne(
      { name },
      { $setOnInsert: { name, erpCompany, erpAbbr, erpWarehouse, isActive: true } },
      { upsert: true }
    );

    for (const [field, value] of Object.entries({ erpCompany, erpAbbr, erpWarehouse })) {
      if (!value) continue;
      await Company.updateOne(
        { name, $or: [{ [field]: "" }, { [field]: { $exists: false } }] },
        { $set: { [field]: value } }
      );
    }
  }
};

/**
 * Resolves a company id, a name, or a Company document to a document.
 *
 * Unlike `resolveRoom`, an unknown name is *not* created. A room carrying a
 * name nobody recognises is a stock location that has to exist somewhere; a
 * company that nobody has set up is a mistake, and inventing one would give
 * the ERPNext sync a company with no counterpart to post against.
 */
export const resolveCompany = async (company) => {
  if (!company) return null;
  if (company instanceof mongoose.Model || company?._id) return company;

  const value = String(company).trim();
  if (!value) return null;

  if (mongoose.Types.ObjectId.isValid(value)) {
    const byId = await Company.findById(value);
    if (byId) return byId;
  }

  return Company.findOne({ name: value });
};

/**
 * Points every stock room at its company.
 *
 * The three seeded rooms are named after the companies that own them, so the
 * name is the link. Rooms added later that match nothing are left unattached
 * rather than guessed at — `getStockRooms` still returns them, and an admin
 * assigns the company from the console.
 *
 * Runs after `renameStockRooms`, so a room still holding a retired name has
 * already been carried onto its current one and matches here.
 */
export const backfillRoomCompanies = async () => {
  const rooms = await StockRoom.find({ company: null });
  if (rooms.length === 0) return 0;

  let linked = 0;
  for (const room of rooms) {
    const company = await Company.findOne({ name: room.name });
    if (!company) continue;

    await StockRoom.collection.updateOne(
      { _id: room._id },
      { $set: { company: company._id } }
    );
    linked += 1;
  }

  if (linked > 0) {
    console.log(`Companies: linked ${linked} stock room(s) to their company.`);
  }
  return linked;
};

/**
 * Gives every Branch account the company of the room it is pinned to.
 *
 * Admin and Supervisor accounts are left null, which reads as "every company"
 * — they already work across all rooms and narrowing them here would take
 * away access they have today.
 */
export const backfillUserCompanies = async () => {
  const users = await User.find({ role: "Branch", company: null }).populate(
    "stockRoom",
    "company"
  );
  if (users.length === 0) return 0;

  let linked = 0;
  for (const user of users) {
    const companyId = user.stockRoom?.company;
    if (!companyId) continue;

    await User.collection.updateOne(
      { _id: user._id },
      { $set: { company: companyId } }
    );
    linked += 1;
  }

  if (linked > 0) {
    console.log(`Companies: linked ${linked} Branch account(s) to their company.`);
  }
  return linked;
};

/**
 * Companies that cannot take part in an ERPNext posting yet, and why.
 *
 * Logged on boot rather than thrown: Module 1 works perfectly well without any
 * ERPNext mapping, and refusing to start over an integration that has not been
 * configured would take the store offline for no reason.
 */
export const unmappedCompanies = async () => {
  const companies = await Company.find({ isActive: true }).sort({ name: 1 });

  const unmapped = companies
    .filter((company) => !company.isErpMapped())
    .map((company) => ({
      name: company.name,
      missing: [
        company.erpCompany ? null : "ERPNext company",
        company.erpWarehouse ? null : "warehouse",
      ].filter(Boolean),
    }));

  if (unmapped.length > 0) {
    console.log(
      `ERPNext mapping incomplete for ${unmapped.length} of ${companies.length} companies:`
    );
    for (const { name, missing } of unmapped) {
      console.log(`  - ${name}: no ${missing.join(", no ")}`);
    }
  }

  return unmapped;
};

/** The whole of PHASE-0, in the order the steps depend on each other. */
export const setUpCompanies = async () => {
  await ensureDefaultCompanies();
  await backfillRoomCompanies();
  // After the rooms: a Branch account takes its company from its room.
  await backfillUserCompanies();
  await unmappedCompanies();
};
