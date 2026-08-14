import express from "express";
import {
  getAdminDashboard,
  getSupervisorDashboard,
  getBranchDashboard,
} from "../controllers/dashboardController.js";
import { protect, authorizeRoles } from "../middleware/auth.js";

const router = express.Router();

router.get("/admin", protect, authorizeRoles("Admin"), getAdminDashboard);
router.get("/supervisor", protect, authorizeRoles("Supervisor"), getSupervisorDashboard);
router.get("/branch", protect, authorizeRoles("Branch"), getBranchDashboard);

export default router;
