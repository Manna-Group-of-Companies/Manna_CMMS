import ProductRequest from "../models/ProductRequest.js";
import StockInRequest from "../models/StockInRequest.js";
import StockOutRequest from "../models/StockOutRequest.js";
import StockReturnRequest from "../models/StockReturnRequest.js";
import Product from "../models/Product.js";
import Notification from "../models/Notification.js";
import { recordMovement } from "../utils/stockLedger.js";

// Helper to generate unique request numbers
const generateRequestNumber = (prefix) => {
  const randomStr = Math.floor(100000 + Math.random() * 900000); // 6 digit random number
  return `${prefix}-${randomStr}`;
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

    const requestNumber = generateRequestNumber("REQ-IN");

    const newRequest = await StockInRequest.create({
      requestNumber,
      product: productId,
      quantity,
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
// READ: My Requests (Supervisor)
// ==========================================
export const getMyRequests = async (req, res) => {
  try {
    const supervisorId = req.user._id;

    // Fetch from all four tables
    const [prodReqs, inReqs, outReqs, retReqs] = await Promise.all([
      ProductRequest.find({ supervisor: supervisorId }).populate("product", "name"),
      StockInRequest.find({ supervisor: supervisorId }).populate("product", "name"),
      StockOutRequest.find({ supervisor: supervisorId }).populate("product", "name"),
      StockReturnRequest.find({ supervisor: supervisorId }).populate("product", "name"),
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
        rawType: "product",
      })),
      ...inReqs.map((r) => ({
        _id: r._id,
        requestNumber: r.requestNumber,
        requestType: "Stock In",
        productName: r.product ? r.product.name : "Unknown Product",
        createdDate: r.createdAt,
        status: r.status,
        adminComments: r.adminComments,
        rawType: "stockin",
      })),
      ...outReqs.map((r) => ({
        _id: r._id,
        requestNumber: r.requestNumber,
        requestType: "Stock Out",
        productName: r.product ? r.product.name : "Unknown Product",
        createdDate: r.createdAt,
        status: r.status,
        adminComments: r.adminComments,
        rawType: "stockout",
      })),
      ...retReqs.map((r) => ({
        _id: r._id,
        requestNumber: r.requestNumber,
        requestType: "Stock Return",
        productName: r.product ? r.product.name : "Unknown Product",
        createdDate: r.createdAt,
        status: r.status,
        adminComments: r.adminComments,
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
      ProductRequest.find().populate("product").populate("supervisor", "name email"),
      StockInRequest.find().populate("product").populate("supervisor", "name email"),
      StockOutRequest.find().populate("product").populate("supervisor", "name email"),
      StockReturnRequest.find().populate("product").populate("supervisor", "name email"),
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
        createdDate: r.createdAt,
        status: r.status,
        adminComments: r.adminComments,
        supervisor: r.supervisor,
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
  const { adminComments } = req.body;

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

    // 3. Reject Logic
    if (action === "reject") {
      request.status = "Rejected";
      request.adminComments = adminComments || "Rejected by administrator";
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

        const newProduct = await Product.create({
          code,
          name,
          category,
          brand,
          supplier,
          quantity,
          unit,
          minStock,
          maxStock,
          storeRoom,
          description,
          image,
        });

        // Set the reference to the newly created product in the request for trace
        request.product = newProduct._id;

        await recordMovement({
          product: newProduct,
          type: "PRODUCT_CREATED",
          direction: newProduct.quantity > 0 ? "IN" : "NONE",
          quantity: newProduct.quantity,
          reference: request.requestNumber,
          performedBy: req.user._id,
          note: "Opening quantity from an approved ADD request",
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
        product.quantity = quantity;
        product.unit = unit;
        product.minStock = minStock;
        product.maxStock = maxStock;
        product.storeRoom = storeRoom;
        product.description = description;
        product.image = image;

        await product.save();

        const delta = product.quantity - quantityBefore;
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
      product.quantity += request.quantity;
      await product.save();

      await recordMovement({
        product,
        type: "STOCK_IN",
        direction: "IN",
        quantity: request.quantity,
        reference: request.requestNumber,
        performedBy: req.user._id,
        note: "Approved Stock In request",
      });

      // Check for low stock notification clearance or trigger
      if (product.quantity <= product.minStock) {
        await Notification.create({
          message: `Alert: "${product.name}" remains below minimum stock (${product.quantity} ${product.unit} left in ${product.storeRoom})`,
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
      product.quantity -= request.quantity;
      await product.save();

      await recordMovement({
        product,
        type: "STOCK_OUT",
        direction: "OUT",
        quantity: request.quantity,
        reference: request.requestNumber,
        performedBy: req.user._id,
        note: "Approved Stock Out request",
      });

      // Low Stock Alert
      if (product.quantity <= product.minStock) {
        await Notification.create({
          message: `Alert: "${product.name}" has hit low stock (${product.quantity} ${product.unit} left in ${product.storeRoom})`,
          type: "LOW_STOCK",
        });
      }
    } else if (type === "stockreturn") {
      const product = await Product.findById(request.product);
      if (!product) {
        return res.status(404).json({ message: "Product no longer exists" });
      }
      product.quantity += request.quantity;
      await product.save();

      await recordMovement({
        product,
        type: "STOCK_RETURN",
        direction: "IN",
        quantity: request.quantity,
        reference: request.requestNumber,
        performedBy: req.user._id,
        note: "Approved Stock Return request",
      });
    }

    // Save approved request status
    request.status = "Approved";
    request.adminComments = adminComments || "Approved by administrator";
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
