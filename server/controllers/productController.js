import Product from "../models/Product.js";
import StockRoomInventory from "../models/StockRoomInventory.js";
import Notification from "../models/Notification.js";
import { recordMovement } from "../utils/stockLedger.js";
import {
  creditRoom,
  debitAcrossRooms,
  resolveRoom,
  roomBreakdownFor,
} from "../utils/stockRooms.js";

// @desc    Get all products with search and filtering
// @route   GET /api/products
// @access  Private (Both Admin and Supervisor)
export const getProducts = async (req, res) => {
  try {
    const { search, category, subCategory, storeRoom, stockStatus } = req.query;

    let query = {};

    // Search query
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { code: { $regex: search, $options: "i" } },
        { category: { $regex: search, $options: "i" } },
        // Searching the rack answers "what is on A-1?", which is how somebody
        // standing in front of the shelving looks things up.
        { rackNumber: { $regex: search, $options: "i" } },
      ];
    }

    // Exact filters
    if (category) {
      query.category = category;
    }

    if (subCategory) {
      query.subCategory = subCategory;
    }

    if (storeRoom) {
      query.storeRoom = storeRoom;
    }

    // Stock level filtering
    if (stockStatus === "low") {
      // quantity <= minStock
      query.$expr = { $lte: ["$quantity", "$minStock"] };
    } else if (stockStatus === "out") {
      query.quantity = 0;
    }

    const products = await Product.find(query).sort({ updatedAt: -1 });
    res.json(products);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get product by ID
