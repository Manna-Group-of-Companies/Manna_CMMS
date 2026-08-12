import express from "express";
import {
  createProductRequest,
  createStockInRequest,
  createStockOutRequest,
  createStockReturnRequest,
  getMyRequests,
  getAllRequests,
  processRequest,
} from "../controllers/requestController.js";
import { protect, authorizeRoles } from "../middleware/auth.js";

const router = express.Router();

// Supervisor endpoints
router.post("/product", protect, authorizeRoles("Supervisor"), createProductRequest);
router.post("/stockin", protect, authorizeRoles("Supervisor"), createStockInRequest);
router.post("/stockout", protect, authorizeRoles("Supervisor"), createStockOutRequest);
router.post("/stockreturn", protect, authorizeRoles("Supervisor"), createStockReturnRequest);
router.get("/myrequests", protect, authorizeRoles("Supervisor"), getMyRequests);

// Admin endpoints
router.get("/all", protect, authorizeRoles("Admin"), getAllRequests);
router.put("/:type/:id/:action", protect, authorizeRoles("Admin"), processRequest);

export default router;
