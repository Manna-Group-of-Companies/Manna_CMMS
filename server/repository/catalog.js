import {
  cancelDoc,
  createDoc,
  deleteDoc,
  docExists,
  listAll,
  listDocs,
  updateDoc,
} from "../integrations/erpnext/client.js";
import {
  ALL_WAREHOUSES,
  ERP_ABBR,
  ERP_COMPANY,
  MAIN_WAREHOUSE,
  RED_STOCK_WAREHOUSE,
  STORES,
  labelFor,
  warehouseFor,
} from "../integrations/erpnext/stores.js";
import { MAINTENANCE_ROOT, MAINTENANCE_SUFFIX } from "../integrations/erpnext/masterData.js";
import { buildReconciliation } from "../integrations/erpnext/openingStock.js";
import { resolveUom } from "../integrations/erpnext/uom.js";

/**
 * The engineering catalog, read from ERPNext.
 *
 * Shaped like the Product documents the screens were written against, so the
 * client needed no change: `code`, `name`, `category`, `quantity`, `minStock`
 * and the rest mean what they always meant. What changed is where they come
 * from — Item and Bin rather than MongoDB.
 *
 * Bin is the authority on quantity. Nothing here adds up movements to work out
 * a balance, because ERPNext already did that, and any second opinion this
 * file offered would eventually disagree with the Stock Balance report.
 */

/** The warehouses stock can actually be issued from. */
const STORE_WAREHOUSES = STORES.map((s) => s.warehouse);

/**
 * ERPNext is asked for the whole catalog rather than a filtered slice.
 *
 * The store has a few hundred items, and every filter the screens offer —
 * search across name, code, category and rack at once, "low stock" comparing
 * two fields — is either awkward or impossible as a Frappe filter. Reading the
 * lot and narrowing here is one round trip instead of several, and it keeps
 * the filtering rules in one readable place.
 *
 * The short cache is for typing: the catalog page re-queries on every
 * keystroke, and without it every letter is a round trip to Frappe Cloud.
 */
const CACHE_MS = 20_000;
let cache = null;

const freshEnough = (entry) => entry && Date.now() - entry.at < CACHE_MS;

/** Drops the cache, for after a write this process performed. */
export const forgetCatalog = () => {
  cache = null;
};

/**
 * Strips the disambiguating suffixes off a group name for display.
 *
 * The tree carries "Bolt (Fasteners(MM))" and "Bearings (Maintenance)" because
 * ERPNext needs every Item Group name to be unique across the whole system.
 * Neither suffix is something the store says out loud, so the screens show the
 * plain name — the bracketed part survives only where it is doing real work,
 * telling two "Bolt" groups under different parents apart.
 */
const displayName = (name, parent = "") => {
  let clean = String(name || "");
  if (clean.endsWith(MAINTENANCE_SUFFIX)) {
    clean = clean.slice(0, -MAINTENANCE_SUFFIX.length);
  }
  const qualifier = ` (${parent})`;
  if (parent && clean.endsWith(qualifier)) {
    clean = clean.slice(0, -qualifier.length);
  }
  return clean.trim();
};

/**
 * Every Item Group under the maintenance root, with the category and
 * sub-category each one stands for.
 *
 * Two levels: a group whose parent is the root is a category, anything deeper
 * is a sub-category of its parent. That is the shape the catalog was imported
 * with, read back rather than assumed.
 */
const readGroups = async () => {
  const rows = await listAll("Item Group", {
    fields: ["name", "parent_item_group"],
  });

  const children = new Map();
  for (const row of rows) {
    const parent = row.parent_item_group || "";
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(row.name);
  }

  // An item whose sheet row named no category at all was filed on the root
  // itself. It has no category, and saying so is better than inventing one —
  // but it must still appear in the catalog, which it did not when this map
  // held only the two levels below.
  const groups = new Map([[MAINTENANCE_ROOT, { category: "", subCategory: "" }]]);

  for (const category of children.get(MAINTENANCE_ROOT) || []) {
    const categoryLabel = displayName(category);
    groups.set(category, { category: categoryLabel, subCategory: "" });

    for (const sub of children.get(category) || []) {
      groups.set(sub, {
        category: categoryLabel,
        subCategory: displayName(sub, category),
      });
    }
  }
  return groups;
};

