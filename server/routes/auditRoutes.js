import express from "express";
import {
  openAudit,
  getAudits,
  getAudit,
  saveAuditCounts,
  addAuditLine,
  submitAudit,
  reviewAudit,
  reopenAudit,
  getAuditScoreboard,
} from "../controllers/auditController.js";
import { protect, authorizeRoles } from "../middleware/auth.js";

const router = express.Router();

// Supervisors walk the shelves and enter the count; the Admin reviews and
// reports on it. A Branch account is stock-only and takes no part in auditing.
router.use(protect, authorizeRoles("Admin", "Supervisor"));

// The scoreboard. Registered before "/:id" so "scoreboard" is not read as an
// audit id.
router.get("/scoreboard", getAuditScoreboard);

router.route("/").get(getAudits).post(openAudit);

router.get("/:id", getAudit);
router.route("/:id/lines").put(saveAuditCounts).post(addAuditLine);
router.post("/:id/submit", submitAudit);

// Signing a count off, and putting a mis-submitted one back, are the Admin's.
router.post("/:id/review", authorizeRoles("Admin"), reviewAudit);
router.post("/:id/reopen", authorizeRoles("Admin"), reopenAudit);

export default router;
