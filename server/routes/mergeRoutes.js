import express from "express";
import {
  createMergeRequest,
  getMergeRequests,
  getMergeRequestById,
  approveMergeRequest,
  rejectMergeRequest,
} from "../controllers/mergeController.js";
import { protect, authorizeRoles } from "../middleware/auth.js";

const router = express.Router();

// Every merge operation is Admin-only.
router.use(protect, authorizeRoles("Admin"));

router.route("/").post(createMergeRequest).get(getMergeRequests);
router.get("/:id", getMergeRequestById);
router.put("/:id/approve", approveMergeRequest);
router.put("/:id/reject", rejectMergeRequest);

export default router;
