import express from "express";

import { list, detail, raise, retry } from "../controllers/purchaseRequestController.js";
import { protect, requireRole } from "../middleware/session.js";
import { requireView } from "../config/access.js";

const router = express.Router();

router.use(protect);

// Reading follows the Engineering Stock screen; raising is the Maintenance
// Manager's, as receiving and adding items are (9 Oct 2026).
const WRITE = requireRole("Maintenance Manager");

router.get("/", requireView("engineeringStock"), list);
router.get("/:id", requireView("engineeringStock"), detail);
router.post("/", WRITE, raise);
router.post("/:id/retry", WRITE, retry);

export default router;
