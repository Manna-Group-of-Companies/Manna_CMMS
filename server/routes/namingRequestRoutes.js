import express from "express";

import {
  list,
  detail,
  raise,
  update,
  decide,
  recordSap,
  options,
  retry,
} from "../controllers/namingRequestController.js";
import { protect, requireRole } from "../middleware/session.js";
import { requireView } from "../config/access.js";

const router = express.Router();

router.use(protect);

/**
 * The approval queue: maintenance, operations, the board and the Admin, plus
 * the store supervisor.
 *
 * The plant heads are off this list. Every naming request used to go to all
 * four of them as well, which is what made the queue meaningless - and since
 * the catalog is not split by plant, a plant head approving a name was
 * approving it for the whole group.
 */
router.get("/", requireView("itemNaming"), list);
// The SAP lists the form offers. Above /:id, or "options" is read as a request id.
router.get("/options", requireRole("Maintenance Manager"), options);
router.get("/:id", requireView("itemNaming"), detail);

// Creating an item is the Maintenance Manager's alone (decided 25 Sep 2026):
// they fill in the SAP fields and send it for approval.
router.post("/", requireRole("Maintenance Manager"), raise);
router.put("/:id", requireRole("Maintenance Manager"), update);
router.post("/:id/retry", requireRole("Maintenance Manager"), retry);

/**
 * Deciding is the VP Operations', with the Admin able to unblock a queue when
 * the VP is away. ERPNext's workflow allows the same two, so a request that
 * reached here another way would still be refused - the guard and the workflow
 * have to agree or one of them is decoration.
 *
 * Recording the SAP code stays the Admin's: it is a claim that the item now
 * exists in SAP, which is a different assertion from approving what it is
 * called.
 */
// 25 Sep 2026: the VP Operations approves or rejects; the Maintenance Manager
// may only Reopen a rejected request (checked per action in the repository).
// Approving queues the item for creation in SAP.
router.post("/:id/decide", requireRole("VP Operations", "Maintenance Manager"), decide);
router.post("/:id/sap", requireRole("Manager"), recordSap);

export default router;
