import Product from "../models/Product.js";
import StockRoomInventory from "../models/StockRoomInventory.js";
import Notification from "../models/Notification.js";
import { recordMovement } from "../utils/stockLedger.js";
import {
  creditRoom,
  debitAcrossRooms,
  homeRoomFor,
  resolveRoom,
  roomBreakdownFor,
} from "../utils/stockRooms.js";
import { composeItemName, resolveItemName } from "../utils/itemNaming.js";
import { findSimilarProducts } from "../utils/duplicateCheck.js";
import {
  getCatalogItem,
  listUnits,
  retireCatalogItem,
  listCatalog,
  listCategories,
  listSubCategories,
} from "../repository/catalog.js";
import { scopeFor } from "../repository/plantScope.js";
import { maySee } from "../config/access.js";

// @desc    Get all products with search and filtering
// @route   GET /api/products
// @access  Private (Manager, Maintenance Manager, Supervisor)
//
// Reads ERPNext, not MongoDB. The shape is unchanged, so the screens did not
// have to be touched — but the numbers are now Bin's, which means the catalog
// and ERPNext's own Stock Balance report cannot drift apart.
export const getProducts = async (req, res) => {
  try {
    const { search, category, subCategory, storeRoom, stockStatus } = req.query;

    // The catalog and Low Stock are one endpoint told apart by a query
    // parameter, and they have different audiences. Checked here rather than
    // on the route, because guarding the route with the narrower of the two
    // would take the catalog away from everybody who only has that.
    if (stockStatus === "low" && !maySee(req.user.role, "lowStock")) {
      return res.status(403).json({
        message: `Role (${req.user.role}) is not allowed to access this resource`,
      });
    }

    // A plant head sees their own site's shelves and nothing else. Read from
    // the signed-in user rather than taken from the query, so narrowing it is
    // not something a caller can decline to do.
    const { stores } = await scopeFor(req.user);

    res.json(
      await listCatalog({
        search,
        category,
        subCategory,
        storeRoom,
        onlyRooms: stores,
        stockStatus,
      })
    );
  } catch (error) {
    res.status(error.status === 403 ? 403 : 502).json({
      message: `Could not read the catalog from ERPNext: ${error.message}`,
    });
  }
};

// @desc    Get one product by its item code
// @route   GET /api/products/:id
// @access  Private
export const getProductById = async (req, res) => {
  try {
    const { stores } = await scopeFor(req.user);
    const product = await getCatalogItem(req.params.id, { onlyRooms: stores });

    // "Not found" rather than "not allowed" on purpose: to a plant head an
    // item their site does not hold is not in their catalog at all, and a 403
    // would confirm the code exists to somebody who cannot see it.
    if (!product) return res.status(404).json({ message: "Engineering Stock not found" });
    res.json(product);
  } catch (error) {
    res.status(502).json({ message: `Could not read the item from ERPNext: ${error.message}` });
  }
};

// @desc    Categories in use
// @route   GET /api/products/categories
// @access  Private
export const getCategories = async (req, res) => {
  try {
    res.json(await listCategories());
  } catch (error) {
    res.status(502).json({ message: `Could not read categories from ERPNext: ${error.message}` });
  }
};

