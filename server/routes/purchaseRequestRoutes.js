import express from "express";

import { list, detail, raise, retry, cancel, companies, vendors, retryOrder, dropLine, reopenLine } from "../controllers/purchaseRequestController.js";
import { protect, requireRole } from "../middleware/session.js";
import { requireView } from "../config/access.js";

const router = express.Router();

router.use(protect);

// Reading follows the Engineering Stock screen; raising is the Maintenance
// Manager's, as receiving and adding items are (9 Oct 2026).
// Maintenance, and since 14 Oct 2026 the plant heads.
const WRITE = requireRole("Maintenance Manager", "Production Manager");
// The purchase manager's (20 Oct 2026); the Admin as the usual fallback.
// Nobody else: what is bought, and from whom, commits the company's money.
const BUY = requireRole("Purchase Manager", "Manager");

router.get("/", requireView("purchaseRequests"), list);
// Before /:id, or "companies" and "vendors" are read as request numbers.
router.get("/companies", requireView("purchaseRequests"), companies);
router.get("/vendors", BUY, vendors);
router.get("/:id", requireView("purchaseRequests"), detail);
router.post("/", WRITE, raise);
router.post("/:id/retry", WRITE, retry);
// Whoever may raise one, and the buyers (27 Oct 2026); the controller keeps a raiser to their own requests.
router.post("/:id/cancel", requireRole("Maintenance Manager", "Production Manager", "Purchase Manager", "Manager"), cancel);
// The PO is made from a quotation since 24 Oct 2026 (purchaseQuotationRoutes.js),
// not on the request. One made here before then that SAP refused can still be
// sent again, so none is stranded.
router.post("/:id/order/retry", BUY, retryOrder);
// A line nobody will quote is dropped with a reason, or opened again.
router.post("/:id/lines/:line/drop", BUY, dropLine);
router.post("/:id/lines/:line/reopen", BUY, reopenLine);

export default router;
