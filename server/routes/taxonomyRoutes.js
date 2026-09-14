import express from "express";

import { tree, add, rename, move, remove } from "../controllers/taxonomyController.js";
import { protect, requireRole } from "../middleware/session.js";
import { requireView } from "../config/access.js";

const router = express.Router();

router.use(protect);

router.get("/", requireView("categories"), tree);

/**
 * Changing the tree re-points items and can merge two groups into one.
 *
 * The Maintenance Manager's alone. The Manager held this too until the screen
 * was taken off their menu — and leaving the write routes behind would have
 * been worse than either decision on its own: a role that cannot read the tree
 * but can still delete a group from it, through an API with no screen in front
 * of it to show what the deletion would take with it.
 *
 * Kept in step with `categories` in config/access.js. If the Manager is ever
 * given the screen back, they belong here again.
 */
const WRITE = requireRole("Maintenance Manager");

// Above /:name, or "rename" and "move" are read as group names.
router.put("/rename", WRITE, rename);
router.put("/move", WRITE, move);
router.post("/", WRITE, add);
router.delete("/:name", WRITE, remove);

export default router;
