import express from "express";
import {
  returnIssuedStock,
  getRestockItems,
  getRestockSummary,
  getRedStockRoom,
} from "../controllers/restockController.js";
import { protect, authorizeRoles } from "../middleware/auth.js";

const router = express.Router();

// Supervisor: hand issued stock straight into the Red Stock Room. No Admin
// request is created here — approval only exists at the weekly merge.
router.post("/returns", protect, authorizeRoles("Supervisor"), returnIssuedStock);

// Admin sees the whole Red Stock Room; a Supervisor sees their own returns
router.get("/", protect, authorizeRoles("Admin", "Supervisor"), getRestockItems);

// The Red Stock Room rolled up per product
router.get("/room", protect, authorizeRoles("Admin", "Supervisor"), getRedStockRoom);

// Admin: totals for the weekly review
router.get("/summary", protect, authorizeRoles("Admin"), getRestockSummary);

export default router;
