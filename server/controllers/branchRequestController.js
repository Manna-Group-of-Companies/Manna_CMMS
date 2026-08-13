import BranchRequest from "../models/BranchRequest.js";
import Product from "../models/Product.js";
import StockRoom from "../models/StockRoom.js";
import StockRoomInventory from "../models/StockRoomInventory.js";
import Notification from "../models/Notification.js";
import { recordMovement } from "../utils/stockLedger.js";
import { debitRoom } from "../utils/stockRooms.js";

const { PENDING_ADMIN, PENDING_SUPERVISOR } = BranchRequest;

/** Everything the three portals need to render one request. */
const POPULATE = [
  { path: "branch", select: "name email" },
  { path: "admin", select: "name email" },
  { path: "supervisor", select: "name email" },
  { path: "product", select: "name code unit image category minStock" },
  { path: "stockRoom", select: "name" },
];

const generateRequestNumber = () =>
  `BRQ-${Math.floor(100000 + Math.random() * 900000)}`;

/** How much of [productId] the room holds right now. */
const roomQuantityFor = async (roomId, productId) => {
  const row = await StockRoomInventory.findOne({ stockRoom: roomId, product: productId });
  return row?.quantity ?? 0;
};

/** Appends one step to the audit trail. */
const addHistory = (request, { stage, action, user, comment = "", quantity = null }) => {
  request.history.push({
    stage,
    action,
    by: user?._id,
    byName: user?.name || "",
    byRole: user?.role || "",
    comment,
    quantity,
    at: new Date(),
  });
};

/**
 * @desc    Raise a request for stock in the branch's own room
 * @route   POST /api/branch-requests
 * @access  Private (Branch)
 */
export const createBranchRequest = async (req, res) => {
  const { productId, quantity, purpose } = req.body;

  try {
    const qty = Number(quantity);
    if (!productId || !Number.isInteger(qty) || qty < 1) {
      return res
        .status(400)
        .json({ message: "A product and a whole quantity of at least 1 are required" });
    }

    // The room comes off the account: a branch can only ever draw on its own.
    const room = await StockRoom.findById(req.user.stockRoom);
    if (!room) {
      return res
        .status(404)
        .json({ message: "No stock room is assigned to this branch account" });
    }

    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    const available = await roomQuantityFor(room._id, product._id);
    if (available <= 0) {
      return res
        .status(400)
        .json({ message: `"${product.name}" is not stocked in ${room.name}` });
    }
    if (qty > available) {
      return res.status(400).json({
        message: `Only ${available} ${product.unit} of "${product.name}" available in ${room.name}`,
      });
    }

    const request = new BranchRequest({
      requestNumber: generateRequestNumber(),
      branch: req.user._id,
      stockRoom: room._id,
      stockRoomName: room.name,
      product: product._id,
      productName: product.name,
      productCode: product.code,
      unit: product.unit,
      quantity: qty,
      stockAtRequest: available,
      purpose: (purpose || "").trim(),
      status: PENDING_ADMIN,
    });

    addHistory(request, {
      stage: "Submitted",
      action: "Submitted",
      user: req.user,
      comment: (purpose || "").trim(),
      quantity: qty,
    });

    await request.save();

    await Notification.create({
      message: `Branch request ${request.requestNumber}: ${qty} × "${product.name}" from ${room.name} by ${req.user.name} — awaiting Admin approval`,
      type: "REQUEST_CREATED",
    });

    res.status(201).json(await request.populate(POPULATE));
  } catch (error) {
    console.error("Error creating branch request:", error);
    res.status(500).json({ message: error.message });
  }
};

/**
 * @desc    The branch's own requests, newest first
 * @route   GET /api/branch-requests/mine
 * @access  Private (Branch)
 */
