import express from "express";

import { list, requests, options, detail, create, update, remove, retry, cancel, order } from "../controllers/purchaseQuotationController.js";
import { protect, requireRole } from "../middleware/session.js";
import { requireView } from "../config/access.js";

const router = express.Router();

router.use(protect);

// The purchase manager's, as making the PO was (24 Oct 2026); the Admin as the
// usual fallback. Nobody else: the quotation is what the PO commits to.
const BUY = requireRole("Purchase Manager", "Manager");

router.get("/", requireView("purchaseQuotations"), list);
// Before /:id, or these are read as quotation numbers.
router.get("/requests", requireView("purchaseQuotations"), requests);
router.get("/options", BUY, options);
router.get("/:id", requireView("purchaseQuotations"), detail);
router.post("/", BUY, create);
router.put("/:id", BUY, update);
router.delete("/:id", BUY, remove);
router.post("/:id/retry", BUY, retry);
router.post("/:id/cancel", BUY, cancel);
router.post("/:id/order", BUY, order);

export default router;
