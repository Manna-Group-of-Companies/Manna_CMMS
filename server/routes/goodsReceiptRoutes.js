import express from "express";

import {
  list,
  detail,
  openPo,
  refreshPo,
  createGoodsReceipt,
  createStockAddition,
  retry,
} from "../controllers/goodsReceiptController.js";
import { protect, requireRole } from "../middleware/session.js";
import { requireView } from "../config/access.js";

const router = express.Router();

router.use(protect);

// Reading follows the Engineering Stock screen; receiving is the Maintenance
// Manager's alone, as adding and editing items is (decided 9 Oct 2026).
const WRITE = requireRole("Maintenance Manager");

// Above /:id, or "open-po" is read as a receipt id.
router.get("/open-po", WRITE, openPo);
router.post("/refresh-po", WRITE, refreshPo);
router.post("/stock-addition", WRITE, createStockAddition);

router.get("/", requireView("engineeringStock"), list);
router.get("/:id", requireView("engineeringStock"), detail);
router.post("/", WRITE, createGoodsReceipt);
router.post("/:id/retry", WRITE, retry);

export default router;
