import express from "express";
import {
  recordDisposal,
  getDisposals,
  getScrapSummary,
} from "../controllers/disposalController.js";
import { protect, authorizeRoles } from "../middleware/auth.js";

const router = express.Router();

// Supervisors action the items they issued; the Admin can close out anything.
// Branch accounts are stock-only and take no part in issuing or disposal.
router.post("/", protect, authorizeRoles("Admin", "Supervisor"), recordDisposal);

// The scrap value report. Registered before "/" so "scrap-summary" is not
// swallowed by a later parameterised route on the same router.
router.get(
  "/scrap-summary",
  protect,
  authorizeRoles("Admin", "Supervisor"),
  getScrapSummary
);

// The consumption and scrap logs, filtered by ?type=.
router.get("/", protect, authorizeRoles("Admin", "Supervisor"), getDisposals);

export default router;