// @desc    Sub-categories in use, optionally narrowed to one category
// @route   GET /api/products/subcategories?category=Tools
// @access  Private
export const getSubCategories = async (req, res) => {
  try {
    res.json(await listSubCategories(req.query.category || ""));
  } catch (error) {
    res.status(502).json({
      message: `Could not read sub-categories from ERPNext: ${error.message}`,
    });
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
  ["Audit Frequency", (p) => p.auditFrequency || "Monthly"],
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
  "auditFrequency",
  "description",
  "image",
];

// @desc    The units ERPNext holds, for the unit picker
// @route   GET /api/products/units
// @access  Private
export const getUnits = async (_req, res) => {
  try {
    res.json(await listUnits());
  } catch (error) {
    res.status(502).json({ message: `Could not read units from ERPNext: ${error.message}` });
  }
};

// @desc    Adding an item is not a direct action any more
// @route   POST /api/products
//
// An item entering the catalog is what every issue slip, every audit and
// eventually SAP will refer to the thing by, so it goes through a named
// proposal and an approval rather than a form anybody can submit. This used to
// create the item outright, which meant a name reached the catalog - and would
// have reached SAP - with nobody having agreed to it.
export const createProduct = async (_req, res) =>
  res.status(405).json({
    message:
      "Items are added by raising a naming request, which the Manager approves. " +
      "Raise one from Request Control.",
    raiseAt: "/api/naming-requests",
  });

/**
 * @desc    Retire an item
 * @route   DELETE /api/products/:id
 *
 * "Delete" is the wrong word and the screen should stop using it. ERPNext
 * refuses to delete an Item that any stock document has ever referenced - even
 * a cancelled one - and tells you to disable it instead. So the item is taken
 * out of the catalog and its balance zeroed, which is what deleting was
 * understood to mean, but the ledger it took part in stays intact.
 */
export const deleteProduct = async (req, res) => {
  try {
    const result = await retireCatalogItem(req.params.id);
    res.json(result);
  } catch (error) {
    if (error.status === 403) {
      return res.status(403).json({ message: "Your ERPNext role does not allow that." });
    }
    res.status(error.status ? 400 : 500).json({ message: error.message });
  }
};

export const updateProduct = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ message: "Engineering Stock not found" });
    }

    const { code, quantity, storeRoom, acknowledgeNaming = false, allowDuplicate = false } =
      req.body;

    // A supervisor's edit changes the item's details, never how much of it
    // there is: stock is added through Add Stock (POST /api/products/:id/stock-in),
    // which credits one named room rather than assigning a new total. A payload
    // that merely echoes the current total is let through, so a form that posts
    // every field it rendered is not treated as an adjustment.
    const setsQuantity = quantity !== undefined && quantity !== null;
    if (
      req.user.role !== "Admin" &&
      setsQuantity &&
      Number(quantity) !== product.quantity
    ) {
      return res.status(403).json({
        message:
          "Quantity cannot be changed from an edit — use Add Stock instead",
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

// Reference for a direct addition. Stock coming in used to carry the number of
// the request that brought it (`REQ-IN-…`); with no request in the way, the
// ledger row still needs something to quote.
const generateAdditionNumber = () => `ADD-${Math.floor(100000 + Math.random() * 900000)}`;

// @desc    Add stock to a product. Applies immediately — no Admin approval.
// @route   POST /api/products/:id/stock-in
// @access  Private (Admin, Supervisor)
//
// Stock arriving used to be the one movement a supervisor could not make
// alone. It is now direct, like issuing and scrapping: exactly one room is
// credited, chosen here rather than by an Admin at approval time.
export const addStock = async (req, res) => {
  try {
    const { quantity, stockRoomId, note } = req.body;

    const reason = typeof note === "string" ? note.trim() : "";
    const qty = Number(quantity);
    if (!Number.isInteger(qty) || qty < 1) {
      return res
        .status(400)
        .json({ message: "Quantity must be a whole number of at least 1" });
    }

    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ message: "Engineering Stock not found" });
    }

    // The named room, or the product's own when the caller did not pick one.
    const targetRoom =
      (stockRoomId ? await resolveRoom(stockRoomId) : null) ||
      (await homeRoomFor(product));
    if (!targetRoom) {
      return res.status(400).json({ message: "Select a stock room to add the stock to" });
    }

    // Credits exactly one room, and recomputes the product total from the room
    // rows — the same path every other stock change goes through.
    const reference = generateAdditionNumber();
    const { roomQuantity } = await creditRoom({
      product,
      room: targetRoom,
      quantity: qty,
    });

    await recordMovement({
      product,
      type: "STOCK_IN",
      direction: "IN",
      quantity: qty,
      reference,
      performedBy: req.user._id,
      toRoom: targetRoom.name,
      note: reason || `Added by ${req.user.name} into ${targetRoom.name} (room now ${roomQuantity})`,
    });

    // The addition may not have cleared the threshold, and the Admin is told
    // either way by the same alert the rest of the app raises.
    if (product.quantity <= product.minStock) {
      await Notification.create({
        message: `Alert: "${product.name}" remains at or below minimum stock (${product.quantity} ${product.unit} total)`,
        type: "LOW_STOCK",
      });
    }

    res.status(201).json({
      message: `${qty} ${product.unit} added to ${targetRoom.name}`,
      reference,
      room: targetRoom.name,
      roomQuantity,
      product: await Product.findById(product._id),
    });
  } catch (error) {
    console.error("Error adding stock:", error);
    res.status(500).json({ message: error.message });
  }
};

export const getProductRooms = async (req, res) => {
  try {
    const product = await getCatalogItem(req.params.id);
    if (!product) return res.status(404).json({ message: "Engineering Stock not found" });

    // Red Stock is listed alongside the stores rather than folded into them.
    // It is real stock on the books, but it is not on a shelf anybody issues
    // from, and showing it as store stock would promise more than is there.
    res.json([
      ...product.rooms,
      ...(product.redStock > 0 ? [{ room: "Red Stock Room", quantity: product.redStock }] : []),
    ]);
  } catch (error) {
    res.status(502).json({ message: `Could not read stock from ERPNext: ${error.message}` });
  }
};
