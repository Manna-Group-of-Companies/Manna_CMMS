import express from "express";
import {
  getCompanies,
  createCompany,
  updateCompany,
  setRoomCompany,
} from "../controllers/companyController.js";
import { protect, authorizeRoles } from "../middleware/auth.js";

const router = express.Router();

// Supervisors read the list for pickers and filters; only an Admin changes it,
// matching how stock rooms are governed.
router.use(protect, authorizeRoles("Admin", "Supervisor"));

router.get("/", getCompanies);

router.post("/", authorizeRoles("Admin"), createCompany);
router.put("/rooms/:roomId", authorizeRoles("Admin"), setRoomCompany);
router.put("/:id", authorizeRoles("Admin"), updateCompany);

export default router;
