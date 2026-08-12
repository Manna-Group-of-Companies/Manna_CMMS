import express from "express";
import { getAdminDashboard, getSupervisorDashboard } from "../controllers/dashboardController.js";
import { protect, authorizeRoles } from "../middleware/auth.js";

const router = express.Router();

router.get("/admin", protect, authorizeRoles("Admin"), getAdminDashboard);
router.get("/supervisor", protect, authorizeRoles("Supervisor"), getSupervisorDashboard);

export default router;
