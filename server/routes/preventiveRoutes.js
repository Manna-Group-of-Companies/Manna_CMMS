import express from "express";

import {
  list,
  coverage,
  frequencies,
  detail,
  create,
  update,
  addPoint,
  copy,
  remove,
} from "../controllers/preventiveController.js";
import { protect, requireRole } from "../middleware/session.js";
import { requireView } from "../config/access.js";

const router = express.Router();

router.use(protect);

/**
 * Everyone signed in may read a checklist, and print one.
 *
 * A production manager handing a daily round to an operator should not have to
 * ask maintenance to print it for them — that is exactly the friction that ends
 * with the sheet living in somebody's drawer as a Word file.
 */
const READ = requireView("preventive");

/**
 * Writing is maintenance's.
 *
 * The Manager keeps write access because somebody has to be able to fix a
 * checklist when maintenance is away, which is the same rule the asset register
 * uses.
 */
const WRITE = requireRole("Manager", "Maintenance Manager");

// Before /:id, or these are read as checklist ids.
router.get("/coverage", READ, coverage);
router.get("/frequencies", READ, frequencies);

router.get("/", READ, list);
router.post("/", WRITE, create);
router.get("/:id", READ, detail);
router.put("/:id", WRITE, update);
router.post("/:id/points", WRITE, addPoint);
router.post("/:id/copy", WRITE, copy);
router.delete("/:id", WRITE, remove);

export default router;
