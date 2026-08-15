import Product from "../models/Product.js";
import ProductRequest from "../models/ProductRequest.js";
import StockInRequest from "../models/StockInRequest.js";
import StockOutRequest from "../models/StockOutRequest.js";
import StockReturnRequest from "../models/StockReturnRequest.js";
import IssueHistory from "../models/IssueHistory.js";
import RestockItem from "../models/RestockItem.js";
import MergeRequest from "../models/MergeRequest.js";
import StockRoom from "../models/StockRoom.js";
import StockRoomInventory from "../models/StockRoomInventory.js";
import BranchRequest from "../models/BranchRequest.js";

/** Red Stock the next weekly merge would pick up. */
const awaitingMergeFilter = { status: { $in: RestockItem.MERGEABLE_STATUSES } };

/** The four tables a supervisor request can land in. */
const REQUEST_MODELS = [
  ProductRequest,
  StockInRequest,
  StockOutRequest,
  StockReturnRequest,
];

/**
 * Pending / Approved / Rejected totalled across all four request types. Pass
 * `{ supervisor: id }` for one supervisor's share of the same queue.
 */
const requestCounts = async (filter = {}) => {
  const [pending, approved, rejected] = await Promise.all(
    ["Pending", "Approved", "Rejected"].map((status) =>
      Promise.all(
        REQUEST_MODELS.map((Model) => Model.countDocuments({ ...filter, status }))
      ).then((counts) => counts.reduce((sum, count) => sum + count, 0))
    )
  );

  return { pending, approved, rejected };
};

/**
 * Where the branch request queue stands, by stage. Both approvers get the same
 * numbers so each can see what the other is holding.
 */
const branchRequestCounts = async (filter = {}) => {
  const [pendingAdmin, pendingSupervisor, approved, rejected] = await Promise.all([
    BranchRequest.countDocuments({ ...filter, status: BranchRequest.PENDING_ADMIN }),
    BranchRequest.countDocuments({ ...filter, status: BranchRequest.PENDING_SUPERVISOR }),
    BranchRequest.countDocuments({ ...filter, status: "Approved" }),
    BranchRequest.countDocuments({ ...filter, status: "Rejected" }),
  ]);

  return {
    branchPendingAdmin: pendingAdmin,
    branchPendingSupervisor: pendingSupervisor,
    branchApproved: approved,
    branchRejected: rejected,
  };
};

