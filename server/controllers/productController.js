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
import { composeItemName, resolveItemName } from "../utils/itemNaming.js";
import { findSimilarProducts } from "../utils/duplicateCheck.js";

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
      res.status(404).json({ message: "Engineering Stock not found" });
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
// INTAKE: naming, duplicates and the SAP hand-off
//
// The three checks that sit in front of "Add New Item". None of them writes
// anything — they answer a question the form asks while it is being filled in,
// and the same checks run again for real inside createProduct.
// ==========================================

// @desc    Build the SOI1/SOP1 name from the captured fields, and validate it
// @route   POST /api/products/name-preview
// @access  Private (Admin, Supervisor)
//
// Both clients call this as the form is typed rather than reimplementing the
// convention. Sending `name` validates that name as-is; sending only `naming`
// composes one from the parts.
export const previewItemName = async (req, res) => {
  try {
    const { name, naming } = req.body || {};

    // A typed name is checked as it stands; with no name, the parts are
    // composed into one. `resolveItemName` picks between them the same way the
    // save path does, so the preview cannot disagree with the outcome.
    const result = name === undefined ? composeItemName(naming || {}) : resolveItemName({ name, naming });

    res.json({
      name: result.name,
      naming: result.naming,
      compliant: result.compliant,
      issues: result.issues,
    });
  } catch (error) {
    console.error("Error previewing item name:", error);
    res.status(500).json({ message: error.message });
  }
};

// @desc    Products that look like the one being created (ST-14)
// @route   GET /api/products/duplicates?name=&code=&brand=&category=&excludeId=
// @access  Private (Admin, Supervisor)
export const checkDuplicates = async (req, res) => {
  try {
    const { name = "", code = "", brand = "", category = "", excludeId = "" } = req.query;

    const matches = await findSimilarProducts({
      name,
      code,
      brand,
      category,
      excludeId: excludeId || null,
    });

    res.json({
      matches,
      // An exact hit is the store almost certainly re-entering something it
      // already owns, and is what createProduct refuses without an override.
      blocking: matches.some((match) => match.exact),
    });
  } catch (error) {
    console.error("Error checking for duplicate products:", error);
    res.status(500).json({ message: error.message });
  }
};

/** The columns the Plant Manager needs in order to create the item in SAP. */
const SAP_COLUMNS = [
  ["Product Name", (p) => p.name],
  ["Product Code", (p) => p.code],
  ["Item Code", (p) => p.naming?.itemCode || ""],
  ["Main Category", (p) => p.category],
  ["Sub-Category", (p) => p.subCategory || ""],
  ["Brand", (p) => p.brand || ""],
  ["Material", (p) => p.naming?.material || ""],
  ["UOM", (p) => p.unit],
  ["Unit Cost", (p) => p.unitCost ?? 0],
  ["Plant / Store Room", (p) => p.storeRoom],
  ["Rack", (p) => p.rackNumber || ""],
  ["Stock", (p) => p.quantity ?? 0],
  ["Added On", (p) => new Date(p.createdAt).toISOString().slice(0, 10)],
];

/** Quotes a CSV cell, doubling any quote inside it. */
const csvCell = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;

