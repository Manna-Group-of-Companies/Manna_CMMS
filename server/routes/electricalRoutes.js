import express from "express";

import { list, detail, update, attach, detach } from "../controllers/electricalController.js";
import { protect, requireRole } from "../middleware/session.js";
import { requireView } from "../config/access.js";

const router = express.Router();

router.use(protect);

// The electrical portfolio is part of the asset register, and shares its
// audience. Plant confinement is applied in the controller.
const READ = requireView("assets");

// The supply details are the Maintenance Manager's.
const WRITE = requireRole("Manager", "Maintenance Manager");

// Attaching is looser, for the same reason it is on machines: a file cannot
// corrupt the record, and the person holding the drawing should not have to
// ask somebody else to upload it.
const ATTACH = requireRole("Manager", "Maintenance Manager", "Production Manager");

router.get("/", READ, list);
router.get("/:id", READ, detail);
router.put("/:id", WRITE, update);

// The installation document and anything else that belongs with it. Subsystems
// and their components were removed in favour of this.
router.post("/:id/files", ATTACH, attach);
router.delete("/:id/files/:fileId", ATTACH, detach);

export default router;
