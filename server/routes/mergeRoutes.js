import express from "express";
import {
  createMergeRequest,
  createWeeklyMergeRequest,
  createSupervisorMergeRequest,
  confirmSupervisorMerge,
  getMyMergeRequests,
  getWeeklyMergeStatus,
  getMergeRequests,
  getMergeRequestById,
  approveMergeRequest,
  rejectMergeRequest,
} from "../controllers/mergeController.js";
import { protect, authorizeRoles } from "../middleware/auth.js";

const router = express.Router();

router.use(protect);

// A Supervisor may merge only their own returns. That merge shows a confirmation
// prompt first, then is applied directly to the main store room. Registered
// before the Admin guard, and before "/:id" so "mine" is not read as an id.
router
  .route("/mine")
  .post(authorizeRoles("Supervisor"), createSupervisorMergeRequest)
  .get(authorizeRoles("Supervisor"), getMyMergeRequests);

// Supervisor confirms their merge with the confirmation prompt
router.post("/:id/confirm", authorizeRoles("Supervisor"), confirmSupervisorMerge);

// Every other merge operation is Admin-only.
router.use(authorizeRoles("Admin"));

// The weekly ritual: where this week stands, and running it.
router.get("/weekly/status", getWeeklyMergeStatus);
router.post("/weekly", createWeeklyMergeRequest);

router.route("/").post(createMergeRequest).get(getMergeRequests);
router.get("/:id", getMergeRequestById);
router.put("/:id/approve", approveMergeRequest);
router.put("/:id/reject", rejectMergeRequest);

export default router;