/** Quantities per item, per warehouse. */
const readBins = async () => {
  const rows = await listAll("Bin", {
    fields: ["item_code", "warehouse", "actual_qty"],
    filters: [["Bin", "warehouse", "in", ALL_WAREHOUSES]],
  });

  const byItem = new Map();
  for (const row of rows) {
    if (!byItem.has(row.item_code)) byItem.set(row.item_code, new Map());
    byItem.get(row.item_code).set(row.warehouse, Number(row.actual_qty || 0));
  }
  return byItem;
};

/** One ERPNext Item as the screens expect a product to look. */
const toProduct = (item, group, warehouses) => {
  const held = warehouses || new Map();

  // What is on the shelves and issuable. Red Stock is counted apart because it
  // is stock that has come back and is waiting on a merge — real, on the books,
  // and not something anybody should be told they can issue.
  const quantity = STORE_WAREHOUSES.reduce((sum, w) => sum + (held.get(w) || 0), 0);

  const rooms = STORES.map((store) => ({
    room: store.label,
    warehouse: store.warehouse,
    quantity: held.get(store.warehouse) || 0,
  })).filter((r) => r.quantity > 0);

  // Where most of it sits, so the badge on the row says something true. The
  // main store when nothing is held anywhere.
  const biggest = rooms.length
    ? rooms.reduce((a, b) => (b.quantity > a.quantity ? b : a))
    : null;

  return {
    // The screens key rows and build URLs off `_id`. The item code is the
    // identifier ERPNext uses, so it is the one that goes here — there is no
    // Mongo ObjectId behind any of this any more.
    _id: item.name,
    code: item.name,
    name: item.item_name || item.name,
    category: group?.category || "",
    subCategory: group?.subCategory || "",
    brand: item.brand || "",
    unit: item.stock_uom || "",
    unitCost: Number(item.valuation_rate || 0),
    minStock: Number(item.safety_stock || 0),
    quantity,
    redStock: held.get(RED_STOCK_WAREHOUSE) || 0,
    rooms: rooms.map(({ room, quantity: q }) => ({ room, quantity: q })),
    storeRoom: labelFor(biggest ? biggest.warehouse : MAIN_WAREHOUSE),
    rackNumber: item.custom_rack_location || "",
    description: item.description || "",
    image: item.image || "",
    sap: { code: item.custom_sap_item_code || "", status: "" },
    disabled: Boolean(item.disabled),
    updatedAt: item.modified,
  };
};

/** The whole catalog, from cache when it is fresh enough. */
const readCatalog = async () => {
  if (freshEnough(cache)) return cache.products;

  const groups = await readGroups();
  const [items, bins] = await Promise.all([
    listAll("Item", {
      fields: [
        "name",
        "item_name",
        "item_group",
        "brand",
        "stock_uom",
        "description",
        "safety_stock",
        "valuation_rate",
        "custom_rack_location",
        "custom_sap_item_code",
        "image",
        "disabled",
        "modified",
      ],
      filters: [["Item", "item_group", "in", [...groups.keys()]]],
    }),
    readBins(),
  ]);

  const products = items
    // ERPNext's `disabled` means "do not use this item". A store catalog that
    // still listed it would contradict the flag - and an item cannot always be
    // deleted (once any stock document references it, even a cancelled one,
    // ERPNext refuses and tells you to disable it instead), so disabling is
    // the normal way an item leaves the catalog rather than the exception.
    .filter((item) => !item.disabled)
    .map((item) => toProduct(item, groups.get(item.item_group), bins.get(item.name)));
  products.sort((a, b) => a.name.localeCompare(b.name));

  cache = { at: Date.now(), products };
  return products;
};

/**
 * The catalog as one site sees it.
 *
 * Drops every item that site holds none of, and restates `quantity`, `rooms`
 * and `storeRoom` from its shelves alone. Red Stock is zeroed rather than
 * apportioned: it is one shared rack waiting on a merge, so no site can claim
 * a share of it, and showing the group's figure against a single site's
 * quantity would be the most misleading number on the page.
 */