// @desc    Items named but not yet created in SAP (ST-13)
// @route   GET /api/products/sap-pending?format=csv&storeRoom=
// @access  Private (Admin, Supervisor)
//
// The hand-off report. `format=csv` returns the same rows as a download, which
// is how the list actually reaches the Plant Manager.
export const getSapPending = async (req, res) => {
  try {
    const { format, storeRoom } = req.query;

    const filter = { "sap.status": "Pending" };
    if (storeRoom) filter.storeRoom = storeRoom;

    const products = await Product.find(filter).sort({ createdAt: 1 }).lean();

    if (format === "csv") {
      const rows = [
        SAP_COLUMNS.map(([heading]) => csvCell(heading)).join(","),
        ...products.map((product) =>
          SAP_COLUMNS.map(([, read]) => csvCell(read(product))).join(","),
        ),
      ];

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="sap-pending-${new Date().toISOString().slice(0, 10)}.csv"`,
      );
      // A BOM, so Excel opens the ” and ¼ in the item names as UTF-8 instead of
      // as mojibake. Spelled as an escape rather than pasted in, so it survives
      // an editor that strips invisible characters.
      return res.send(`\uFEFF${rows.join("\r\n")}`);
    }

    res.json(products);
  } catch (error) {
    console.error("Error loading the SAP hand-off list:", error);
    res.status(500).json({ message: error.message });
  }
};

// @desc    Record what SAP did with an item (ST-13)
// @route   PUT /api/products/:id/sap
// @access  Private (Admin)
export const updateSapStatus = async (req, res) => {
  try {
    const { status, code = "", note = "" } = req.body || {};

    if (!["Pending", "Created", "Not Required"].includes(status)) {
      return res
        .status(400)
        .json({ message: "Status must be Pending, Created or Not Required" });
    }

    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ message: "Engineering Stock not found" });
    }

    product.sap = {
      status,
      code: String(code).trim(),
      note: String(note).trim(),
      // Only a real creation is stamped; moving back to Pending clears it, so
      // the date never outlives the fact it recorded.
      createdAt: status === "Created" ? new Date() : null,
      createdBy: status === "Created" ? req.user._id : null,
    };

    await product.save();

    res.json(await Product.findById(product._id));
  } catch (error) {
    console.error("Error updating SAP status:", error);
    res.status(500).json({ message: error.message });
  }
};

// ==========================================
// Direct catalog management
//
// Creating an item is Admin-only — a supervisor raises an ADD request for it.
// Editing one is not: both roles save changes here, and only the quantity is
// held back from a supervisor, because stock arrives through a Stock In
// request. Quantity is never assigned either way — it is applied through the
// stock room helpers so the per-room rows stay the source of truth.
// ==========================================

const generateProductCode = () => `PRD-${Math.floor(100000 + Math.random() * 900000)}`;

/**
 * Fields an Admin may set directly. `quantity` is handled separately, and so
 * is `name` — it goes through the naming convention rather than straight in.
 */
const EDITABLE_FIELDS = [
  "category",
  "subCategory",
  "brand",
  "status",
  "rackNumber",
  "unit",
  "minStock",
  "unitCost",
  "description",
  "image",
];

// @desc    Create a product
// @route   POST /api/products
// @access  Private (Admin)
export const createProduct = async (req, res) => {
  try {
    const {
      code,
      quantity = 0,
      storeRoom,
      name,
      naming,
      // The two intake checks below are advisory, not absolute — the store has
      // to be able to enter an item the rules did not anticipate. Each is
      // overridden by the caller confirming it, which is what "flag before
      // saving" (ST-10) means in practice.
      acknowledgeNaming = false,
      allowDuplicate = false,
      ...rest
    } = req.body;

    if (!storeRoom || !String(storeRoom).trim()) {
      return res.status(400).json({ message: "Store Room is required" });
    }

    // ST-09 / ST-10 — compose the standardized name from the captured fields
    // when none was typed, then hold it against the convention.
    const named = resolveItemName({ name, naming });
    if (!named.name) {
      return res.status(400).json({ message: "Engineering Stock name is required" });
    }
    if (!named.compliant && !acknowledgeNaming) {
      return res.status(422).json({
        code: "NAME_NOT_COMPLIANT",
        message: `"${named.name}" does not follow the SOI1/SOP1 naming convention`,
        name: named.name,
        issues: named.issues,
      });
    }

    const productCode = code?.trim() || generateProductCode();
    if (await Product.findOne({ code: productCode })) {
      return res.status(400).json({ message: `Engineering Stock code ${productCode} already exists` });
    }

    // ST-14 — say so before a second copy of an item the store already holds
    // is created.
    if (!allowDuplicate) {
      const matches = await findSimilarProducts({
        name: named.name,
        code: productCode,
        brand: rest.brand,
        category: rest.category,
      });

      if (matches.length) {
        return res.status(409).json({
          code: "POSSIBLE_DUPLICATE",
          message:
            matches.length === 1
              ? `"${matches[0].name}" is already in the catalog`
              : `${matches.length} similar items are already in the catalog`,
          matches,
          blocking: matches.some((match) => match.exact),
        });
      }
    }

    const openingQuantity = Number(quantity) || 0;
    if (openingQuantity < 0) {
      return res.status(400).json({ message: "Opening quantity cannot be negative" });
    }

    // Created empty, then credited, so the room row and the total are written
    // by the same path as every other stock movement.
    const product = await Product.create({
      ...rest,
      name: named.name,
      naming: named.naming,
      nameCompliant: named.compliant,
      code: productCode,
      storeRoom: String(storeRoom).trim(),
      quantity: 0,
      // Every item that comes in through intake owes the Plant Manager a SAP
      // record (ST-13). The imported catalog does not — see models/Product.js.
      sap: { status: "Pending" },
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
      message: `Engineering Stock "${product.name}" added to the catalog by ${req.user.name}`,
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
// @access  Private (Admin, Supervisor — quantity is Admin-only)
export const updateProduct = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ message: "Engineering Stock not found" });
    }

    const { code, quantity, storeRoom, acknowledgeNaming = false, allowDuplicate = false } =
      req.body;

    // A supervisor's edit changes the item's details, never how much of it there
    // is: stock still comes in through a Stock In request the Admin approves. A
    // payload that merely echoes the current total is let through, so a form
    // that posts every field it rendered is not treated as an adjustment.
    const setsQuantity = quantity !== undefined && quantity !== null;
    if (
      req.user.role !== "Admin" &&
      setsQuantity &&
      Number(quantity) !== product.quantity
    ) {
      return res.status(403).json({
        message:
          "Quantity cannot be changed from an edit — raise a Stock In request instead",
      });
    }

    // Product code is user-facing and must stay unique.
    if (code && code.trim() && code.trim() !== product.code) {
      if (await Product.findOne({ code: code.trim(), _id: { $ne: product._id } })) {
        return res.status(400).json({ message: `Engineering Stock code ${code.trim()} is already taken` });
      }
      product.code = code.trim();
    }

    // The name is re-derived and re-checked only when it, or the fields it is
    // built from, actually change. Editing a rack number must not stamp a
    // verdict on a name nobody touched — the imported rows stay `null`
    // ("never checked") until somebody deliberately renames them.
    const nameTouched = req.body.name !== undefined || req.body.naming !== undefined;
    if (nameTouched) {
      const named = resolveItemName({
        name: req.body.name !== undefined ? req.body.name : product.name,
        naming: req.body.naming !== undefined ? req.body.naming : product.naming,
      });

      if (!named.name) {
        return res.status(400).json({ message: "Engineering Stock name is required" });
      }

      const renamed = named.name !== product.name;

      // Only a *new* name is held to the convention. An edit that leaves the
      // name as it found it did not introduce the problem and is not the place
      // to litigate it: most of the imported catalog predates SOI1/SOP1, and
      // refusing here would mean every rack-number correction on a legacy item
      // first needed somebody to tick "save anyway" about a name they had not
      // touched. Renaming it — which is how a legacy name gets fixed — goes
      // through the check in full.
      if (!named.compliant && renamed && !acknowledgeNaming) {
        return res.status(422).json({
          code: "NAME_NOT_COMPLIANT",
          message: `"${named.name}" does not follow the SOI1/SOP1 naming convention`,
          name: named.name,
          issues: named.issues,
        });
      }

      // A rename can collide with something already on the shelf just as an
      // intake can, so it gets the same warning (ST-14).
      if (!allowDuplicate && renamed) {
        const matches = await findSimilarProducts({
          name: named.name,
          brand: req.body.brand ?? product.brand,
          category: req.body.category ?? product.category,
          excludeId: product._id,
        });

        if (matches.length) {
          return res.status(409).json({
            code: "POSSIBLE_DUPLICATE",
            message: `"${named.name}" looks like an item already in the catalog`,
            matches,
            blocking: matches.some((match) => match.exact),
          });
        }
      }

      product.name = named.name;
      if (named.naming) product.naming = named.naming;
      // The verdict is recorded only for a name this edit actually set. Leaving
      // it alone keeps `null` meaning "never checked" on the legacy rows rather
      // than quietly restating them as non-compliant.
      if (renamed) product.nameCompliant = named.compliant;
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
      return res.status(404).json({ message: "Engineering Stock not found" });
    }

    // History (issues, movements, past requests) snapshots the name and code,
    // so those records stay readable after the product is gone.
    await StockRoomInventory.deleteMany({ product: product._id });
    await Product.deleteOne({ _id: product._id });

    await Notification.create({
      message: `Engineering Stock "${product.name}" (${product.code}) was deleted by ${req.user.name}`,
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
