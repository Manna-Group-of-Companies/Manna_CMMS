import express from "express";

import {
  list,
  detail,
  raise,
  act,
  stages,
  attach,
  detach,
  verify,
} from "../controllers/maintenanceRequestController.js";
import { protect, requireRole } from "../middleware/session.js";
import { requireView } from "../config/access.js";

const router = express.Router();

// A plant head is confined to their own plant inside the controller.
router.use(protect, requireView("maintenanceRequests"));

// Before /:id, or "stages" is read as a request id.
router.get("/stages", stages);

// Raising is open to every signed-in role, on the same reasoning that lets
// anybody report a breakdown. Who may *work* a request and who may *close* one
// is decided per stage, against the signed-in user — see
// maintenanceRequestStages.js, which holds the rule the workflow cannot express.
router.get("/", list);
router.post("/", raise);
router.get("/:id", detail);
router.post("/:id/action", act);

// The signed log sheet. Maintenance attaches it; only the Manager confirms he
// has read it, which is the whole point of the confirmation.
router.post("/:id/files", requireRole("Manager", "Maintenance Manager"), attach);
router.delete("/:id/files/:fileId", requireRole("Manager", "Maintenance Manager"), detach);
router.post("/:id/verify", requireRole("Manager"), verify);

export default router;
