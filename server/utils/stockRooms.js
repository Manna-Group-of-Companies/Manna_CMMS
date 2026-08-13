import mongoose from "mongoose";
import Product from "../models/Product.js";
import StockRoom from "../models/StockRoom.js";
import StockRoomInventory from "../models/StockRoomInventory.js";
import ProductRequest from "../models/ProductRequest.js";
import StockInRequest from "../models/StockInRequest.js";
import IssueHistory from "../models/IssueHistory.js";
import RestockItem from "../models/RestockItem.js";
import MergeRequest from "../models/MergeRequest.js";
import StockMovement from "../models/StockMovement.js";

/**
 * Every read and write of per-room stock goes through here.
 *
 * Two numbers describe the same stock: the per-room rows in
 * `StockRoomInventory`, and `Product.quantity`, which the rest of the app
 * treats as the total. The rows are authoritative; the total is recomputed
 * from them after every change so the two can never drift, even if two
 * approvals land at once.
 */

/**
 * Every place a room's *name* is kept outside the StockRoom record itself.
 *
 * Rooms are referenced by id where the link has to survive anything, but these
 * fields snapshot the name so a list still reads correctly years later. A
 * rename has to rewrite them, or old rows would point at a room that no longer
 * answers to that name.
 */
const ROOM_NAME_FIELDS = [
  [Product, "storeRoom"],
  [ProductRequest, "details.storeRoom"],
  [IssueHistory, "sourceRoom"],
  [RestockItem, "sourceRoom"],
  [RestockItem, "destinationRoom"],
  [MergeRequest, "destinationRoom"],
  [StockMovement, "fromRoom"],
  [StockMovement, "toRoom"],
];

/**
 * Applies `StockRoom.RENAMED_ROOMS`: renames the room record and rewrites
 * every stored copy of the old name.
 *
 * Runs on boot and is a no-op once no old name is left anywhere, so it is safe
 * to keep in the startup path. Writes go through the driver rather than the
 * models so a document still holding an old value cannot fail validation on
 * its way to the new one.
 */
export const renameStockRooms = async () => {
  let renamedRooms = 0;
  let rewritten = 0;

  for (const [from, to] of StockRoom.RENAMED_ROOMS) {
    const old = await StockRoom.findOne({ name: from });

    if (old) {
      const target = await StockRoom.findOne({ name: to });

      if (target) {
        // Both names already exist — the new room was created before the
        // rename reached this database. Move the old room's stock onto it
        // rather than leaving the same product split across two rooms.
        const rows = await StockRoomInventory.find({ stockRoom: old._id });
        for (const row of rows) {
          await StockRoomInventory.updateOne(
            { stockRoom: target._id, product: row.product },
            { $inc: { quantity: row.quantity } },
            { upsert: true }
          );
        }
        await StockRoomInventory.deleteMany({ stockRoom: old._id });

        // Anything still pointing at the old room by id has to follow the
        // stock, or an approved stock-in would credit a room that is gone.
        await StockInRequest.collection.updateMany(
          { requestedStockRoom: old._id },
          { $set: { requestedStockRoom: target._id } }
        );
        await StockInRequest.collection.updateMany(
          { stockRoom: old._id },
          { $set: { stockRoom: target._id } }
        );

        // Nothing refers to it now, and leaving it would make this migration
        // find the old name again on every boot.
        await StockRoom.deleteOne({ _id: old._id });
        console.log(`Stock rooms: merged "${from}" into the existing "${to}".`);
      } else {
        await StockRoom.collection.updateOne({ _id: old._id }, { $set: { name: to } });
      }

      renamedRooms += 1;
    }

    // Runs whether or not the room record was still there: the stored copies
    // outlive it, and a half-finished rename must be able to complete.
    for (const [Model, field] of ROOM_NAME_FIELDS) {
      const { modifiedCount } = await Model.collection.updateMany(
        { [field]: from },
        { $set: { [field]: to } }
      );
      rewritten += modifiedCount || 0;
    }

    // Merge lines are nested, so they need their own pass.
    const { modifiedCount: lines } = await MergeRequest.collection.updateMany(
      { "items.destinationRoom": from },
      { $set: { "items.$[line].destinationRoom": to } },
      { arrayFilters: [{ "line.destinationRoom": from }] }
    );
    rewritten += lines || 0;
  }

  if (renamedRooms || rewritten) {
    console.log(
      `Stock room rename: ${renamedRooms} room(s) renamed, ${rewritten} stored reference(s) updated.`
    );
  }
  return { renamedRooms, rewritten };
};

/** Creates the default rooms on first boot. Safe to call repeatedly. */
export const ensureDefaultRooms = async () => {
  for (const name of StockRoom.DEFAULT_ROOMS) {
    await StockRoom.updateOne(
      { name },
      { $setOnInsert: { name, isActive: true } },
      { upsert: true }
    );
  }
};

/**
 * Resolves a room id, a room name, or a StockRoom document to a document.
 * Named rooms that do not exist yet are created, so a product carrying a
 * legacy `storeRoom` string always has somewhere to put its stock.
 */
export const resolveRoom = async (room) => {
  if (!room) return null;
  if (room instanceof mongoose.Model || room?._id) return room;

  const value = String(room).trim();
  if (!value) return null;

  if (mongoose.Types.ObjectId.isValid(value)) {
    const byId = await StockRoom.findById(value);
    if (byId) return byId;
  }

  const byName = await StockRoom.findOne({ name: value });
  if (byName) return byName;

  return StockRoom.create({ name: value });
};

/** The product's default room — where stock lands when no room is named. */
export const homeRoomFor = (product) => resolveRoom(product.storeRoom);

/**
 * Recomputes `Product.quantity` as the sum of its room rows and saves it.
 * Returns the new total.
 */