const confineToRooms = (products, onlyRooms) => {
  const allowed = new Set(onlyRooms);

  return products.reduce((kept, product) => {
    const rooms = product.rooms.filter((r) => allowed.has(r.room));
    if (!rooms.length) return kept;

    const quantity =
      Math.round(rooms.reduce((sum, r) => sum + r.quantity, 0) * 1000) / 1000;
    const biggest = rooms.reduce((a, b) => (b.quantity > a.quantity ? b : a));

    kept.push({ ...product, rooms, quantity, redStock: 0, storeRoom: biggest.room });
    return kept;
  }, []);
};

/**
 * The catalog, filtered the way the screens ask for it.
 *
 * @param search       matched against name, code, category and rack at once
 * @param category     exact
 * @param subCategory  exact
 * @param storeRoom    a store label; keeps only what that store holds
 * @param onlyRooms    store labels the caller is confined to, or null for none
 * @param stockStatus  "low" (at or below its minimum) or "out"
 */
export const listCatalog = async ({
  search = "",
  category = "",
  subCategory = "",
  storeRoom = "",
  onlyRooms = null,
  stockStatus = "",
} = {}) => {
  let products = await readCatalog();

  // Applied before anything else, because it changes the numbers rather than
  // only hiding rows. A plant head confined to one site is shown that site's
  // quantity, not the group's — otherwise "low stock" would compare their
  // shelves against a total held four sites away, and the one screen meant to
  // tell them what to order would be the one screen that could not.
  if (onlyRooms) products = confineToRooms(products, onlyRooms);

  const term = String(search).trim().toLowerCase();
  if (term) {
    // The rack is in here because "what is on A-1?" is how somebody standing
    // in front of the shelving looks something up.
    products = products.filter((p) =>
      [p.name, p.code, p.category, p.rackNumber].some((field) =>
        String(field).toLowerCase().includes(term)
      )
    );
  }

  if (category) products = products.filter((p) => p.category === category);
  if (subCategory) products = products.filter((p) => p.subCategory === subCategory);
  if (storeRoom) products = products.filter((p) => p.rooms.some((r) => r.room === storeRoom));

  if (stockStatus === "low") {
    // A minimum of zero is not a minimum, so an item nobody set one for is not
    // reported as low the moment it runs out.
    products = products.filter((p) => p.minStock > 0 && p.quantity <= p.minStock);
  } else if (stockStatus === "out") {
    products = products.filter((p) => p.quantity === 0);
  }

  return products;
};

/**
 * One product by its item code.
 *
 * `onlyRooms` confines it exactly as it does the list: an item the caller's
 * site holds none of comes back null, which the controller reports as not
 * found. Null means no confinement; an empty array confines it to nothing.
 */
export const getCatalogItem = async (code, { onlyRooms = null } = {}) => {
  const products = await readCatalog();
  const scoped = onlyRooms ? confineToRooms(products, onlyRooms) : products;
  return scoped.find((p) => p.code === code) || null;
};

/** Categories actually in use, for the filter dropdown. */
export const listCategories = async () => {
  const products = await readCatalog();
  return [...new Set(products.map((p) => p.category).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b)
  );
};

/**
 * Sub-categories in use, narrowed to one category.
 *
 * Scoped on purpose: the catalog carries well over a hundred sub-categories,
 * and an unfiltered list is unusable in a dropdown.
 */
export const listSubCategories = async (category = "") => {
  const products = await readCatalog();
  const scoped = category ? products.filter((p) => p.category === category) : products;
  return [...new Set(scoped.map((p) => p.subCategory).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b)
  );
};


/* ------------------------------------------------------------- creating */

/**
 * The next code in the store's own sequence.
 *
 * The catalog came across from a workbook keyed SAP1..SAP654, and those codes
 * are what the shelf labels and every issue slip already say. A new item
 * continues that sequence rather than starting a parallel one.
 *
 * Note this is the store's running number, not SAP's. The real SAP code lands
 * in `custom_sap_item_code` if and when SAP is written to - which is exactly
 * how the 654 imported items are set up.
 */
export const nextItemCode = async (prefix = "SAP") => {
  // Every one of them, not a page: the highest number is what matters, and
  // ordering by creation would have put SAP654 behind anything renamed since.
  const rows = await listAll("Item", {
    fields: ["name"],
    filters: [["Item", "name", "like", `${prefix}%`]],
  });

  const pattern = new RegExp(`^${prefix}(\\d+)$`);
  const highest = rows.reduce((best, row) => {
    const match = pattern.exec(row.name);
    return match ? Math.max(best, Number(match[1])) : best;
  }, 0);

  return `${prefix}${highest + 1}`;
};

