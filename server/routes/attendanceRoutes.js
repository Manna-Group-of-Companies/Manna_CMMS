import express from "express";

import {
  APPROVER_ROLES,
  applyLeave,
  decideLeave,
  decideRegularization,
  managerLeaveEntry,
  me,
  memberLeave,
  members,
  month,
  myLeave,
  pendingLeave,
  pendingRegularizations,
  punchIn,
  punchOut,
  requestRegularization,
  setScheme,
} from "../controllers/attendanceController.js";
import { protect, requireRole } from "../middleware/session.js";
import { MAINTENANCE_MEMBER, requireView } from "../config/access.js";

const router = express.Router();

// Who sees the screen at all is the matrix. Within it, a punch and a request
// are a member's own acts and a decision is a manager's; neither side gets the
// other's buttons, so neither gets the other's routes.
router.use(protect, requireView("attendance"));

const SELF = requireRole(MAINTENANCE_MEMBER);
const APPROVE = requireRole(...APPROVER_ROLES);

router.get("/me", me);
router.get("/month", month);

router.post("/punch-in", SELF, punchIn);
router.post("/punch-out", SELF, punchOut);

router.post("/regularizations", SELF, requestRegularization);
router.get("/regularizations/pending", APPROVE, pendingRegularizations);
router.post("/regularizations/:id/decide", APPROVE, decideRegularization);

// Before /leave/:id, or "pending" and "manager-entry" are read as ids.
router.get("/leave", SELF, myLeave);
router.post("/leave", SELF, applyLeave);
router.get("/leave/pending", APPROVE, pendingLeave);
router.post("/leave/manager-entry", APPROVE, managerLeaveEntry);
router.post("/leave/:id/decide", APPROVE, decideLeave);

router.get("/members", APPROVE, members);
router.get("/members/:email/leave", APPROVE, memberLeave);
router.put("/members/:email/scheme", APPROVE, setScheme);

export default router;
