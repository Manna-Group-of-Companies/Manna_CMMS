import express from "express";
import {
  registerUser,
  loginUser,
  getMe,
  listUsers,
  setUserPin,
  deleteUser,
} from "../controllers/authController.js";
import { protect, authorizeRoles } from "../middleware/auth.js";

const router = express.Router();

router.post("/login", loginUser);
router.get("/me", protect, getMe);

// Accounts and their PINs are an admin's job: there is no self sign-up.
router.post("/register", protect, authorizeRoles("Admin"), registerUser);
router.get("/users", protect, authorizeRoles("Admin"), listUsers);
router.put("/users/:id/pin", protect, authorizeRoles("Admin"), setUserPin);
router.delete("/users/:id", protect, authorizeRoles("Admin"), deleteUser);

export default router;
