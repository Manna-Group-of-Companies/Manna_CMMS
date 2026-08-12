import express from "express";
import {
  returnIssuedStock,
  getRestockItems,
  getRestockSummary,
} from "../controllers/restockController.js";
import { protect, authorizeRoles } from "../middleware/auth.js";

const router = express.Router();

// Supervisor: hand issued stock back into the Restock section
router.post("/returns", protect, authorizeRoles("Supervisor"), returnIssuedStock);

// Admin sees the whole Restock section; a Supervisor sees their own returns
router.get("/", protect, getRestockItems);

// Admin: totals for the weekly review
router.get("/summary", protect, authorizeRoles("Admin"), getRestockSummary);

export default router;
