import express from "express";
import {
  createMergeRequest,
  createWeeklyMergeRequest,
  createSupervisorMergeRequest,
  confirmSupervisorMerge,
  getMyMergeRequests,
  getWeeklyMergeStatus,
  getMergeRequests,
  getMergeHistory,
  getMergeRequestById,
  approveMergeRequest,
  rejectMergeRequest,
} from "../controllers/mergeController.js";
import { protect, authorizeRoles } from "../middleware/auth.js";

const router = express.Router();

router.use(protect);

// A Supervisor may merge the Red Stock Room — any return, not only the ones
// they booked in — and that merge is applied to the main store room as it is
// posted, with no Admin approval in it. Registered before the Admin guard, and
// before "/:id" so "mine" is not read as an id.
router
  .route("/mine")
  .post(authorizeRoles("Supervisor"), createSupervisorMergeRequest)
  .get(authorizeRoles("Supervisor"), getMyMergeRequests);

// Clears a supervisor merge that an interim build left sitting Pending
// Approval, whoever raised it. Current clients merge in one call and never
// reach this.
router.post("/:id/confirm", authorizeRoles("Supervisor"), confirmSupervisorMerge);

// Every other merge operation is Admin-only.
router.use(authorizeRoles("Admin"));

// The weekly ritual: where this week stands, and running it.
router.get("/weekly/status", getWeeklyMergeStatus);
router.post("/weekly", createWeeklyMergeRequest);

router.route("/").post(createMergeRequest).get(getMergeRequests);
// Everything a merge has actually put on a shelf, line by line. Ahead of
// "/:id" so "history" is not read as an id.
router.get("/history", getMergeHistory);

router.get("/:id", getMergeRequestById);
router.put("/:id/approve", approveMergeRequest);
router.put("/:id/reject", rejectMergeRequest);

export default router;
