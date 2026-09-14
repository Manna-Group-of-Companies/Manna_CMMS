import express from "express";
import {
  getErpStatus,
  getErpFailures,
  retryErpJob,
  getErpDrift,
  checkErpDrift,
} from "../controllers/erpController.js";
import { protect, authorizeRoles } from "../middleware/auth.js";

const router = express.Router();

// The sync is plumbing, and only an Admin has any use for it.
router.use(protect, authorizeRoles("Admin"));

router.get("/status", getErpStatus);
router.get("/failures", getErpFailures);
router.put("/retry/:id", retryErpJob);

router.get("/drift", getErpDrift);
// Reads every balance on both sides, so POST rather than GET.
router.post("/drift", checkErpDrift);

export default router;
