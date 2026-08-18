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
  getAuditSchedule,
  getAuditLineTrail,
  getAuditVocabulary,
} from "../controllers/auditController.js";
import { protect, authorizeRoles } from "../middleware/auth.js";

const router = express.Router();

// Supervisors walk the shelves and enter the count; the Admin reviews and
// reports on it. A Branch account is stock-only and takes no part in auditing.
router.use(protect, authorizeRoles("Admin", "Supervisor"));

// The fixed paths go first, so "scoreboard" and the rest are not read as
// audit ids by the "/:id" route below.
router.get("/scoreboard", getAuditScoreboard);
// What the frequency schedule says a room owes this month, before a sheet for
// it exists.
router.get("/schedule", getAuditSchedule);
router.get("/vocabulary", getAuditVocabulary);

router.route("/").get(getAudits).post(openAudit);

router.get("/:id", getAudit);
router.route("/:id/lines").put(saveAuditCounts).post(addAuditLine);
// What the ledger says happened to one line since it was last counted.
router.get("/:id/lines/:lineId/trail", getAuditLineTrail);
router.post("/:id/submit", submitAudit);

// Signing a count off, and putting a mis-submitted one back, are the Admin's.
router.post("/:id/review", authorizeRoles("Admin"), reviewAudit);
router.post("/:id/reopen", authorizeRoles("Admin"), reopenAudit);

export default router;
