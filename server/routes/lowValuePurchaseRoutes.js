import express from "express";

import { list, options, detail, raise, step } from "../controllers/lowValuePurchaseController.js";
import { protect } from "../middleware/session.js";
import { requireView } from "../config/access.js";

const router = express.Router();

router.use(protect);

// Everyone with the screen reads and raises (a plant head for their own
// plants). Who may order, receive, reject or withdraw a particular request is
// decided per record in repository/lowValuePurchases.js (`allowedSteps`).
const VIEW = requireView("lowValuePurchases");

router.get("/", VIEW, list);
// Before /:id, or "options" is read as a request number.
router.get("/options", VIEW, options);
router.get("/:id", VIEW, detail);
router.post("/", VIEW, raise);
router.post("/:id/:step", VIEW, step);

export default router;
