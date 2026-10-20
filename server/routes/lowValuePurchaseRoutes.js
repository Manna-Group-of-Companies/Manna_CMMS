import express from "express";

import { list, options, detail, add, edit, addImage, removeImage } from "../controllers/lowValuePurchaseController.js";
import { protect } from "../middleware/session.js";
import { requireView } from "../config/access.js";

const router = express.Router();

router.use(protect);

// Everyone with the screen reads every company's rows and adds rows. Which
// columns of a row each person may then change is decided per row in
// repository/lowValuePurchases.js (`editableFields`).
const VIEW = requireView("lowValuePurchases");

router.get("/", VIEW, list);
// Before /:id, or "options" is read as a row number.
router.get("/options", VIEW, options);
router.get("/:id", VIEW, detail);
router.post("/", VIEW, add);
router.put("/:id", VIEW, edit);
router.post("/:id/files", VIEW, addImage);
router.delete("/:id/files/:fileId", VIEW, removeImage);

export default router;
