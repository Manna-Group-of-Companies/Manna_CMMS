import StockRoom from "../models/StockRoom.js";
import StockRoomInventory from "../models/StockRoomInventory.js";
import Product from "../models/Product.js";
import Notification from "../models/Notification.js";
import { recordMovement } from "../utils/stockLedger.js";
import { roomBreakdownFor, resolveRoom, creditRoom, debitRoom } from "../utils/stockRooms.js";

/**
 * @desc    List the stock rooms, for pickers and filters
 * @route   GET /api/stock-rooms
 * @access  Private
 */
export const getStockRooms = async (req, res) => {
  try {
    const rooms = await StockRoom.find({ isActive: true }).sort({ name: 1 });
    res.json(rooms);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/**
 * @desc    Current stock grouped by room — the Supervisor's Stock tab
 * @route   GET /api/stock-rooms/inventory
 * @access  Private
 */
export const getInventoryByRoom = async (req, res) => {
  try {
    const rooms = await StockRoom.find({ isActive: true }).sort({ name: 1 });

    const rows = await StockRoomInventory.find()
      .populate("product", "name code unit image minStock category")
      .sort({ quantity: -1 });

    const byRoom = new Map(rooms.map((room) => [String(room._id), []]));

    for (const row of rows) {
      // Skip rows whose product was deleted, and rooms that were retired.
      if (!row.product) continue;
      const bucket = byRoom.get(String(row.stockRoom));
      if (!bucket) continue;

      bucket.push({
        productId: row.product._id,
        name: row.product.name,
        code: row.product.code,
        unit: row.product.unit,
        image: row.product.image,
        category: row.product.category,
        minStock: row.product.minStock,
        quantity: row.quantity,
        isLowStock: row.quantity <= (row.product.minStock ?? 0),
      });
    }

    res.json(
      rooms.map((room) => {
        const items = byRoom.get(String(room._id)) || [];
        return {
          _id: room._id,
          name: room.name,
          description: room.description,
          itemCount: items.length,
          totalQuantity: items.reduce((sum, item) => sum + item.quantity, 0),
          items,
        };
      })
    );
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/**
 * @desc    Per-room breakdown for one product
 * @route   GET /api/stock-rooms/products/:productId
 * @access  Private
 */
export const getProductRoomBreakdown = async (req, res) => {
  try {
    const breakdown = await roomBreakdownFor(req.params.productId);
    res.json(breakdown);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/**
 * @desc    Move stock between two rooms. The product total is unchanged —
 *          only where the stock sits changes.
 * @route   POST /api/stock-rooms/transfer
 * @access  Private (Admin)
 */
export const transferStock = async (req, res) => {
  const { productId, fromRoomId, toRoomId, quantity, note } = req.body;

  try {
    const qty = Number(quantity);
    if (!Number.isInteger(qty) || qty < 1) {
      return res.status(400).json({ message: "Transfer quantity must be at least 1" });
    }
    if (!fromRoomId || !toRoomId) {
      return res.status(400).json({ message: "Both a source and destination room are required" });
    }
    if (String(fromRoomId) === String(toRoomId)) {
      return res.status(400).json({ message: "Source and destination rooms must differ" });
    }

    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({ message: "Engineering Stock not found" });
    }

    const fromRoom = await resolveRoom(fromRoomId);
    const toRoom = await resolveRoom(toRoomId);
    if (!fromRoom || !toRoom) {
      return res.status(404).json({ message: "Stock room not found" });
    }

    // Debit first: it refuses to go negative, so a failure here leaves both
    // rooms untouched.
    await debitRoom({ product, room: fromRoom, quantity: qty });
    const { roomQuantity: toQuantity } = await creditRoom({
      product,
      room: toRoom,
      quantity: qty,
    });

    await recordMovement({
      product,
      type: "TRANSFER",
      direction: "NONE",
      quantity: qty,
      reference: product.code,
      performedBy: req.user._id,
      note: (note || "").trim() || `Transferred by ${req.user.name}`,
      fromRoom: fromRoom.name,
      toRoom: toRoom.name,
    });

    await Notification.create({
      message: `${qty} × "${product.name}" moved ${fromRoom.name} → ${toRoom.name} by ${req.user.name}`,
      type: "REQUEST_APPROVED",
    });

    res.json({
      message: `Moved ${qty} ${product.unit} of "${product.name}" from ${fromRoom.name} to ${toRoom.name}`,
      productQuantity: product.quantity,
      toRoomQuantity: toQuantity,
      breakdown: await roomBreakdownFor(product._id),
    });
  } catch (error) {
    console.error("Error transferring stock:", error);
    res.status(400).json({ message: error.message });
  }
};

/**
 * @desc    Set one room's quantity for a product outright (a stock count
 *          correction). The difference is applied to that room only.
 * @route   PUT /api/stock-rooms/inventory
 * @access  Private (Admin)
 */
export const setRoomQuantity = async (req, res) => {
  const { productId, stockRoomId, quantity, note } = req.body;

  try {
    const target = Number(quantity);
    if (!Number.isInteger(target) || target < 0) {
      return res.status(400).json({ message: "Quantity must be a whole number of 0 or more" });
    }

    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({ message: "Engineering Stock not found" });
    }

    const room = await resolveRoom(stockRoomId);
    if (!room) {
      return res.status(404).json({ message: "Stock room not found" });
    }

    const row = await StockRoomInventory.findOne({ stockRoom: room._id, product: product._id });
    const current = row?.quantity ?? 0;
    const delta = target - current;

    if (delta > 0) {
      await creditRoom({ product, room, quantity: delta });
    } else if (delta < 0) {
      await debitRoom({ product, room, quantity: Math.abs(delta) });
    }

    if (delta !== 0) {
      await recordMovement({
        product,
        type: delta > 0 ? "STOCK_IN" : "STOCK_OUT",
        direction: delta > 0 ? "IN" : "OUT",
        quantity: Math.abs(delta),
        reference: product.code,
        performedBy: req.user._id,
        note: (note || "").trim() || `${room.name} set to ${target} by ${req.user.name}`,
        toRoom: delta > 0 ? room.name : "",
        fromRoom: delta < 0 ? room.name : "",
      });
    }

    res.json({
      message: `${room.name} now holds ${target} ${product.unit} of "${product.name}"`,
      productQuantity: product.quantity,
      breakdown: await roomBreakdownFor(product._id),
    });
  } catch (error) {
    console.error("Error setting room quantity:", error);
    res.status(400).json({ message: error.message });
  }
};
