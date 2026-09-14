import { listAll } from "./client.js";

/**
 * The stores, as ERPNext knows them.
 *
 * This is the post-MongoDB home for what `models/Company.js` used to hold. The
 * integration must not depend on Mongoose once the database is gone, and these
 * four names are the one piece of configuration that everything else hangs
 * off, so they are stated plainly rather than derived.
 */

/**
 * The single ERPNext company the CMMS posts against.
 *
 * ERPNext holds four, each a separate GST-registered entity. Only this one is
 * used: maintenance stock is an MRPPL function serving every site, so each
 * site's store is a warehouse *under* MRPPL rather than a company of its own.
 * Warehouses of one company exchange stock freely and two companies cannot, so
 * the alternative would turn every supervisor merge into a Delivery Note and
 * Purchase Receipt across two registrations — an invoice raised each time a
 * spanner moved between sites.
 */
export const ERP_COMPANY =
  process.env.ERPNEXT_COMPANY || "Manna Rubber Products Private Limited";

export const ERP_ABBR = process.env.ERPNEXT_ABBR || "MRPPL";

/**
 * The warehouses this system owns, in display order.
 *
 * `label` is what the store calls the place and what every screen shows;
 * `warehouse` is the ERPNext docname. They differ because ERPNext suffixes
 * every warehouse with the company abbreviation, which nobody on the shop
 * floor should ever have to read.
 *
 * `label` is also the site name, which is what lets a plant head be scoped to
 * their own shelves: the four CMMS Plant records carry exactly these names, so
 * `resolveStore(plant)` is the whole of the plant-to-store mapping. Keep them
 * spelled identically, or a plant head sees an empty catalog rather than an
 * error that would tell somebody why.
 */
export const STORES = [
  { key: "manna-rubber-products", label: "Manna Rubber Products", warehouse: `Manna Rubber Products Store - ${ERP_ABBR}`, isMain: true },
  { key: "hi-tech-rubber-industries", label: "Hi-Tech Rubber Industries", warehouse: `Hi-Tech Rubber Industries Store - ${ERP_ABBR}` },
  { key: "manna-treads", label: "Manna Treads", warehouse: `Manna Treads Store - ${ERP_ABBR}` },
  // Added when the plant heads were scoped to their own sites: Manna Tyre
  // Retreads was a plant with no store, so its head would have been shown an
  // empty catalog. The warehouse exists in ERPNext and starts empty.
  { key: "manna-tyre-retreads", label: "Manna Tyre Retreads", warehouse: `Manna Tyre Retreads Store - ${ERP_ABBR}` },
];

/**
 * Where returned stock waits for a merge.
 *
 * Kept out of `STORES` deliberately. It is a real warehouse — the stock is off
 * every shelf and still on the books — but it is not a store anybody is issued
 * from, and listing it alongside the others would put it in every picker.
 */
export const RED_STOCK_WAREHOUSE = `Red Stock - ${ERP_ABBR}`;

/** Every warehouse the CMMS owns, including Red Stock. */
export const ALL_WAREHOUSES = [...STORES.map((s) => s.warehouse), RED_STOCK_WAREHOUSE];

/** The main store, where stock lands when nothing names a place. */
export const MAIN_WAREHOUSE = STORES.find((s) => s.isMain).warehouse;

const BY_WAREHOUSE = new Map(STORES.map((s) => [s.warehouse, s]));
const BY_LABEL = new Map(STORES.map((s) => [s.label.toLowerCase(), s]));
const BY_KEY = new Map(STORES.map((s) => [s.key, s]));

/**
 * Resolves whatever a caller has — a key, a label, or the ERPNext name — to
 * one store.
 *
 * Tolerant on input because three different vocabularies reach this: the
 * tablets send labels they were compiled with, the web console sends keys, and
 * anything read back out of ERPNext carries the warehouse docname.
 */
export const resolveStore = (value) => {
  const text = String(value || "").trim();
  if (!text) return null;
  return (
    BY_WAREHOUSE.get(text) ||
    BY_KEY.get(text) ||
    BY_LABEL.get(text.toLowerCase()) ||
    null
  );
};

/** The ERPNext warehouse for whatever the caller named, or "". */
export const warehouseFor = (value) => {
  const text = String(value || "").trim();
  if (!text) return "";
  // Red Stock resolves like a store although it is not one, because the rest
  // of the system refers to it by name in exactly the same way.
  if (text === RED_STOCK_WAREHOUSE || /red stock/i.test(text)) return RED_STOCK_WAREHOUSE;
  return resolveStore(text)?.warehouse || "";
};

/** What to show a person for an ERPNext warehouse name. */
export const labelFor = (warehouse) => {
  if (warehouse === RED_STOCK_WAREHOUSE) return "Red Stock Room";
  return BY_WAREHOUSE.get(warehouse)?.label || warehouse;
};

/** True when a warehouse is one of ours rather than production stock. */
export const isOurs = (warehouse) => ALL_WAREHOUSES.includes(warehouse);

/**
 * Checks the four warehouses actually exist, for the boot log.
 *
 * A name that has been renamed in ERPNext would otherwise fail silently on the
 * first issue of the day, with an error naming a warehouse rather than the
 * configuration that is wrong.
 */
export const verifyWarehouses = async () => {
  const found = await listAll("Warehouse", {
    fields: ["name"],
    filters: [["Warehouse", "name", "in", ALL_WAREHOUSES]],
  });

  const present = new Set(found.map((row) => row.name));
  return {
    ok: ALL_WAREHOUSES.every((name) => present.has(name)),
    missing: ALL_WAREHOUSES.filter((name) => !present.has(name)),
  };
};
