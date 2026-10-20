import express from "express";

import { list, detail, raise, retry, companies, vendors, order, retryOrder } from "../controllers/purchaseRequestController.js";
import { protect, requireRole } from "../middleware/session.js";
import { requireView } from "../config/access.js";

const router = express.Router();

router.use(protect);

// Reading follows the Engineering Stock screen; raising is the Maintenance
// Manager's, as receiving and adding items are (9 Oct 2026).
// Maintenance, and since 14 Oct 2026 the plant heads.
const WRITE = requireRole("Maintenance Manager", "Production Manager");
// Making the PO is the purchase manager's (20 Oct 2026); the Admin as the
// usual fallback. Nobody else: a PO commits the company's money.
const BUY = requireRole("Purchase Manager", "Manager");

router.get("/", requireView("purchaseRequests"), list);
// Before /:id, or "companies" and "vendors" are read as request numbers.
router.get("/companies", requireView("purchaseRequests"), companies);
router.get("/vendors", BUY, vendors);
router.get("/:id", requireView("purchaseRequests"), detail);
router.post("/", WRITE, raise);
router.post("/:id/retry", WRITE, retry);
router.post("/:id/order", BUY, order);
router.post("/:id/order/retry", BUY, retryOrder);

export default router;
