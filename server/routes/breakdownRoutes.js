import express from "express";
import {
  list,
  detail,
  report,
  update,
  act,
  machines,
  plants,
  stages,
  lookups,
  reliabilityReport,
  attach,
  detach,
  verify,
} from "../controllers/breakdownController.js";
import { protect, requireRole } from "../middleware/session.js";
import { requireView } from "../config/access.js";

const router = express.Router();

// Who may *move* a breakdown on is decided by ERPNext's workflow, so there is
// nothing to duplicate at this layer. Who may see one at all is the matrix.
// A plant head sees only their own plant's, applied in the controller.
router.use(protect);

/**
 * Who may report one in the first place.
 *
 * Reporting used to be open to everyone the matrix let see the screen,
 * including the Maintenance Manager - which put the person meant to *fix* a
 * breakdown in a position to also *raise* one, and blurred the line between
 * the two. Reporting is the plant's own job: they are standing at the machine.
 * The Admin keeps it as a fallback, the same reasoning kept for every other
 * override in this file.
 */
const REPORT = requireRole("Manager", "Production Manager");

const READ = requireView("breakdowns");

// Before /:id, or "machines" is read as a breakdown id. The three lookups are
// read by the maintenance request screens too, whose audience is a subset of
// this one, so guarding them here does not shut that screen out.
router.get("/machines", READ, machines);
router.get("/stages", READ, stages);
router.get("/lookups", READ, lookups);
// Downtime and reliability across the group: operations, maintenance and the
// Admin. Narrower than the breakdown list itself, and deliberately so.
router.get("/report", requireView("breakdownReport"), reliabilityReport);
router.get("/plants", READ, plants);

router.get("/", READ, list);
router.post("/", READ, REPORT, report);
router.get("/:id", READ, detail);
router.put("/:id", READ, update);
router.post("/:id/action", READ, act);

// Attaching a file: the signed log sheet (maintenance's) and now a photo taken
// when a breakdown is reported (the plant's). Only the Manager confirms he has
// read the log sheet, which is the point of that separate confirmation.
router.post(
  "/:id/files",
  requireRole("Manager", "Maintenance Manager", "Production Manager"),
  attach
);
router.delete(
  "/:id/files/:fileId",
  requireRole("Manager", "Maintenance Manager", "Production Manager"),
  detach
);
router.post("/:id/verify", requireRole("Manager"), verify);

export default router;
