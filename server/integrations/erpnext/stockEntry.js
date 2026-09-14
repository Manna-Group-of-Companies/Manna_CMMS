/**
 * Turning one row of the stock ledger into one ERPNext Stock Entry.
 *
 * Pure: no database, no network. Everything it needs is passed in, which is
 * what lets the whole mapping table be tested directly rather than inferred
 * from what ERPNext ends up holding.
 *
 * --- What the CMMS means, and what ERPNext is told ----------------------
 *
 * Issued stock leaves this system's room balances entirely; a recipient
 * holding a spanner is not stock on a shelf, and no CMMS screen counts it. So
 * an issue is a Material Issue in ERPNext too — the stock leaves the company —
 * and a later return is a Material Receipt bringing it back into Red Stock.
 *
 * That is what keeps `StockRoomInventory` and ERPNext's `Bin` meaning the same
 * thing, which in turn is the only reason the nightly reconciliation can
 * compare them. Modelling issues as a transfer to some "in use" warehouse
 * would track the recipient better and break that correspondence.
 *
 * It also explains the three no-ops. Consuming or scrapping issued stock
 * closes out what a recipient still owes; the quantity left the building at
 * issue time and ERPNext was told then. Posting again would remove it twice.
 */

/** The name the ledger uses for Red Stock, which is not a `StockRoom` record. */
export const RED_STOCK_ROOM = "Red Stock Room";

const ISSUE = "Material Issue";
const RECEIPT = "Material Receipt";
const TRANSFER = "Material Transfer";

/**
 * What each ledger type becomes, and which rooms the entry draws on.
 *
 * `source`/`target` name where to look for the warehouse: the movement's own
 * `fromRoom`/`toRoom`, the Red Stock warehouse, or the product's home room
 * when the call site recorded no room at all.
 */
const MAPPING = {
  ISSUE: { purpose: ISSUE, source: "fromRoom|home" },
  STOCK_OUT: { purpose: ISSUE, source: "fromRoom|home" },

  RETURN_TO_RED_STOCK: { purpose: RECEIPT, target: "redStock" },
  // Pre-Red-Stock name for the same movement.
  RETURN_TO_RESTOCK: { purpose: RECEIPT, target: "redStock" },

  MERGE_IN: { purpose: TRANSFER, source: "redStock", target: "toRoom|home" },
  TRANSFER: { purpose: TRANSFER, source: "fromRoom", target: "toRoom" },

  STOCK_IN: { purpose: RECEIPT, target: "toRoom|home" },
  STOCK_RETURN: { purpose: RECEIPT, target: "toRoom|home" },

  // Stock already gone at issue time; see the note above.
  CONSUMED: { skip: "issued stock is already out of ERPNext" },
  SCRAPPED: { skip: "issued stock is already out of ERPNext" },
  // Catalog events, not stock events. A creation that carried an opening
  // quantity is handled below, before this table is consulted.
  PRODUCT_CREATED: { skip: "catalog change, no stock moved" },
  PRODUCT_EDITED: { skip: "catalog change, no stock moved" },
};

/** ERPNext wants the date and the time of day as separate fields. */
const postingParts = (date) => {
  const at = date instanceof Date ? date : new Date(date || Date.now());
  const iso = at.toISOString();
  return { posting_date: iso.slice(0, 10), posting_time: iso.slice(11, 19) };
};

/**
 * Builds the Stock Entry for one movement.
 *
 * @param movement    the ledger facts: type, direction, quantity, productCode,
 *                    fromRoom, toRoom, reference, note, createdAt, homeRoom
 * @param rooms       optional [{ room, quantity }] when the movement drew on
 *                    several rooms at once — an issue is filled from whichever
 *                    rooms hold the stock, and each becomes its own item row
 * @param unitCost    last known cost per unit, 0 when never costed
 * @param company     the ERPNext company name
 * @param warehouseFor  (roomName) => warehouse name, or "" if unresolvable
 *
 * @returns { skip: true, reason } or { doctype, payload }
 */