export const getMyBranchRequests = async (req, res) => {
  try {
    const requests = await BranchRequest.find({ branch: req.user._id })
      .populate(POPULATE)
      .sort({ createdAt: -1 });
    res.json(requests);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/**
 * @desc    Every branch request, for the Admin and Supervisor queues
 * @route   GET /api/branch-requests
 * @access  Private (Admin, Supervisor)
 */
export const getBranchRequests = async (req, res) => {
  try {
    const filter = {};
    if (req.query.status) {
      filter.status = req.query.status;
    }

    const requests = await BranchRequest.find(filter)
      .populate(POPULATE)
      .sort({ createdAt: -1 });

    res.json(requests);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/**
 * @desc    Stage one. Approving moves the request on to the Supervisor; it
 *          does not touch stock.
 * @route   PUT /api/branch-requests/:id/admin
 * @access  Private (Admin)
 */
export const adminDecideBranchRequest = async (req, res) => {
  const { action, comment, approvedQuantity } = req.body;

  try {
    if (!["approve", "reject"].includes(action)) {
      return res.status(400).json({ message: "Action must be approve or reject" });
    }

    const request = await BranchRequest.findById(req.params.id);
    if (!request) {
      return res.status(404).json({ message: "Request not found" });
    }
    if (request.status !== PENDING_ADMIN) {
      return res.status(400).json({
        message:
          request.status === PENDING_SUPERVISOR
            ? "This request has already passed Admin approval and is with the Supervisor"
            : `This request is already ${request.status}`,
      });
    }

    request.admin = req.user._id;
    request.adminDecidedAt = new Date();

    if (action === "reject") {
      request.status = "Rejected";
      request.adminComments = (comment || "").trim() || "Rejected by Admin";
      addHistory(request, {
        stage: "Admin",
        action: "Rejected",
        user: req.user,
        comment: request.adminComments,
      });
      await request.save();

      await Notification.create({
        user: request.branch,
        message: `Branch request ${request.requestNumber} was rejected by the Admin: "${request.adminComments}"`,
        type: "REQUEST_REJECTED",
      });

      return res.json(await request.populate(POPULATE));
    }

    // Approving may cut the quantity, but never raise it above what was asked.
    const passed =
      approvedQuantity === undefined || approvedQuantity === null
        ? request.quantity
        : Number(approvedQuantity);

    if (!Number.isInteger(passed) || passed < 1) {
      return res
        .status(400)
        .json({ message: "Approved quantity must be a whole number of at least 1" });
    }
    if (passed > request.quantity) {
      return res.status(400).json({
        message: `Cannot approve ${passed}; only ${request.quantity} was requested`,
      });
    }

    request.status = PENDING_SUPERVISOR;
    request.approvedQuantity = passed;
    request.adminComments = (comment || "").trim() || "Approved by Admin";
    addHistory(request, {
      stage: "Admin",
      action: "Approved",
      user: req.user,
      comment: request.adminComments,
      quantity: passed,
    });
    await request.save();

    await Notification.create({
      message: `Branch request ${request.requestNumber} approved by Admin — awaiting Supervisor approval`,
      type: "REQUEST_APPROVED",
    });

    res.json(await request.populate(POPULATE));
  } catch (error) {
    console.error("Error on admin decision:", error);
    res.status(500).json({ message: error.message });
  }
};

/**
 * @desc    Stage two, the final say. Approving takes the stock out of the
 *          branch's room and writes the movement to the ledger.
 * @route   PUT /api/branch-requests/:id/supervisor
 * @access  Private (Supervisor)
 */
export const supervisorDecideBranchRequest = async (req, res) => {
  const { action, comment, approvedQuantity } = req.body;

  try {
    if (!["approve", "reject"].includes(action)) {
      return res.status(400).json({ message: "Action must be approve or reject" });
    }

    const request = await BranchRequest.findById(req.params.id);
    if (!request) {
      return res.status(404).json({ message: "Request not found" });
    }
    if (request.status !== PENDING_SUPERVISOR) {
      return res.status(400).json({
        message:
          request.status === PENDING_ADMIN
            ? "This request is still waiting on Admin approval"
            : `This request is already ${request.status}`,
      });
    }

    request.supervisor = req.user._id;
    request.supervisorDecidedAt = new Date();

    if (action === "reject") {
      request.status = "Rejected";
      request.supervisorComments = (comment || "").trim() || "Rejected by Supervisor";
      addHistory(request, {
        stage: "Supervisor",
        action: "Rejected",
        user: req.user,
        comment: request.supervisorComments,
      });
      await request.save();

      await Notification.create({
        user: request.branch,
        message: `Branch request ${request.requestNumber} was rejected by the Supervisor: "${request.supervisorComments}"`,
        type: "REQUEST_REJECTED",
      });

      return res.json(await request.populate(POPULATE));
    }

    const issued =
      approvedQuantity === undefined || approvedQuantity === null
        ? request.approvedQuantity ?? request.quantity
        : Number(approvedQuantity);

    if (!Number.isInteger(issued) || issued < 1) {
      return res
        .status(400)
        .json({ message: "Approved quantity must be a whole number of at least 1" });
    }
    if (issued > (request.approvedQuantity ?? request.quantity)) {
      return res.status(400).json({
        message: `Cannot approve ${issued}; the Admin passed ${
          request.approvedQuantity ?? request.quantity
        }`,
      });
    }

    const product = await Product.findById(request.product);
    if (!product) {
      return res.status(404).json({ message: "Product no longer exists" });
    }

    // debitRoom refuses to go negative, so a room that has since been drained
    // fails here rather than silently issuing stock that is not there.
    let roomQuantity;
    try {
      ({ roomQuantity } = await debitRoom({
        product,
        room: request.stockRoom,
        quantity: issued,
      }));
    } catch (stockError) {
      return res.status(400).json({ message: stockError.message });
    }

    request.status = "Approved";
    request.approvedQuantity = issued;
    request.supervisorComments = (comment || "").trim() || "Approved by Supervisor";
    addHistory(request, {
      stage: "Supervisor",
      action: "Approved",
      user: req.user,
      comment: request.supervisorComments,
      quantity: issued,
    });
    await request.save();

    await recordMovement({
      product,
      type: "STOCK_OUT",
      direction: "OUT",
      quantity: issued,
      reference: request.requestNumber,
      performedBy: req.user._id,
      note: `Branch request completed — issued to ${request.stockRoomName} branch (room now ${roomQuantity})`,
      fromRoom: request.stockRoomName,
    });

    await Notification.create({
      user: request.branch,
      message: `Branch request ${request.requestNumber} is fully approved — ${issued} × "${request.productName}" released`,
      type: "REQUEST_APPROVED",
    });

    if (product.quantity <= product.minStock) {
      await Notification.create({
        message: `Alert: "${product.name}" has hit low stock (${product.quantity} ${product.unit} total)`,
        type: "LOW_STOCK",
      });
    }

    res.json(await request.populate(POPULATE));
  } catch (error) {
    console.error("Error on supervisor decision:", error);
    res.status(500).json({ message: error.message });
  }
};

/**
 * @desc    Withdraw a request that no one has decided yet
 * @route   DELETE /api/branch-requests/:id
 * @access  Private (Branch, own requests)
 */
export const cancelBranchRequest = async (req, res) => {
  try {
    const request = await BranchRequest.findById(req.params.id);
    if (!request) {
      return res.status(404).json({ message: "Request not found" });
    }
    if (String(request.branch) !== String(req.user._id)) {
      return res.status(403).json({ message: "You can only cancel your own requests" });
    }
    if (request.status !== PENDING_ADMIN) {
      return res.status(400).json({
        message: `This request is already ${request.status} and can no longer be withdrawn`,
      });
    }

    request.status = "Cancelled";
    addHistory(request, {
      stage: "Branch",
      action: "Cancelled",
      user: req.user,
      comment: "Withdrawn by the branch",
    });
    await request.save();

    res.json(await request.populate(POPULATE));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
