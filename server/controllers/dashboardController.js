import Product from "../models/Product.js";
import ProductRequest from "../models/ProductRequest.js";
import StockInRequest from "../models/StockInRequest.js";
import StockOutRequest from "../models/StockOutRequest.js";
import StockReturnRequest from "../models/StockReturnRequest.js";
import IssueHistory from "../models/IssueHistory.js";
import RestockItem from "../models/RestockItem.js";
import MergeRequest from "../models/MergeRequest.js";

/** Items sitting in Restock that an Admin could still pull into a merge. */
const awaitingMergeFilter = { status: { $in: ["Restock Pending", "Merge Rejected"] } };

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
    const [
      pendingProd, approvedProd, rejectedProd,
      pendingIn, approvedIn, rejectedIn,
      pendingOut, approvedOut, rejectedOut,
      pendingRet, approvedRet, rejectedRet
    ] = await Promise.all([
      ProductRequest.countDocuments({ status: "Pending" }),
      ProductRequest.countDocuments({ status: "Approved" }),
      ProductRequest.countDocuments({ status: "Rejected" }),

      StockInRequest.countDocuments({ status: "Pending" }),
      StockInRequest.countDocuments({ status: "Approved" }),
      StockInRequest.countDocuments({ status: "Rejected" }),

      StockOutRequest.countDocuments({ status: "Pending" }),
      StockOutRequest.countDocuments({ status: "Approved" }),
      StockOutRequest.countDocuments({ status: "Rejected" }),

      StockReturnRequest.countDocuments({ status: "Pending" }),
      StockReturnRequest.countDocuments({ status: "Approved" }),
      StockReturnRequest.countDocuments({ status: "Rejected" }),
    ]);

    const pendingRequests = pendingProd + pendingIn + pendingOut + pendingRet;
    const approvedRequests = approvedProd + approvedIn + approvedOut + approvedRet;
    const rejectedRequests = rejectedProd + rejectedIn + rejectedOut + rejectedRet;

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
      .populate("supervisor", "name email")
      .sort({ createdAt: -1 })
      .limit(10);

    // 7. Restock section and weekly merge queue
    const [restockPendingCount, restockPendingQuantity, mergePendingCount, recentRestockItems] =
      await Promise.all([
        RestockItem.countDocuments(awaitingMergeFilter),
        RestockItem.aggregate([
          { $match: awaitingMergeFilter },
          { $group: { _id: null, total: { $sum: "$quantity" } } },
        ]).then((rows) => (rows[0] ? rows[0].total : 0)),
        MergeRequest.countDocuments({ status: "Pending Approval" }),
        RestockItem.find(awaitingMergeFilter)
          .populate("returnedBy", "name email")
          .sort({ createdAt: -1 })
          .limit(10),
      ]);

    res.json({
      totalProducts,
      pendingRequests,
      approvedRequests,
      rejectedRequests,
      lowStockProductsCount,
      lowStockProducts,
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

    // 3. Request status counts specific to this supervisor
    const [
      pendingProd, approvedProd, rejectedProd,
      pendingIn, approvedIn, rejectedIn,
      pendingOut, approvedOut, rejectedOut,
      pendingRet, approvedRet, rejectedRet
    ] = await Promise.all([
      ProductRequest.countDocuments({ supervisor: supervisorId, status: "Pending" }),
      ProductRequest.countDocuments({ supervisor: supervisorId, status: "Approved" }),
      ProductRequest.countDocuments({ supervisor: supervisorId, status: "Rejected" }),

      StockInRequest.countDocuments({ supervisor: supervisorId, status: "Pending" }),
      StockInRequest.countDocuments({ supervisor: supervisorId, status: "Approved" }),
      StockInRequest.countDocuments({ supervisor: supervisorId, status: "Rejected" }),

      StockOutRequest.countDocuments({ supervisor: supervisorId, status: "Pending" }),
      StockOutRequest.countDocuments({ supervisor: supervisorId, status: "Approved" }),
      StockOutRequest.countDocuments({ supervisor: supervisorId, status: "Rejected" }),

      StockReturnRequest.countDocuments({ supervisor: supervisorId, status: "Pending" }),
      StockReturnRequest.countDocuments({ supervisor: supervisorId, status: "Approved" }),
      StockReturnRequest.countDocuments({ supervisor: supervisorId, status: "Rejected" }),
    ]);

    const pendingRequests = pendingProd + pendingIn + pendingOut + pendingRet;
    const approvedRequests = approvedProd + approvedIn + approvedOut + approvedRet;
    const rejectedRequests = rejectedProd + rejectedIn + rejectedOut + rejectedRet;

    // 4. Today's Activity (requests submitted today by this supervisor)
    const [todayProd, todayIn, todayOut, todayRet] = await Promise.all([
      ProductRequest.find({ supervisor: supervisorId, createdAt: { $gte: startOfToday } }).populate("product", "name"),
      StockInRequest.find({ supervisor: supervisorId, createdAt: { $gte: startOfToday } }).populate("product", "name"),
      StockOutRequest.find({ supervisor: supervisorId, createdAt: { $gte: startOfToday } }).populate("product", "name"),
      StockReturnRequest.find({ supervisor: supervisorId, createdAt: { $gte: startOfToday } }).populate("product", "name"),
    ]);

    const todayActivity = [
      ...todayProd.map((r) => ({
        _id: r._id,
        requestNumber: r.requestNumber,
        productName: r.requestType === "ADD" ? r.details.name : (r.product ? r.product.name : r.details.name),
        requestType: r.requestType === "ADD" ? "Add Product" : "Edit Product",
        status: r.status,
        time: r.createdAt,
      })),
      ...todayIn.map((r) => ({
        _id: r._id,
        requestNumber: r.requestNumber,
        productName: r.product ? r.product.name : "Unknown",
        requestType: "Stock In",
        status: r.status,
        time: r.createdAt,
      })),
      ...todayOut.map((r) => ({
        _id: r._id,
        requestNumber: r.requestNumber,
        productName: r.product ? r.product.name : "Unknown",
        requestType: "Stock Out",
        status: r.status,
        time: r.createdAt,
      })),
      ...todayRet.map((r) => ({
        _id: r._id,
        requestNumber: r.requestNumber,
        productName: r.product ? r.product.name : "Unknown",
        requestType: "Stock Return",
        status: r.status,
        time: r.createdAt,
      })),
    ];

    todayActivity.sort((a, b) => new Date(b.time) - new Date(a.time));

    // 5. This supervisor's own returns still parked in Restock
    const [restockPendingCount, mergedReturnsCount] = await Promise.all([
      RestockItem.countDocuments({ returnedBy: supervisorId, ...awaitingMergeFilter }),
      RestockItem.countDocuments({ returnedBy: supervisorId, status: "Merged" }),
    ]);

    res.json({
      totalProducts,
      pendingRequests,
      approvedRequests,
      rejectedRequests,
      lowStockProductsCount,
      todayActivity,
      restockPendingCount,
      mergedReturnsCount,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
