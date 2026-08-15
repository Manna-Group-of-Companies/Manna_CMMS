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
import { loginRateLimit } from "../middleware/loginLimit.js";

const router = express.Router();

// The only route that stays public, so it is the only one that can be
// hammered. A four-digit PIN is short enough that it has to be throttled.
router.post("/login", loginRateLimit, loginUser);
router.get("/me", protect, getMe);

// Accounts and their PINs are an admin's job: there is no self sign-up.
router.post("/register", protect, authorizeRoles("Admin"), registerUser);
router.get("/users", protect, authorizeRoles("Admin"), listUsers);
router.put("/users/:id/pin", protect, authorizeRoles("Admin"), setUserPin);
router.delete("/users/:id", protect, authorizeRoles("Admin"), deleteUser);

export default router;
