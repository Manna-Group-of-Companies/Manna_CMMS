import express from "express";
import {
  login,
  logout,
  me,
  bootstrap,
} from "../controllers/sessionController.js";
import { protect } from "../middleware/session.js";
import { loginRateLimit } from "../middleware/loginLimit.js";

const router = express.Router();

// Throttled exactly as the PIN login was. A password is a far larger keyspace
// than four digits, but it is also worth more, and an unthrottled login is an
// invitation to work through a list of staff email addresses.
router.post("/login", loginRateLimit, login);

router.use(protect);

router.post("/logout", logout);
router.get("/me", me);
router.get("/bootstrap", bootstrap);

export default router;
