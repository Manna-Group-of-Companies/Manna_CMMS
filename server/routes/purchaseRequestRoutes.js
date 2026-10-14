import express from "express";

import { list, detail, raise, retry } from "../controllers/purchaseRequestController.js";
import { protect, requireRole } from "../middleware/session.js";
import { requireView } from "../config/access.js";

const router = express.Router();

router.use(protect);

// Reading follows the Engineering Stock screen; raising is the Maintenance
// Manager's, as receiving and adding items are (9 Oct 2026).
// Maintenance, and since 14 Oct 2026 the plant heads.
const WRITE = requireRole("Maintenance Manager", "Production Manager");

router.get("/", requireView("purchaseRequests"), list);
router.get("/:id", requireView("purchaseRequests"), detail);
router.post("/", WRITE, raise);
router.post("/:id/retry", WRITE, retry);

export default router;