// @desc    Get dashboard metrics for Admin
// @route   GET /api/dashboard/admin
// @access  Private (Admin only)
export const getAdminDashboard = async (req, res) => {
  try {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    // 1. Total Products count
    const totalProducts = await Product.countDocuments();

    // 2. Count low stock products (quantity <= minStock)
    const lowStockProductsCount = await Product.countDocuments({
      $expr: { $lte: ["$quantity", "$minStock"] },
    });

    // 3. Find actual low stock products
    const lowStockProducts = await Product.find({
      $expr: { $lte: ["$quantity", "$minStock"] },
    }).limit(10);

    // 4. Request status counts (all users)
    const {
      pending: pendingRequests,
      approved: approvedRequests,
      rejected: rejectedRequests,
    } = await requestCounts();

    // 5. Today's Requests
    const [todayProd, todayIn, todayOut, todayRet] = await Promise.all([
      ProductRequest.find({ createdAt: { $gte: startOfToday } }).populate("supervisor", "name").populate("product", "name"),
      StockInRequest.find({ createdAt: { $gte: startOfToday } }).populate("supervisor", "name").populate("product", "name"),
      StockOutRequest.find({ createdAt: { $gte: startOfToday } }).populate("supervisor", "name").populate("product", "name"),
      StockReturnRequest.find({ createdAt: { $gte: startOfToday } }).populate("supervisor", "name").populate("product", "name"),
    ]);

    const todayRequestsList = [
      ...todayProd.map((r) => ({
        _id: r._id,
        requestNumber: r.requestNumber,
        productName: r.requestType === "ADD" ? r.details.name : (r.product ? r.product.name : r.details.name),
        requestType: r.requestType === "ADD" ? "Add Product" : "Edit Product",
        supervisorName: r.supervisor ? r.supervisor.name : "System",
        status: r.status,
        time: r.createdAt,
      })),
      ...todayIn.map((r) => ({
        _id: r._id,
        requestNumber: r.requestNumber,
        productName: r.product ? r.product.name : "Unknown",
        requestType: "Stock In",
        supervisorName: r.supervisor ? r.supervisor.name : "System",
        status: r.status,
        time: r.createdAt,
      })),
      ...todayOut.map((r) => ({
        _id: r._id,
        requestNumber: r.requestNumber,
        productName: r.product ? r.product.name : "Unknown",
        requestType: "Stock Out",
        supervisorName: r.supervisor ? r.supervisor.name : "System",
        status: r.status,
        time: r.createdAt,
      })),
      ...todayRet.map((r) => ({
        _id: r._id,
        requestNumber: r.requestNumber,
        productName: r.product ? r.product.name : "Unknown",
        requestType: "Stock Return",
        supervisorName: r.supervisor ? r.supervisor.name : "System",
        status: r.status,
        time: r.createdAt,
      })),
    ];

    todayRequestsList.sort((a, b) => new Date(b.time) - new Date(a.time));

    // 6. Issue History metrics
    const issuedTodayCount = await IssueHistory.countDocuments({ createdAt: { $gte: startOfToday } });

    const recentIssues = await IssueHistory.find()
      .populate("product", "name code unit storeRoom image")
      .populate("supervisor", "name email role")
      .sort({ createdAt: -1 })
      .limit(10);

    // 7. Red Stock Room and weekly merge queue
    const [restockPendingCount, restockPendingQuantity, mergePendingCount, recentRestockItems] =
      await Promise.all([
        RestockItem.countDocuments(awaitingMergeFilter),
        RestockItem.aggregate([
          { $match: awaitingMergeFilter },
          { $group: { _id: null, total: { $sum: "$quantity" } } },
        ]).then((rows) => (rows[0] ? rows[0].total : 0)),
        MergeRequest.countDocuments({ status: "Pending Approval" }),
        RestockItem.find(awaitingMergeFilter)
          .populate("returnedBy", "name email role")
          .sort({ createdAt: -1 })
          .limit(10),
      ]);

    // The branch queue, so the Admin sees stage-one work from the dashboard.
    const branchCounts = await branchRequestCounts();

    res.json({
      totalProducts,
      pendingRequests,
      approvedRequests,
      rejectedRequests,
      lowStockProductsCount,
      lowStockProducts,
      ...branchCounts,
      todayRequestsCount: todayRequestsList.length,
      todayRequests: todayRequestsList,
      issuedTodayCount,
      recentIssues,
      restockPendingCount,
      restockPendingQuantity,
      mergePendingCount,
      recentRestockItems,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Stock held in the branch's own room — the only thing a Branch
//          account can read. No requests, no other room, no catalog.
// @route   GET /api/dashboard/branch
// @access  Private (Branch only)
export const getBranchDashboard = async (req, res) => {
  try {
    // The room comes off the account, never off the query string, so a Branch
    // user cannot ask for a room that is not theirs.
    const room = await StockRoom.findById(req.user.stockRoom);
    if (!room) {
      return res.status(404).json({
        message: "No stock room is assigned to this branch account",
      });
    }

    const rows = await StockRoomInventory.find({ stockRoom: room._id })
      .populate("product", "name code unit image category minStock maxStock")
      .sort({ quantity: -1 });

    // A row whose product was deleted has nothing left to show.
    const items = rows
      .filter((row) => row.product)
      .map((row) => ({
        _id: row._id,
        productId: row.product._id,
        name: row.product.name,
        code: row.product.code,
        category: row.product.category,
        unit: row.product.unit,
        image: row.product.image,
        minStock: row.product.minStock ?? 0,
        maxStock: row.product.maxStock ?? 0,
        quantity: row.quantity,
        isOutOfStock: row.quantity === 0,
        isLowStock: row.quantity > 0 && row.quantity <= (row.product.minStock ?? 0),
        updatedAt: row.updatedAt,
      }));

    // This branch's own request queue, by stage.
    const branchCounts = await branchRequestCounts({ branch: req.user._id });

    res.json({
      room: {
        _id: room._id,
        name: room.name,
        description: room.description,
      },
      ...branchCounts,
      itemCount: items.length,
      totalQuantity: items.reduce((sum, item) => sum + item.quantity, 0),
      lowStockCount: items.filter((item) => item.isLowStock).length,
      outOfStockCount: items.filter((item) => item.isOutOfStock).length,
      categoryCount: new Set(items.map((item) => item.category).filter(Boolean)).size,
      items,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get dashboard metrics for Supervisor
// @route   GET /api/dashboard/supervisor
// @access  Private (Supervisor only)
export const getSupervisorDashboard = async (req, res) => {
  try {
    const supervisorId = req.user._id;
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    // 1. Total active products (global view, since they can see all products)
    const totalProducts = await Product.countDocuments();

    // 2. Count low stock products
    const lowStockProductsCount = await Product.countDocuments({
      $expr: { $lte: ["$quantity", "$minStock"] },
    });

    // 2b. Total pieces on hand across every product and room
    const [stockTotals] = await Product.aggregate([
      { $group: { _id: null, total: { $sum: "$quantity" } } },
    ]);
    const totalStockQuantity = stockTotals?.total ?? 0;

    // 3. Request status counts. The store's whole queue, plus this
    //    supervisor's share of it, so both can be shown side by side.
    const [storeRequests, myRequests] = await Promise.all([
      requestCounts(),
      requestCounts({ supervisor: supervisorId }),
    ]);

    // 4. Today's activity — every supervisor's requests, not just the
    //    caller's, so the whole store's day is visible from one screen.
    const todayFilter = { createdAt: { $gte: startOfToday } };
    const [todayProd, todayIn, todayOut, todayRet] = await Promise.all([
      ProductRequest.find(todayFilter).populate("product", "name").populate("supervisor", "name"),
      StockInRequest.find(todayFilter).populate("product", "name").populate("supervisor", "name"),
      StockOutRequest.find(todayFilter).populate("product", "name").populate("supervisor", "name"),
      StockReturnRequest.find(todayFilter).populate("product", "name").populate("supervisor", "name"),
    ]);

    /** Who raised it, and whether that was the supervisor reading this. */
    const raisedBy = (r) => ({
      supervisorName: r.supervisor ? r.supervisor.name : "System",
      isMine: String(r.supervisor?._id || r.supervisor) === String(supervisorId),
    });

    const todayActivity = [
      ...todayProd.map((r) => ({
        _id: r._id,
        requestNumber: r.requestNumber,
        productName: r.requestType === "ADD" ? r.details.name : (r.product ? r.product.name : r.details.name),
        requestType: r.requestType === "ADD" ? "Add Product" : "Edit Product",
        status: r.status,
        time: r.createdAt,
        ...raisedBy(r),
      })),
      ...todayIn.map((r) => ({
        _id: r._id,
        requestNumber: r.requestNumber,
        productName: r.product ? r.product.name : "Unknown",
        requestType: "Stock In",
        quantity: r.quantity,
        status: r.status,
        time: r.createdAt,
        ...raisedBy(r),
      })),
      ...todayOut.map((r) => ({
        _id: r._id,
        requestNumber: r.requestNumber,
        productName: r.product ? r.product.name : "Unknown",
        requestType: "Stock Out",
        quantity: r.quantity,
        status: r.status,
        time: r.createdAt,
        ...raisedBy(r),
      })),
      ...todayRet.map((r) => ({
        _id: r._id,
        requestNumber: r.requestNumber,
        productName: r.product ? r.product.name : "Unknown",
        requestType: "Stock Return",
        quantity: r.quantity,
        status: r.status,
        time: r.createdAt,
        ...raisedBy(r),
      })),
    ];

    todayActivity.sort((a, b) => new Date(b.time) - new Date(a.time));

    // 5. Everything the store has issued — today's count and the last ten,
    //    each carrying the supervisor who issued it. Fully returned issues are
    //    left out, the same way `GET /api/issues` leaves them out for a
    //    supervisor: the list is what is still out with a recipient. The counts
    //    are of what went out today, so they stand whether it came back or not.
    const [issuedTodayCount, myIssuedTodayCount, recentIssues] = await Promise.all([
      IssueHistory.countDocuments(todayFilter),
      IssueHistory.countDocuments({ supervisor: supervisorId, ...todayFilter }),
      IssueHistory.find({ returnStatus: { $ne: "Returned" } })
        .populate("product", "name code unit storeRoom image")
        .populate("supervisor", "name email role")
        .sort({ createdAt: -1 })
        .limit(10),
    ]);

    // 6. The Red Stock Room, whole and then this supervisor's share.
    const [restockPendingCount, myRestockPendingCount, restockPendingQuantity, mergedReturnsCount] =
      await Promise.all([
        RestockItem.countDocuments(awaitingMergeFilter),
        RestockItem.countDocuments({ returnedBy: supervisorId, ...awaitingMergeFilter }),
        RestockItem.aggregate([
          { $match: awaitingMergeFilter },
          { $group: { _id: null, total: { $sum: "$quantity" } } },
        ]).then((rows) => (rows[0] ? rows[0].total : 0)),
        RestockItem.countDocuments({ status: "Moved to Stock Room" }),
      ]);

    // Stage-two work waiting on this portal.
    const branchCounts = await branchRequestCounts();

    res.json({
      totalProducts,
      // Store-wide by default; the `my*` counts sit under them on the cards.
      pendingRequests: storeRequests.pending,
      approvedRequests: storeRequests.approved,
      rejectedRequests: storeRequests.rejected,
      myPendingRequests: myRequests.pending,
      myApprovedRequests: myRequests.approved,
      myRejectedRequests: myRequests.rejected,
      lowStockProductsCount,
      totalStockQuantity,
      ...branchCounts,
      todayActivity,
      issuedTodayCount,
      myIssuedTodayCount,
      // Tagged the same way `GET /api/issues` tags its rows, so a client can
      // tell the supervisor's own issues apart without a second lookup.
      recentIssues: recentIssues.map((issue) => ({
        ...issue.toObject(),
        isMine: String(issue.supervisor?._id || issue.supervisor) === String(supervisorId),
      })),
      restockPendingCount,
      myRestockPendingCount,
      restockPendingQuantity,
      mergedReturnsCount,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
