import express from "express";

import {
  list,
  detail,
  raise,
  update,
  decide,
  recordSap,
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
router.get("/:id", requireView("itemNaming"), detail);

// Naming is the Maintenance Manager's job. The Manager can raise one too -
// refusing them would only mean asking somebody else to type it.
router.post("/", requireRole("Manager", "Maintenance Manager"), raise);
router.put("/:id", requireRole("Manager", "Maintenance Manager"), update);

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
router.post("/:id/decide", requireRole("Manager", "VP Operations"), decide);
router.post("/:id/sap", requireRole("Manager"), recordSap);

export default router;
