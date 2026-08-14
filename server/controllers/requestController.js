import ProductRequest from "../models/ProductRequest.js";
import StockInRequest from "../models/StockInRequest.js";
import StockOutRequest from "../models/StockOutRequest.js";
import StockReturnRequest from "../models/StockReturnRequest.js";
import RestockItem from "../models/RestockItem.js";
import Product from "../models/Product.js";
import Notification from "../models/Notification.js";
import { recordMovement } from "../utils/stockLedger.js";
import {
  creditRoom,
  debitAcrossRooms,
  resolveRoom,
  homeRoomFor,
} from "../utils/stockRooms.js";

// Helper to generate unique request numbers
const generateRequestNumber = (prefix) => {
  const randomStr = Math.floor(100000 + Math.random() * 900000); // 6 digit random number
  return `${prefix}-${randomStr}`;
};

/**
 * Records who decided a request and when, for the schemas that carry an audit
 * trail. Older request types have no such fields and are left untouched.
 */
const stampDecision = (request, { adminId, approved }) => {
  const has = (path) => Boolean(request.schema.path(path));
  if (has("admin")) request.admin = adminId;
  if (approved && has("approvedAt")) request.approvedAt = new Date();
  if (!approved && has("rejectedAt")) request.rejectedAt = new Date();
};

// ==========================================
// SUPERVISOR: Create Requests
// ==========================================

// Create ADD or EDIT Product Request
export const createProductRequest = async (req, res) => {
  const { requestType, productId, details } = req.body;
  const supervisorId = req.user._id;

  try {
    if (!requestType || !["ADD", "EDIT"].includes(requestType)) {
      return res.status(400).json({ message: "Invalid request type (must be ADD or EDIT)" });
    }

    let productCode = details.code;
    if (requestType === "ADD") {
      // Auto-generate product code if not provided
      if (!productCode) {
        productCode = `PRD-${Math.floor(100000 + Math.random() * 900000)}`;
      }
      // Check if product code already exists in active products or pending ADD requests
      const codeExists = await Product.findOne({ code: productCode });
      if (codeExists) {
        return res.status(400).json({ message: `Product code ${productCode} already exists in catalog` });
      }
    }

    if (requestType === "EDIT") {
      if (!productId) {
        return res.status(400).json({ message: "Product ID is required for edit requests" });
      }
      const productExists = await Product.findById(productId);
      if (!productExists) {
        return res.status(404).json({ message: "Product not found" });
      }
      productCode = productExists.code;
    }

    const requestNumber = generateRequestNumber(requestType === "ADD" ? "REQ-ADD" : "REQ-EDT");

    const newRequest = await ProductRequest.create({
      requestNumber,
      requestType,
      product: requestType === "EDIT" ? productId : undefined,
      details: {
        ...details,
        code: productCode,
      },
      supervisor: supervisorId,
    });

    // Notify admins
    await Notification.create({
      message: `New product request (${requestNumber}) submitted by supervisor ${req.user.name}`,
      type: "REQUEST_CREATED",
    });

    res.status(201).json(newRequest);
  } catch (error) {
    console.error("Error creating product request:", error);
    res.status(500).json({ message: error.message });
  }
};