/**
 * Resolves the Item Group for a category and sub-category, creating it if the
 * catalog has not seen it before.
 *
 * Serially, and parent first: Item Group is a nested set, so a child inserted
 * before its parent is refused and two siblings at once deadlock.
 */
const ensureItemGroup = async (category, subCategory) => {
  const cat = String(category || "").trim();
  if (!cat) return MAINTENANCE_ROOT;

  const groups = await readGroups();
  const match = (c, s) =>
    [...groups.entries()].find(([, g]) => g.category === c && g.subCategory === s)?.[0];

  const sub = String(subCategory || "").trim();
  const existing = match(cat, sub);
  if (existing) return existing;

  const parent = match(cat, "") || cat;
  if (!(await docExists("Item Group", parent))) {
    await createDoc("Item Group", {
      doctype: "Item Group",
      item_group_name: cat,
      parent_item_group: MAINTENANCE_ROOT,
      is_group: sub ? 1 : 0,
    });
  }
  if (!sub) return cat;

  // A sub-category name already used elsewhere is qualified by its parent, the
  // same way the import did it - Item Group names are unique across all of
  // ERPNext and the comparison ignores case.
  const wanted = (await docExists("Item Group", sub)) ? `${sub} (${parent})` : sub;
  await createDoc("Item Group", {
    doctype: "Item Group",
    item_group_name: wanted,
    parent_item_group: parent,
    is_group: 0,
  });
  return wanted;
};

/**
 * Adds an item to the catalog, with its opening stock if it came with any.
 *
 * The opening balance is posted as a Stock Reconciliation with purpose
 * "Opening Stock", the same document the 654 imported items were opened with,
 * so a new item's history reads the same as theirs rather than appearing to
 * have been received from a supplier who never sent it.
 */
export const createCatalogItem = async ({
  code = "",
  name,
  category,
  subCategory = "",
  // An already-resolved ERPNext Item Group, for callers that hold one - the
  // approval path does, because the request stored it directly rather than as
  // a category the catalog would have to map back.
  itemGroup = "",
  unit = "",
  brand = "",
  minStock = 0,
  unitCost = 0,
  rackNumber = "",
  description = "",
  image = "",
  storeRoom = "",
  quantity = 0,
} = {}) => {
  const clean = String(name || "").trim();
  if (!clean) throw new Error("A name is required");
  if (!itemGroup && !String(category || "").trim()) {
    throw new Error("A category is required");
  }

  const itemCode = String(code || "").trim() || (await nextItemCode());
  if (await docExists("Item", itemCode)) {
    throw new Error(`Item code "${itemCode}" is already used`);
  }

  const group = itemGroup || (await ensureItemGroup(category, subCategory));
  const { uom } = resolveUom(unit);
  const warehouse = warehouseFor(storeRoom);

  await createDoc("Item", {
    doctype: "Item",
    item_code: itemCode,
    item_name: clean.slice(0, 140),
    item_group: group,
    stock_uom: uom,
    is_stock_item: 1,
    include_item_in_manufacturing: 0,
    is_purchase_item: 1,
    is_sales_item: 0,
    description: String(description || "").trim() || clean,
    ...(String(brand || "").trim() ? { brand: String(brand).trim() } : {}),
    safety_stock: Number(minStock) || 0,
    ...(Number(unitCost) > 0 ? { valuation_rate: Number(unitCost) } : {}),
    ...(String(rackNumber || "").trim() ? { custom_rack_location: String(rackNumber).trim() } : {}),
    ...(String(image || "").trim() ? { image: String(image).trim() } : {}),
    item_defaults: [
      { doctype: "Item Default", company: ERP_COMPANY, ...(warehouse ? { default_warehouse: warehouse } : {}) },
    ],
  });

  const opening = Number(quantity) || 0;
  if (opening > 0 && warehouse) {
    await createDoc(
      "Stock Reconciliation",
      buildReconciliation({
        warehouse,
        rows: [{ itemCode, qty: opening, valuationRate: Number(unitCost) || 0 }],
        company: ERP_COMPANY,
        expenseAccount: `Temporary Opening - ${ERP_ABBR}`,
        postedAt: new Date(),
        note: "new catalog item",
      })
    );
  }

  // The list is cached for 20 seconds; without this the item somebody just
  // added is missing from the screen that added it.
  forgetCatalog();

  // The resolved group goes back with it: a sub-category whose name was
  // already taken gets qualified by its parent, so what was asked for and what
  // was created are not always the same string.
  return { ...(await getCatalogItem(itemCode)), itemGroup: group };
};


