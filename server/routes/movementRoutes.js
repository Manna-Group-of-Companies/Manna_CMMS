import express from "express";
import { getStockMovements } from "../controllers/movementController.js";
import { protect, authorizeRoles } from "../middleware/auth.js";

const router = express.Router();

router.get("/", protect, authorizeRoles("Admin"), getStockMovements);

export default router;
