import express from "express";

import { list, detail, retry } from "../controllers/purchaseOrderController.js";
import { protect, requireRole } from "../middleware/session.js";
import { requireView } from "../config/access.js";

const router = express.Router();

router.use(protect);

// Made from a quotation (routes/purchaseQuotationRoutes.js), never here.
const BUY = requireRole("Purchase Manager", "Manager");

router.get("/", requireView("purchaseOrders"), list);
router.get("/:id", requireView("purchaseOrders"), detail);
router.post("/:id/retry", BUY, retry);

export default router;
