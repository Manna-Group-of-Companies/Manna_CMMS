import express from "express";

import { protect, requireRole } from "../middleware/session.js";
import { STORES } from "../integrations/erpnext/stores.js";

const router = express.Router();

/**
 * The companies stock is kept in.
 *
 * Served from the store definitions rather than from a database. They were
 * MongoDB records once, and every picker in the console reads this endpoint —
 * which is why the "Home Company" dropdown came up empty once MongoDB went:
 * the client hook swallows a failure and renders an empty list, so a dead
 * route looked like a configuration nobody had filled in.
 *
 * `_id` is kept in the shape because the pickers key their options on it. It
 * is the store key now, which is stable and readable, rather than an ObjectId
 * that no longer exists.
 */
const listStores = (_req, res) =>
  res.json(
    STORES.map((store) => ({
      _id: store.key,
      name: store.label,
      warehouse: store.warehouse,
      isMain: Boolean(store.isMain),
    }))
  );

/** Not yet moved off MongoDB — refused plainly rather than left to fail. */
const notYetMoved = (what) => (_req, res) =>
  res.status(501).json({
    message: `${what} has not been moved to ERPNext yet. Do it in ERPNext directly for now.`,
  });

router.use(
  protect,
  requireRole("Manager", "Maintenance Manager", "Supervisor", "Production Manager")
);

router.get("/", listStores);
router.get("/inventory", notYetMoved("The per-company stock view"));
router.get("/products/:productId", notYetMoved("The per-company breakdown"));
router.post("/transfer", requireRole("Manager"), notYetMoved("Transferring stock"));
router.put("/inventory", requireRole("Manager"), notYetMoved("Correcting a balance"));

export default router;
