import express from "express";
import {
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} from "../controllers/notificationController.js";
import { protect, authorizeRoles } from "../middleware/auth.js";

const router = express.Router();

// Site-wide traffic is Admin-only; Supervisor and Branch accounts are scoped
// to notifications addressed to them, which the controller enforces.
router.use(protect, authorizeRoles("Admin", "Supervisor", "Branch"));

router.get("/", getNotifications);
router.put("/read-all", markAllNotificationsRead);
router.put("/:id/read", markNotificationRead);

export default router;
