import express from "express";

import {
  list,
  plants,
  detail,
  create,
  update,
  attach,
  detach,
  history,
  prevention,
  completePrevention,
} from "../controllers/assetController.js";
import { protect, requireRole } from "../middleware/session.js";
import { requireView } from "../config/access.js";

const router = express.Router();

router.use(protect);

// The register is worth reading for anyone signed in — a supervisor looking up
// which press a spare belongs to should not need permission. A plant head is
// confined to their own plant inside the controller.
const READ = requireView("assets");

// The machine's own details are the Maintenance Manager's. The Manager keeps
// write access because somebody has to be able to fix a record when they are
// away; a production manager reads them and no more.
const WRITE = requireRole("Manager", "Maintenance Manager");

/**
 * Attachments are looser than the record itself.
 *
 * A production manager who has the manual for their own press should be able to
 * put it on the machine without asking maintenance to do it for them. Adding a
 * file cannot corrupt the record; editing its rated load can.
 */
const ATTACH = requireRole("Manager", "Maintenance Manager", "Production Manager");

// Before /:id, or "plants" is read as a machine code.
router.get("/plants", READ, plants);

router.get("/", READ, list);
router.post("/", WRITE, create);
router.get("/:id", READ, detail);
router.put("/:id", WRITE, update);
router.get("/:id/history", READ, history);

/**
 * The preventive side of a machine: its checklists, and what was changed after
 * each failure. Read by anybody who reads the register.
 *
 * Ticking an action off is maintenance's, because it is a claim that the change
 * was actually made — the same reasoning that keeps the machine's own figures
 * behind WRITE.
 */
router.get("/:id/prevention", READ, prevention);
router.put("/:id/prevention/:breakdown/:action", WRITE, completePrevention);

// Drawings, manuals, specifications — and the component document, which is what
// replaced the component list.
router.post("/:id/files", ATTACH, attach);
router.delete("/:id/files/:fileId", ATTACH, detach);

export default router;
