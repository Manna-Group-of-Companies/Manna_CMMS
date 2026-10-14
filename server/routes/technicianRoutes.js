import express from "express";

import { list, add, update, resign, reinstate } from "../controllers/technicianController.js";
import { protect, requireRole } from "../middleware/session.js";
import { requireView } from "../config/access.js";

const router = express.Router();

router.use(protect);

/**
 * Reading follows the breakdown screens: the crew rows on a breakdown offer
 * these names, so anyone who can work a breakdown has to be able to read them.
 * Keeping the register is the Maintenance Manager's alone - it decides who may
 * be named on a repair, which is a maintenance judgement, not the plant's.
 */
const KEEP = requireRole("Maintenance Manager");

router.get("/", requireView("breakdowns"), list);
router.post("/", KEEP, add);
router.put("/:id", KEEP, update);
router.post("/:id/resign", KEEP, resign);
router.post("/:id/reinstate", KEEP, reinstate);

export default router;
