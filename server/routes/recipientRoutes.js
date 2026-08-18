import express from "express";
import {
  getRecipients,
  createRecipient,
  updateRecipient,
  deleteRecipient,
} from "../controllers/recipientController.js";
import { protect, authorizeRoles } from "../middleware/auth.js";

const router = express.Router();

router.use(protect);

// Anyone signed in reads the list — it is what the issue form offers.
router.get("/", getRecipients);

// Only the Admin decides who is on it.
router.post("/", authorizeRoles("Admin"), createRecipient);
router.put("/:id", authorizeRoles("Admin"), updateRecipient);
router.delete("/:id", authorizeRoles("Admin"), deleteRecipient);

export default router;