// @route   GET /api/products/:id
// @access  Private
export const getProductById = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);

    if (product) {
      res.json(product);
    } else {
      res.status(404).json({ message: "Product not found" });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get all unique categories
// @route   GET /api/products/categories
// @access  Private
export const getCategories = async (req, res) => {
  try {
    const categories = await Product.distinct("category");
    res.json(categories);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Sub-categories in use, optionally narrowed to one category
// @route   GET /api/products/subcategories?category=Tools
// @access  Private
//
// Scoped on purpose: the catalog carries well over a hundred sub-categories,
// and an unfiltered list is unusable in a dropdown. Passing the category the
// user already picked leaves only the handful that belong to it.
export const getSubCategories = async (req, res) => {
  try {
    const { category } = req.query;
    const filter = category ? { category } : {};

    const subCategories = await Product.distinct("subCategory", filter);
    // Products predating the field have "", which is not a choice anyone can
    // filter on.
    res.json(subCategories.filter(Boolean).sort((a, b) => a.localeCompare(b)));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ==========================================
// ADMIN: direct catalog management
//
// Supervisors change the catalog by raising ADD/EDIT requests. An Admin edits
// it directly here. Quantity is never assigned — it is applied through the
// stock room helpers so the per-room rows stay the source of truth.
// ==========================================

const generateProductCode = () => `PRD-${Math.floor(100000 + Math.random() * 900000)}`;

/** Fields an Admin may set directly. `quantity` is handled separately. */
const EDITABLE_FIELDS = [
  "name",
  "category",
  "subCategory",
  "brand",
  "status",
  "rackNumber",
  "unit",
  "minStock",
  "maxStock",
  "unitCost",
  "description",
  "image",
];

// @desc    Create a product
// @route   POST /api/products
// @access  Private (Admin)
export const createProduct = async (req, res) => {
  try {
    const { code, quantity = 0, storeRoom, ...rest } = req.body;

    if (!storeRoom || !String(storeRoom).trim()) {
      return res.status(400).json({ message: "Store Room is required" });
    }

    const productCode = code?.trim() || generateProductCode();
    if (await Product.findOne({ code: productCode })) {
      return res.status(400).json({ message: `Product code ${productCode} already exists` });
    }

    const openingQuantity = Number(quantity) || 0;
    if (openingQuantity < 0) {
      return res.status(400).json({ message: "Opening quantity cannot be negative" });
    }

    // Created empty, then credited, so the room row and the total are written
    // by the same path as every other stock movement.
    const product = await Product.create({
      ...rest,
      code: productCode,
      storeRoom: String(storeRoom).trim(),
      quantity: 0,
    });

    if (openingQuantity > 0) {
      await creditRoom({ product, room: product.storeRoom, quantity: openingQuantity });
    }

    await recordMovement({
      product,
      type: "PRODUCT_CREATED",
      direction: openingQuantity > 0 ? "IN" : "NONE",
      quantity: openingQuantity,
      reference: product.code,
      performedBy: req.user._id,
      note: `Created by ${req.user.name} in ${product.storeRoom}`,
    });

    await Notification.create({
      message: `Product "${product.name}" added to the catalog by ${req.user.name}`,
      type: "REQUEST_APPROVED",
    });

    res.status(201).json(await Product.findById(product._id));
  } catch (error) {
    console.error("Error creating product:", error);
    res.status(500).json({ message: error.message });
  }
};

// @desc    Update a product. Quantity and store room changes move real stock.
// @route   PUT /api/products/:id
// @access  Private (Admin)
export const updateProduct = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    const { code, quantity, storeRoom } = req.body;

    // Product code is user-facing and must stay unique.
    if (code && code.trim() && code.trim() !== product.code) {
      if (await Product.findOne({ code: code.trim(), _id: { $ne: product._id } })) {
        return res.status(400).json({ message: `Product code ${code.trim()} is already taken` });
      }
      product.code = code.trim();
    }

    for (const field of EDITABLE_FIELDS) {
      if (req.body[field] !== undefined) product[field] = req.body[field];
    }

    const previousRoom = product.storeRoom;
    const roomChanged =
      storeRoom && String(storeRoom).trim() && String(storeRoom).trim() !== previousRoom;
    if (roomChanged) product.storeRoom = String(storeRoom).trim();

    await product.save();

    // Moving the home room takes that room's stock with it, which is what
    // "this product now lives in the Consumables Room" is understood to mean.
    if (roomChanged) {
      const fromRoom = await resolveRoom(previousRoom);
      const toRoom = await resolveRoom(product.storeRoom);
      const row = fromRoom
        ? await StockRoomInventory.findOne({ stockRoom: fromRoom._id, product: product._id })
        : null;

      if (row && row.quantity > 0 && toRoom) {
        const moved = row.quantity;
        await StockRoomInventory.updateOne({ _id: row._id }, { $inc: { quantity: -moved } });
        await creditRoom({ product, room: toRoom, quantity: moved });

        await recordMovement({
          product,
          type: "TRANSFER",
          direction: "NONE",
          quantity: moved,
          reference: product.code,
          performedBy: req.user._id,
          note: `Home room changed: ${moved} moved ${previousRoom} → ${product.storeRoom}`,
        });
      }
    }

    // An explicit total is applied as a delta against the home room.
    if (quantity !== undefined && quantity !== null) {
      const target = Number(quantity);
      if (!Number.isInteger(target) || target < 0) {
        return res
          .status(400)
          .json({ message: "Quantity must be a whole number of 0 or more" });
      }

      const delta = target - product.quantity;
      if (delta > 0) {
        await creditRoom({ product, room: product.storeRoom, quantity: delta });
      } else if (delta < 0) {
        await debitAcrossRooms({
          product,
          preferredRoom: product.storeRoom,
          quantity: Math.abs(delta),
        });
      }

      if (delta !== 0) {
        await recordMovement({
          product,
          type: delta > 0 ? "STOCK_IN" : "STOCK_OUT",
          direction: delta > 0 ? "IN" : "OUT",
          quantity: Math.abs(delta),
          reference: product.code,
          performedBy: req.user._id,
          note: `Adjusted by ${req.user.name} from the catalog`,
        });
      }
    }

    if (product.quantity <= product.minStock) {
      await Notification.create({
        message: `Alert: "${product.name}" is at or below minimum stock (${product.quantity} ${product.unit})`,
        type: "LOW_STOCK",
      });
    }

    res.json(await Product.findById(product._id));
  } catch (error) {
    console.error("Error updating product:", error);
    res.status(500).json({ message: error.message });
  }
};

// @desc    Delete a product and its per-room rows
// @route   DELETE /api/products/:id
// @access  Private (Admin)
export const deleteProduct = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    // History (issues, movements, past requests) snapshots the name and code,
    // so those records stay readable after the product is gone.
    await StockRoomInventory.deleteMany({ product: product._id });
    await Product.deleteOne({ _id: product._id });

    await Notification.create({
      message: `Product "${product.name}" (${product.code}) was deleted by ${req.user.name}`,
      type: "REQUEST_REJECTED",
    });

    res.json({ message: `"${product.name}" has been deleted`, id: product._id });
  } catch (error) {
    console.error("Error deleting product:", error);
    res.status(500).json({ message: error.message });
  }
};

// @desc    Per-room breakdown for one product
// @route   GET /api/products/:id/rooms
// @access  Private
export const getProductRooms = async (req, res) => {
  try {
    res.json(await roomBreakdownFor(req.params.id));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
