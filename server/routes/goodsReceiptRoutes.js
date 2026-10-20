import express from "express";

import {
  list,
  detail,
  openPo,
  refreshPo,
  createGoodsReceipt,
  createStockAddition,
  retry,
  remove,
  resendHsn,
  correctHsn,
} from "../controllers/goodsReceiptController.js";
import { protect, requireRole } from "../middleware/session.js";
import { requireView } from "../config/access.js";

const router = express.Router();

router.use(protect);

// Reading follows the Engineering Stock screen; receiving is the Maintenance
// Manager's alone, as adding and editing items is (decided 9 Oct 2026).
// Maintenance, and since 14 Oct 2026 the plant heads, who receive their own
// deliveries and add their own stock.
const WRITE = requireRole("Maintenance Manager", "Production Manager");
// Untangling what SAP refused, and taking a receipt back, is maintenance's
// alone (20 Oct 2026).
const MAINTENANCE = requireRole("Maintenance Manager");

// Above /:id, or "open-po" is read as a receipt id.
router.get("/open-po", WRITE, openPo);
router.post("/refresh-po", WRITE, refreshPo);
router.post("/stock-addition", WRITE, createStockAddition);
router.post("/hsn-requests/:id/retry", MAINTENANCE, resendHsn);
router.put("/hsn-requests/:id", MAINTENANCE, correctHsn);

router.get("/", requireView("goodsReceipts"), list);
router.get("/:id", requireView("goodsReceipts"), detail);
router.post("/", WRITE, createGoodsReceipt);
router.post("/:id/retry", WRITE, retry);
router.delete("/:id", MAINTENANCE, remove);

export default router;