// Create Stock In Request
export const createStockInRequest = async (req, res) => {
  const { productId, quantity, stockRoomId } = req.body;
  const supervisorId = req.user._id;

  try {
    if (!productId || !quantity || quantity < 1) {
      return res.status(400).json({ message: "Valid Product ID and Quantity (>= 1) are required" });
    }

    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    // Advisory only: the Admin picks the room that is actually credited.
    const requestedRoom = stockRoomId ? await resolveRoom(stockRoomId) : null;

    const requestNumber = generateRequestNumber("REQ-IN");

    const newRequest = await StockInRequest.create({
      requestNumber,
      product: productId,
      quantity,
      requestedStockRoom: requestedRoom?._id || null,
      stockAtRequest: product.quantity,
      supervisor: supervisorId,
    });

    // Notify admins
    await Notification.create({
      message: `New Stock In request (${requestNumber}) for "${product.name}" (Qty: ${quantity}) by ${req.user.name}`,
      type: "REQUEST_CREATED",
    });

    res.status(201).json(newRequest);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Create Stock Out Request
export const createStockOutRequest = async (req, res) => {
  const { productId, quantity } = req.body;
  const supervisorId = req.user._id;

  try {
    if (!productId || !quantity || quantity < 1) {
      return res.status(400).json({ message: "Valid Product ID and Quantity (>= 1) are required" });
    }

    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    // Check if enough stock exists currently (warn Supervisor, but enforce on approval)
    if (product.quantity < quantity) {
      return res.status(400).json({
        message: `Insufficient stock. Requested: ${quantity}, Available: ${product.quantity}`,
      });
    }

    const requestNumber = generateRequestNumber("REQ-OUT");

    const newRequest = await StockOutRequest.create({
      requestNumber,
      product: productId,
      quantity,
      supervisor: supervisorId,
    });

    // Notify admins
    await Notification.create({
      message: `New Stock Out request (${requestNumber}) for "${product.name}" (Qty: ${quantity}) by ${req.user.name}`,
      type: "REQUEST_CREATED",
    });

    res.status(201).json(newRequest);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Create Stock Return Request
export const createStockReturnRequest = async (req, res) => {
  const { productId, quantity } = req.body;
  const supervisorId = req.user._id;

  try {
    if (!productId || !quantity || quantity < 1) {
      return res.status(400).json({ message: "Valid Product ID and Quantity (>= 1) are required" });
    }

    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    const requestNumber = generateRequestNumber("REQ-RET");

    const newRequest = await StockReturnRequest.create({
      requestNumber,
      product: productId,
      quantity,
      supervisor: supervisorId,
    });

    // Notify admins
    await Notification.create({
      message: `New Stock Return request (${requestNumber}) for "${product.name}" (Qty: ${quantity}) by ${req.user.name}`,
      type: "REQUEST_CREATED",
    });

    res.status(201).json(newRequest);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ==========================================
// SUPERVISOR: Edit / Cancel own pending requests
// ==========================================

/** Maps the `rawType` used in URLs to its model. */
const MODEL_FOR_TYPE = {
  product: ProductRequest,
  stockin: StockInRequest,
  stockout: StockOutRequest,
  stockreturn: StockReturnRequest,
};

/**
 * Loads a request and checks the caller is its owner and that it is still
 * open. Returns `{ error, status }` instead of throwing so the callers can
 * respond directly.
 */
const loadOwnPendingRequest = async ({ type, id, userId }) => {
  const Model = MODEL_FOR_TYPE[type];
  if (!Model) return { status: 400, error: "Invalid request type" };

  const request = await Model.findById(id);
  if (!request) return { status: 404, error: "Request not found" };

  if (String(request.supervisor) !== String(userId)) {
    return { status: 403, error: "You can only change your own requests" };
  }
  if (request.status !== "Pending") {
    return {
      status: 400,
      error: `This request is already ${request.status} and can no longer be changed`,
    };
  }

  return { request };
};

/**
 * @desc    Edit a still-pending stock request (quantity and preferred room)
 * @route   PUT /api/requests/:type/:id
 * @access  Private (Supervisor, own requests)
 */
export const updateOwnRequest = async (req, res) => {
  const { type, id } = req.params;
  const { quantity, stockRoomId } = req.body;

  try {
    if (type === "product") {
      return res
        .status(400)
        .json({ message: "Product requests cannot be edited — cancel and raise a new one" });
    }

    const { request, error, status } = await loadOwnPendingRequest({
      type,
      id,
      userId: req.user._id,
    });
    if (error) return res.status(status).json({ message: error });

    if (quantity !== undefined && quantity !== null) {
      const qty = Number(quantity);
      if (!Number.isInteger(qty) || qty < 1) {
        return res.status(400).json({ message: "Quantity must be a whole number of at least 1" });
      }

      // A stock out cannot ask for more than exists.
      if (type === "stockout") {
        const product = await Product.findById(request.product);
        if (product && product.quantity < qty) {
          return res.status(400).json({
            message: `Insufficient stock. Requested: ${qty}, Available: ${product.quantity}`,
          });
        }
      }

      request.quantity = qty;
    }

    // Only the stock-in request records a preferred room.
    if (stockRoomId !== undefined && request.schema.path("requestedStockRoom")) {
      const room = stockRoomId ? await resolveRoom(stockRoomId) : null;
      request.requestedStockRoom = room?._id || null;
    }

    await request.save();

    await Notification.create({
      message: `${req.user.name} updated request ${request.requestNumber} (now ${request.quantity} pcs)`,
      type: "REQUEST_CREATED",
    });

    res.json({ message: `Request ${request.requestNumber} updated`, request });
  } catch (error) {
    console.error("Error updating request:", error);
    res.status(500).json({ message: error.message });
  }
};

/**
 * @desc    Cancel a still-pending request. The row is kept so the Admin sees
 *          the cancellation rather than the request silently disappearing.
 * @route   DELETE /api/requests/:type/:id
 * @access  Private (Supervisor, own requests)
 */
export const cancelOwnRequest = async (req, res) => {
  const { type, id } = req.params;

  try {
    const { request, error, status } = await loadOwnPendingRequest({
      type,
      id,
      userId: req.user._id,
    });
    if (error) return res.status(status).json({ message: error });

    request.status = "Cancelled";
    request.adminComments = `Cancelled by ${req.user.name}`;
    await request.save();

    await Notification.create({
      message: `${req.user.name} cancelled request ${request.requestNumber}`,
      type: "REQUEST_REJECTED",
    });

    res.json({ message: `Request ${request.requestNumber} cancelled`, request });
  } catch (error) {
    console.error("Error cancelling request:", error);
    res.status(500).json({ message: error.message });
  }
};

// ==========================================
// READ: The request queue a Supervisor sees
// ==========================================

/** Who raised a request, and whether the caller may still act on it. */
const raisedBy = (request, callerId) => ({
  supervisorId: request.supervisor?._id || request.supervisor || null,
  supervisorName: request.supervisor?.name || "Unknown",
  isMine:
    String(request.supervisor?._id || request.supervisor) === String(callerId),
});

/**
 * When the Admin closed it. Only the stock-in request stamps its own decision
 * timestamps, so the rest fall back to the save that changed the status.
 */
const decidedAtOf = (request) =>
  request.approvedAt ||
  request.rejectedAt ||
  (request.status !== "Pending" ? request.updatedAt : null);

/**
 * @desc    Every supervisor's requests, newest first — what was asked for,
 *          by whom, when, and how the Admin decided. `?scope=mine` narrows it
 *          to the caller's own.
 * @route   GET /api/requests/myrequests?scope=all|mine
 * @access  Private (Supervisor)
 *
 * The supervisors run one store between them, so they read the same queue.
 * `isMine` is only what the UI hides its Edit and Cancel buttons behind —
 * ownership is enforced in `loadOwnPendingRequest`, not by this flag.
 */
export const getMyRequests = async (req, res) => {
  try {
    const supervisorId = req.user._id;
    const filter = req.query.scope === "mine" ? { supervisor: supervisorId } : {};

    // Fetch from all four tables
    const [prodReqs, inReqs, outReqs, retReqs] = await Promise.all([
      ProductRequest.find(filter)
        .populate("product", "name")
        .populate("supervisor", "name email role"),
      StockInRequest.find(filter)
        .populate("product", "name code unit image storeRoom")
        .populate("supervisor", "name email role")
        .populate("stockRoom", "name")
        .populate("requestedStockRoom", "name")
        .populate("admin", "name email role"),
      StockOutRequest.find(filter)
        .populate("product", "name")
        .populate("supervisor", "name email role"),
      StockReturnRequest.find(filter)
        .populate("product", "name")
        .populate("supervisor", "name email role"),
    ]);

    // Map into standard structure
    const allRequests = [
      ...prodReqs.map((r) => ({
        _id: r._id,
        requestNumber: r.requestNumber,
        requestType: r.requestType === "ADD" ? "Add Product" : "Edit Product",
        productName: r.requestType === "ADD" ? r.details.name : (r.product ? r.product.name : r.details.name),
        createdDate: r.createdAt,
        status: r.status,
        adminComments: r.adminComments,
        decidedAt: decidedAtOf(r),
        ...raisedBy(r, supervisorId),
        rawType: "product",
      })),
      ...inReqs.map((r) => ({
        _id: r._id,
        requestNumber: r.requestNumber,
        requestType: "Stock In",
        product: r.product,
        productName: r.product ? r.product.name : "Unknown Product",
        quantity: r.quantity,
        stockAtRequest: r.stockAtRequest,
        requestedStockRoom: r.requestedStockRoom?.name || "",
        createdDate: r.createdAt,
        status: r.status,
        adminComments: r.adminComments,
        // Decision detail, so the Requests tab can show where the stock
        // landed and who approved it.
        approvedQuantity: r.approvedQuantity,
        stockRoom: r.stockRoom?.name || "",
        decidedBy: r.admin?.name || "",
        approvedAt: r.approvedAt,
        rejectedAt: r.rejectedAt,
        decidedAt: decidedAtOf(r),
        ...raisedBy(r, supervisorId),
        rawType: "stockin",
      })),
      ...outReqs.map((r) => ({
        _id: r._id,
        requestNumber: r.requestNumber,
        requestType: "Stock Out",
        productName: r.product ? r.product.name : "Unknown Product",
        quantity: r.quantity,
        createdDate: r.createdAt,
        status: r.status,
        adminComments: r.adminComments,
        decidedAt: decidedAtOf(r),
        ...raisedBy(r, supervisorId),
        rawType: "stockout",
      })),
      ...retReqs.map((r) => ({
        _id: r._id,
        requestNumber: r.requestNumber,
        requestType: "Stock Return",
        productName: r.product ? r.product.name : "Unknown Product",
        quantity: r.quantity,
        createdDate: r.createdAt,
        status: r.status,
        adminComments: r.adminComments,
        decidedAt: decidedAtOf(r),
        ...raisedBy(r, supervisorId),
        rawType: "stockreturn",
      })),
    ];

    // Sort by date descending
    allRequests.sort((a, b) => new Date(b.createdDate) - new Date(a.createdDate));

    res.json(allRequests);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ==========================================
// ADMIN: Fetch Requests
// ==========================================
export const getAllRequests = async (req, res) => {
  try {
    const [prodReqs, inReqs, outReqs, retReqs] = await Promise.all([
      ProductRequest.find().populate("product").populate("supervisor", "name email role"),
      StockInRequest.find()
        .populate("product")
        .populate("supervisor", "name email role")
        .populate("stockRoom", "name")
        .populate("requestedStockRoom", "name")
        .populate("admin", "name email role"),
      StockOutRequest.find().populate("product").populate("supervisor", "name email role"),
      StockReturnRequest.find().populate("product").populate("supervisor", "name email role"),
    ]);

    const allRequests = [
      ...prodReqs.map((r) => ({
        _id: r._id,
        requestNumber: r.requestNumber,
        requestType: r.requestType === "ADD" ? "Add Product" : "Edit Product",
        product: r.product,
        details: r.details,
        createdDate: r.createdAt,
        status: r.status,
        adminComments: r.adminComments,
        supervisor: r.supervisor,
        rawType: "product",
      })),
      ...inReqs.map((r) => ({
        _id: r._id,
        requestNumber: r.requestNumber,
        requestType: "Stock In",
        product: r.product,
        quantity: r.quantity,
        stockAtRequest: r.stockAtRequest,
        requestedStockRoom: r.requestedStockRoom,
        createdDate: r.createdAt,
        status: r.status,
        adminComments: r.adminComments,
        supervisor: r.supervisor,
        approvedQuantity: r.approvedQuantity,
        stockRoom: r.stockRoom,
        admin: r.admin,
        approvedAt: r.approvedAt,
        rejectedAt: r.rejectedAt,
        rawType: "stockin",
      })),
      ...outReqs.map((r) => ({
        _id: r._id,
        requestNumber: r.requestNumber,
        requestType: "Stock Out",
        product: r.product,
        quantity: r.quantity,
        createdDate: r.createdAt,
        status: r.status,
        adminComments: r.adminComments,
        supervisor: r.supervisor,
        rawType: "stockout",
      })),
      ...retReqs.map((r) => ({
        _id: r._id,
        requestNumber: r.requestNumber,
        requestType: "Stock Return",
        product: r.product,
        quantity: r.quantity,
        createdDate: r.createdAt,
        status: r.status,
        adminComments: r.adminComments,
        supervisor: r.supervisor,
        rawType: "stockreturn",
      })),
    ];

    allRequests.sort((a, b) => new Date(b.createdDate) - new Date(a.createdDate));
    res.json(allRequests);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ==========================================
// ADMIN: Approval / Rejection Logic
// ==========================================
export const processRequest = async (req, res) => {
  const { type, id, action } = req.params; // type: product, stockin, stockout, stockreturn. action: approve, reject, keep-pending
  // `stockRoomId` names the room to credit/debit; `approvedQuantity` lets the
  // Admin approve less than was asked for.
  const { adminComments, stockRoomId, approvedQuantity } = req.body;

  try {
    if (!["approve", "reject", "keep-pending"].includes(action)) {
      return res.status(400).json({ message: "Invalid action. Must be approve, reject, or keep-pending" });
    }

    let request;
    let newStatus = "Pending";
    if (action === "approve") newStatus = "Approved";
    if (action === "reject") newStatus = "Rejected";

    // 1. Find the request based on type
    if (type === "product") {
      request = await ProductRequest.findById(id);
    } else if (type === "stockin") {
      request = await StockInRequest.findById(id);
    } else if (type === "stockout") {
      request = await StockOutRequest.findById(id);
    } else if (type === "stockreturn") {
      request = await StockReturnRequest.findById(id);
    } else {
      return res.status(400).json({ message: "Invalid request collection type" });
    }

    if (!request) {
      return res.status(404).json({ message: "Request not found" });
    }

    if (request.status !== "Pending" && action !== "keep-pending") {
      return res.status(400).json({ message: `Request is already ${request.status}` });
    }

    // 2. If action is keep-pending, just update comments and keep it pending
    if (action === "keep-pending") {
      request.adminComments = adminComments || "";
      request.status = "Pending";
      await request.save();
      return res.json({ message: "Request set to pending with updated comments", request });
    }

    // 3. Reject Logic — no stock moves, no room balance changes.
    if (action === "reject") {
      request.status = "Rejected";
      request.adminComments = adminComments || "Rejected by administrator";
      stampDecision(request, { adminId: req.user._id, approved: false });
      await request.save();

      // Notify supervisor
      await Notification.create({
        user: request.supervisor,
        message: `Your request (${request.requestNumber}) was rejected: "${request.adminComments}"`,
        type: "REQUEST_REJECTED",
      });

      return res.json({ message: "Request has been rejected", request });
    }

    // 4. Approve Logic (action === "approve")
    if (type === "product") {
      if (request.requestType === "ADD") {
        // Create Product in collection
        const { code, name, category, brand, supplier, quantity, unit, minStock, maxStock, storeRoom, description, image } = request.details;
        
        // Double check uniqueness of code
        const codeExists = await Product.findOne({ code });
        if (codeExists) {
          return res.status(400).json({ message: `Cannot approve. Product code ${code} is already taken.` });
        }

        // Created empty, then credited so the room row and the product total
        // are written by the same path as every other stock movement.
        const newProduct = await Product.create({
          code,
          name,
          category,
          brand,
          supplier,
          quantity: 0,
          unit,
          minStock,
          maxStock,
          storeRoom,
          description,
          image,
        });

        if (quantity > 0) {
          await creditRoom({ product: newProduct, room: storeRoom, quantity });
        }

        // Set the reference to the newly created product in the request for trace
        request.product = newProduct._id;

        await recordMovement({
          product: newProduct,
          type: "PRODUCT_CREATED",
          direction: newProduct.quantity > 0 ? "IN" : "NONE",
          quantity: newProduct.quantity,
          reference: request.requestNumber,
          performedBy: req.user._id,
          note: `Opening quantity from an approved ADD request (${storeRoom})`,
        });
      } else if (request.requestType === "EDIT") {
        // Update product details
        const product = await Product.findById(request.product);
        if (!product) {
          return res.status(404).json({ message: "Target product no longer exists" });
        }

        const { name, category, brand, supplier, quantity, unit, minStock, maxStock, storeRoom, description, image } = request.details;

        const quantityBefore = product.quantity;

        product.name = name;
        product.category = category;
        product.brand = brand;
        product.supplier = supplier;
        product.unit = unit;
        product.minStock = minStock;
        product.maxStock = maxStock;
        product.storeRoom = storeRoom;
        product.description = description;
        product.image = image;

        await product.save();

        // A quantity edit is applied to the home room rather than assigned to
        // the total, so the room rows stay the source of truth.
        const delta = quantity - quantityBefore;
        if (delta > 0) {
          await creditRoom({ product, room: storeRoom, quantity: delta });
        } else if (delta < 0) {
          await debitAcrossRooms({
            product,
            preferredRoom: storeRoom,
            quantity: Math.abs(delta),
          });
        }
        await recordMovement({
          product,
          type: "PRODUCT_EDITED",
          direction: delta === 0 ? "NONE" : delta > 0 ? "IN" : "OUT",
          quantity: Math.abs(delta),
          reference: request.requestNumber,
          performedBy: req.user._id,
          note: "Approved EDIT request",
        });
      }
    } else if (type === "stockin") {
      const product = await Product.findById(request.product);
      if (!product) {
        return res.status(404).json({ message: "Product no longer exists" });
      }

      // The Admin's choice wins; fall back to what the supervisor asked for,
      // then to the product's home room.
      const targetRoom =
        (stockRoomId ? await resolveRoom(stockRoomId) : null) ||
        (request.requestedStockRoom ? await resolveRoom(request.requestedStockRoom) : null) ||
        (await homeRoomFor(product));

      if (!targetRoom) {
        return res.status(400).json({ message: "Select a stock room to credit" });
      }

      const credited =
        approvedQuantity === undefined || approvedQuantity === null
          ? request.quantity
          : Number(approvedQuantity);

      if (!Number.isInteger(credited) || credited < 1) {
        return res
          .status(400)
          .json({ message: "Approved quantity must be a whole number of at least 1" });
      }
      if (credited > request.quantity) {
        return res.status(400).json({
          message: `Cannot approve ${credited}; only ${request.quantity} was requested`,
        });
      }

      // Credits exactly one room — never every room.
      const { roomQuantity } = await creditRoom({
        product,
        room: targetRoom,
        quantity: credited,
      });

      request.approvedQuantity = credited;
      request.stockRoom = targetRoom._id;

      await recordMovement({
        product,
        type: "STOCK_IN",
        direction: "IN",
        quantity: credited,
        reference: request.requestNumber,
        performedBy: req.user._id,
        note: `Approved Stock In request into ${targetRoom.name} (room now ${roomQuantity})`,
      });

      // Check for low stock notification clearance or trigger
      if (product.quantity <= product.minStock) {
        await Notification.create({
          message: `Alert: "${product.name}" remains below minimum stock (${product.quantity} ${product.unit} total)`,
          type: "LOW_STOCK",
        });
      }
    } else if (type === "stockout") {
      const product = await Product.findById(request.product);
      if (!product) {
        return res.status(404).json({ message: "Product no longer exists" });
      }
      if (product.quantity < request.quantity) {
        return res.status(400).json({
          message: `Cannot approve stock out. Current stock is ${product.quantity}, but requested ${request.quantity}`,
        });
      }

      // Drains the chosen room first, then the fullest others.
      const { drawn } = await debitAcrossRooms({
        product,
        preferredRoom: stockRoomId || product.storeRoom,
        quantity: request.quantity,
      });

      await recordMovement({
        product,
        type: "STOCK_OUT",
        direction: "OUT",
        quantity: request.quantity,
        reference: request.requestNumber,
        performedBy: req.user._id,
        note: `Approved Stock Out request from ${drawn
          .map((entry) => `${entry.room} (${entry.quantity})`)
          .join(", ")}`,
      });

      // Low Stock Alert
      if (product.quantity <= product.minStock) {
        await Notification.create({
          message: `Alert: "${product.name}" has hit low stock (${product.quantity} ${product.unit} total)`,
          type: "LOW_STOCK",
        });
      }
    } else if (type === "stockreturn") {
      const product = await Product.findById(request.product);
      if (!product) {
        return res.status(404).json({ message: "Product no longer exists" });
      }

      // Returned stock never lands in a store room directly, whichever door it
      // came through: it joins the Red Stock Room and waits for the weekly
      // merge, exactly like a return raised from an issue.
      const restockItem = await RestockItem.create({
        restockNumber: `RT-${Math.floor(100000 + Math.random() * 900000)}`,
        product: product._id,
        productName: product.name,
        productCode: product.code,
        unit: product.unit,
        quantity: request.quantity,
        reason: `Approved stock return request ${request.requestNumber}`,
        condition: "Good",
        returnedBy: request.supervisor,
        department: "Stock Return Request",
        returnDate: new Date(),
        sourceRoom: product.storeRoom || "",
        status: "In Red Stock",
      });

      await recordMovement({
        product,
        type: "RETURN_TO_RED_STOCK",
        direction: "NONE",
        quantity: request.quantity,
        reference: request.requestNumber,
        performedBy: req.user._id,
        note: `Approved Stock Return request into Red Stock (${restockItem.restockNumber}); awaiting the weekly merge`,
        toRoom: "Red Stock Room",
      });
    }

    // Save approved request status
    request.status = "Approved";
    request.adminComments = adminComments || "Approved by administrator";
    stampDecision(request, { adminId: req.user._id, approved: true });
    await request.save();

    // Notify supervisor
    await Notification.create({
      user: request.supervisor,
      message: `Your request (${request.requestNumber}) has been approved!`,
      type: "REQUEST_APPROVED",
    });

    res.json({ message: "Request approved successfully", request });
  } catch (error) {
    console.error("Error processing request approval:", error);
    res.status(500).json({ message: error.message });
  }
};