export const syncProductTotal = async (productId) => {
  const [totals] = await StockRoomInventory.aggregate([
    { $match: { product: new mongoose.Types.ObjectId(String(productId)) } },
    { $group: { _id: null, total: { $sum: "$quantity" } } },
  ]);

  const total = totals?.total ?? 0;
  await Product.updateOne({ _id: productId }, { quantity: total });
  return total;
};

/**
 * Adds [quantity] to exactly one room. Only the named room moves — this is
 * what keeps an approval from crediting every room at once.
 *
 * Returns `{ room, roomQuantity, productQuantity }`.
 */
export const creditRoom = async ({ product, room, quantity }) => {
  const qty = Number(quantity);
  if (!Number.isInteger(qty) || qty < 1) {
    throw new Error("Credit quantity must be a whole number of at least 1");
  }

  const target = (await resolveRoom(room)) || (await homeRoomFor(product));
  if (!target) throw new Error("No stock room could be resolved for this product");

  const row = await StockRoomInventory.findOneAndUpdate(
    { stockRoom: target._id, product: product._id },
    { $inc: { quantity: qty } },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
  );

  const productQuantity = await syncProductTotal(product._id);
  // Keep the caller's in-memory copy usable for the ledger entry.
  product.quantity = productQuantity;

  return { room: target, roomQuantity: row.quantity, productQuantity };
};

/**
 * Removes [quantity] from exactly one room, refusing to go negative.
 */
export const debitRoom = async ({ product, room, quantity }) => {
  const qty = Number(quantity);
  if (!Number.isInteger(qty) || qty < 1) {
    throw new Error("Debit quantity must be a whole number of at least 1");
  }

  const target = (await resolveRoom(room)) || (await homeRoomFor(product));
  if (!target) throw new Error("No stock room could be resolved for this product");

  // The quantity guard lives in the filter so a concurrent debit cannot slip
  // the balance below zero between the read and the write.
  const row = await StockRoomInventory.findOneAndUpdate(
    { stockRoom: target._id, product: product._id, quantity: { $gte: qty } },
    { $inc: { quantity: -qty } },
    { returnDocument: "after" }
  );

  if (!row) {
    const existing = await StockRoomInventory.findOne({
      stockRoom: target._id,
      product: product._id,
    });
    throw new Error(
      `Insufficient stock in ${target.name}: ${existing?.quantity ?? 0} available, ${qty} requested`
    );
  }

  const productQuantity = await syncProductTotal(product._id);
  product.quantity = productQuantity;

  return { room: target, roomQuantity: row.quantity, productQuantity };
};

/**
 * Removes [quantity] without the caller naming a room: drains [preferredRoom]
 * first, then the fullest remaining rooms. Used by the issue and stock-out
 * flows, which pick a product rather than a location.
 *
 * Returns the rooms drawn from, so the ledger note can say where it came from.
 */
export const debitAcrossRooms = async ({ product, preferredRoom, quantity }) => {
  const qty = Number(quantity);
  if (!Number.isInteger(qty) || qty < 1) {
    throw new Error("Debit quantity must be a whole number of at least 1");
  }

  const rows = await StockRoomInventory.find({ product: product._id, quantity: { $gt: 0 } })
    .populate("stockRoom", "name")
    .sort({ quantity: -1 });

  const available = rows.reduce((sum, row) => sum + row.quantity, 0);
  if (available < qty) {
    throw new Error(`Insufficient stock. Available: ${available}, requested: ${qty}`);
  }

  const preferred = await resolveRoom(preferredRoom || product.storeRoom);
  const ordered = preferred
    ? [
        ...rows.filter((row) => String(row.stockRoom?._id) === String(preferred._id)),
        ...rows.filter((row) => String(row.stockRoom?._id) !== String(preferred._id)),
      ]
    : rows;

  const drawn = [];
  let remaining = qty;

  for (const row of ordered) {
    if (remaining <= 0) break;
    const take = Math.min(row.quantity, remaining);
    await StockRoomInventory.updateOne({ _id: row._id }, { $inc: { quantity: -take } });
    drawn.push({ room: row.stockRoom?.name || "Unknown", quantity: take });
    remaining -= take;
  }

  const productQuantity = await syncProductTotal(product._id);
  product.quantity = productQuantity;

  return { drawn, productQuantity };
};

/** Per-room rows for one product, newest rooms last. */
export const roomBreakdownFor = async (productId) => {
  const rows = await StockRoomInventory.find({ product: productId })
    .populate("stockRoom", "name isActive")
    .sort({ createdAt: 1 });

  return rows
    .filter((row) => row.stockRoom)
    .map((row) => ({
      stockRoomId: row.stockRoom._id,
      stockRoom: row.stockRoom.name,
      quantity: row.quantity,
    }));
};

/**
 * Backfills room rows for products created before rooms existed: the whole of
 * `Product.quantity` is placed in the product's own `storeRoom`. Runs on boot
 * and skips any product that already has rows.
 */
export const migrateProductsIntoRooms = async () => {
  const products = await Product.find();
  if (products.length === 0) return 0;

  const withRows = await StockRoomInventory.distinct("product");
  const seeded = new Set(withRows.map(String));

  let migrated = 0;
  for (const product of products) {
    if (seeded.has(String(product._id))) continue;

    const room = await homeRoomFor(product);
    if (!room) continue;

    await StockRoomInventory.updateOne(
      { stockRoom: room._id, product: product._id },
      { $setOnInsert: { quantity: product.quantity || 0 } },
      { upsert: true }
    );
    migrated += 1;
  }

  if (migrated > 0) {
    console.log(`Migrated ${migrated} product(s) into per-room inventory.`);
  }
  return migrated;
};
