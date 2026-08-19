import express from "express";
import {
  createProductRequest,
  createStockInRequest,
  getMyRequests,
  getAllRequests,
  processRequest,
  updateOwnRequest,
  cancelOwnRequest,
} from "../controllers/requestController.js";
import { protect, authorizeRoles } from "../middleware/auth.js";

const router = express.Router();

// Supervisor endpoints. Only one thing still goes to the Admin: a new catalog
// item. An edit is saved on the product itself (PUT /api/products/:id), stock
// is added on it too (POST /api/products/:id/stock-in), and stock out / stock
// return have no request either. The stockin route below only answers older
// clients, which are told where the change belongs.
router.post("/product", protect, authorizeRoles("Supervisor"), createProductRequest);
router.post("/stockin", protect, authorizeRoles("Supervisor"), createStockInRequest);
router.get("/myrequests", protect, authorizeRoles("Supervisor"), getMyRequests);

// Supervisors may change their own requests while they are still Pending.
// Ownership is enforced in the controller, not just by role.
router.put("/:type/:id", protect, authorizeRoles("Supervisor"), updateOwnRequest);
router.delete("/:type/:id", protect, authorizeRoles("Supervisor"), cancelOwnRequest);

// Admin endpoints
router.get("/all", protect, authorizeRoles("Admin"), getAllRequests);
router.put("/:type/:id/:action", protect, authorizeRoles("Admin"), processRequest);

export default router;
