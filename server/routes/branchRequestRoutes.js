import express from "express";
import {
  createBranchRequest,
  getMyBranchRequests,
  getBranchRequests,
  adminDecideBranchRequest,
  supervisorDecideBranchRequest,
  cancelBranchRequest,
} from "../controllers/branchRequestController.js";
import { protect, authorizeRoles } from "../middleware/auth.js";

const router = express.Router();

router.use(protect);

// Branch: raise, follow and withdraw its own requests. Registered before "/"
// so "mine" is never read as a filter on the shared queue.
router.post("/", authorizeRoles("Branch"), createBranchRequest);
router.get("/mine", authorizeRoles("Branch"), getMyBranchRequests);
router.delete("/:id", authorizeRoles("Branch"), cancelBranchRequest);

// The queue is read by both approvers, so each can see the whole trail —
// including the stage the other is holding.
router.get("/", authorizeRoles("Admin", "Supervisor"), getBranchRequests);

// One stage each, in order.
router.put("/:id/admin", authorizeRoles("Admin"), adminDecideBranchRequest);
router.put("/:id/supervisor", authorizeRoles("Supervisor"), supervisorDecideBranchRequest);

export default router;
