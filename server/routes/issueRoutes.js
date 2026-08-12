import express from "express";
import { issueProduct, getIssueHistory, returnIssueProduct } from "../controllers/issueController.js";
import { protect, authorizeRoles } from "../middleware/auth.js";

const router = express.Router();

// Supervisor: Issue a product (direct stock decrement)
router.post("/", protect, authorizeRoles("Supervisor"), issueProduct);

// Both Admin and Supervisor: View issue history
router.get("/", protect, getIssueHistory);

// Supervisor: Return an issued product
router.put("/:id/return", protect, authorizeRoles("Supervisor"), returnIssueProduct);

export default router;