export const buildStockEntry = ({
  movement,
  rooms = [],
  unitCost = 0,
  company,
  warehouseFor,
}) => {
  const type = String(movement?.type || "");
  const quantity = Number(movement?.quantity || 0);

  // A creation with an opening quantity really did put stock on a shelf, so it
  // is a receipt like any other. One without is only a catalog row.
  const rule =
    type === "PRODUCT_CREATED" && movement.direction === "IN" && quantity > 0
      ? { purpose: RECEIPT, target: "toRoom|home" }
      : MAPPING[type];

  if (!rule) return { skip: true, reason: `unmapped movement type "${type}"` };
  if (rule.skip) return { skip: true, reason: rule.skip };
  if (quantity <= 0) return { skip: true, reason: "zero quantity" };

  if (!movement.productCode) {
    // Without an item code there is nothing to post against. The product
    // predates codes or was imported without one; Phase 2 is what fixes it.
    return { skip: true, reason: "product has no code to match an ERPNext Item" };
  }

  /** Resolves one side of the entry from its rule fragment. */
  const resolve = (spec) => {
    if (!spec) return "";
    for (const step of spec.split("|")) {
      if (step === "redStock") {
        const found = warehouseFor(RED_STOCK_ROOM);
        if (found) return found;
        continue;
      }
      const roomName = step === "home" ? movement.homeRoom : movement[step];
      // `fromRoom` is a comma-joined list when an issue was drawn across
      // rooms. Only the first is usable as a single warehouse; the `rooms`
      // breakdown below is the accurate path, and this is the fallback.
      const first = String(roomName || "").split(",")[0].trim();
      if (!first) continue;
      const found = warehouseFor(first);
      if (found) return found;
    }
    return "";
  };

  const source = resolve(rule.source);
  const target = resolve(rule.target);

  if (rule.source && !source) {
    return { skip: true, reason: `no ERPNext warehouse for source room` };
  }
  if (rule.target && !target) {
    return { skip: true, reason: `no ERPNext warehouse for target room` };
  }

  const line = (qty, sWarehouse, tWarehouse) => ({
    item_code: movement.productCode,
    qty,
    ...(sWarehouse ? { s_warehouse: sWarehouse } : {}),
    ...(tWarehouse ? { t_warehouse: tWarehouse } : {}),
    // Most of the catalog has never been costed, and ERPNext refuses a
    // movement at zero valuation unless told this is expected. The CMMS
    // tracks quantity, not value, so it always is.
    allow_zero_valuation_rate: 1,
    ...(unitCost > 0 ? { basic_rate: unitCost } : {}),
  });

  // An issue drawn across rooms is one entry with a row per room, so ERPNext
  // debits each warehouse by what actually came out of it.
  const drawn = rule.source && rooms.length > 0
    ? rooms
        .map(({ room, quantity: qty }) => ({
          warehouse: warehouseFor(String(room || "").trim()),
          qty: Number(qty || 0),
        }))
        .filter((entry) => entry.warehouse && entry.qty > 0)
    : [];

  const items =
    drawn.length > 0 && drawn.reduce((sum, e) => sum + e.qty, 0) === quantity
      ? drawn.map((entry) => line(entry.qty, entry.warehouse, target))
      : [line(quantity, source, target)];

  return {
    doctype: "Stock Entry",
    payload: {
      doctype: "Stock Entry",
      stock_entry_type: rule.purpose,
      company,
      ...postingParts(movement.createdAt),
      // Without this ERPNext stamps "now" and the ledger drifts from the
      // times the store actually recorded.
      set_posting_time: 1,
      remarks: [movement.reference, movement.note].filter(Boolean).join(" — ").slice(0, 500),
      items,
      // Inserted and submitted in one call. A draft would sit in ERPNext
      // affecting nothing and still counting as synced here.
      docstatus: 1,
    },
  };
};