/**
 * Takes an item out of the catalog.
 *
 * Deleting outright is tried first and usually refused: ERPNext will not
 * delete an Item that any stock document has ever referenced, even a cancelled
 * one, and says so - "You can disable this Item instead of deleting it."
 *
 * So the fallback is what ERPNext itself suggests. The stock is written down
 * to zero by cancelling the documents that put it there, and the item is
 * disabled, which takes it out of every catalog view. The ledger stays, which
 * is correct: those movements really happened, and an audit that could not see
 * them would be lying about a period it covers.
 *
 * @returns { removed } true when it was really deleted, false when disabled
 */
export const retireCatalogItem = async (code) => {
  const itemCode = String(code || "").trim();
  if (!itemCode) throw new Error("An item code is required");
  if (!(await docExists("Item", itemCode))) throw new Error(`No item called "${itemCode}"`);

  // Any stock this item still holds has to come off the books first, or
  // disabling it would hide a balance that is still counted in stock reports.
  const entries = await listDocs("Stock Ledger Entry", {
    fields: ["voucher_type", "voucher_no", "is_cancelled"],
    filters: [["Stock Ledger Entry", "item_code", "=", itemCode]],
    limit: 100,
  });

  const cancelled = [];
  for (const entry of entries) {
    if (entry.is_cancelled) continue;
    // Only the documents this system opens stock with. Anything else - a
    // purchase receipt, a delivery - is somebody else's record and is not this
    // function's to reverse.
    if (entry.voucher_type !== "Stock Reconciliation") {
      throw new Error(
        `${itemCode} has stock movements from a ${entry.voucher_type} (${entry.voucher_no}). ` +
          "Reverse that in ERPNext first - this will not undo somebody else's document."
      );
    }
    if (cancelled.includes(entry.voucher_no)) continue;
    await cancelDoc("Stock Reconciliation", entry.voucher_no);
    cancelled.push(entry.voucher_no);
  }

  let removed = false;
  let refusal = "";
  try {
    await deleteDoc("Item", itemCode);
    removed = true;
  } catch (error) {
    if (!/linked with|cannot delete/i.test(error.message)) throw error;
    // ERPNext names what it is still linked to - a stock document, a naming
    // request, a BOM. Guessing "it has stock history" was wrong the first time
    // it ran: the item had no stock at all and was held by its own request.
    refusal = error.message
      .replace(/<[^>]+>/g, "")
      .replace(/^ERPNext \d+: /, "")
      .replace(/ ; You can disable this Item instead of deleting it\.?/, "")
      .trim();
    await updateDoc("Item", itemCode, { disabled: 1 });
  }

  forgetCatalog();

  return {
    code: itemCode,
    removed,
    cancelledDocuments: cancelled,
    refusal,
    message: removed
      ? `${itemCode} was deleted.`
      : `${itemCode} is out of the catalog and its balance is zero. ERPNext would not delete the record outright: ${refusal}`,
  };
};


/**
 * The units ERPNext actually holds.
 *
 * Offered to the form so a unit is picked rather than typed. `uom` is a Link
 * field, so a spelling ERPNext does not hold is refused outright - which is
 * how "Pieces" got as far as the server and came back as
 * "Could not find Unit: Pieces".
 *
 * The ones the store already uses come first, because a list of every UOM
 * ERPNext ships with is mostly furlongs and troy ounces.
 */
export const listUnits = async () => {
  const [units, products] = await Promise.all([
    listAll("UOM", { fields: ["name"], filters: [["UOM", "enabled", "=", 1]] }).catch(() =>
      listAll("UOM", { fields: ["name"] })
    ),
    readCatalog(),
  ]);

  const inUse = new Set(products.map((p) => p.unit).filter(Boolean));
  const all = units.map((u) => u.name);

  return {
    inUse: all.filter((u) => inUse.has(u)).sort((a, b) => a.localeCompare(b)),
    others: all.filter((u) => !inUse.has(u)).sort((a, b) => a.localeCompare(b)),
  };
};
