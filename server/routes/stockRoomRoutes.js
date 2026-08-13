import express from "express";
import {
  getStockRooms,
  getInventoryByRoom,
  getProductRoomBreakdown,
  transferStock,
  setRoomQuantity,
} from "../controllers/stockRoomController.js";
import { protect, authorizeRoles } from "../middleware/auth.js";

const router = express.Router();

// Admin and Supervisor read rooms and balances across the whole site. A
// Branch account is confined to its own room and reads it through
// GET /api/dashboard/branch instead.
router.use(protect, authorizeRoles("Admin", "Supervisor"));

router.get("/", getStockRooms);
router.get("/inventory", getInventoryByRoom);
router.get("/products/:productId", getProductRoomBreakdown);

// Moving and correcting stock is Admin-only.
router.post("/transfer", authorizeRoles("Admin"), transferStock);
router.put("/inventory", authorizeRoles("Admin"), setRoomQuantity);

export default router;
