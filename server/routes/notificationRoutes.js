import express from "express";

import { protect, requireRole } from "../middleware/session.js";

const router = express.Router();

/**
 * Notifications, currently none.
 *
 * They were MongoDB records written by the flows that have since moved or been
 * retired. Nothing generates one today, so this answers an empty list rather
 * than an error.
 *
 * That is not cosmetic. The console polls this endpoint on a timer, and while
 * it still went through the MongoDB middleware every poll spent ten seconds
 * waiting for a database that is not there before failing — a request slot and
 * a stack trace in the log every few seconds, for a feature that has nothing
 * to report.
 *
 * When notifications come back they will be built on what ERPNext already
 * knows — a breakdown waiting to be assessed, a naming request waiting on the
 * Manager — rather than on a table this system writes to itself.
 */
router.use(
  protect,
  requireRole("Manager", "Maintenance Manager", "Supervisor", "Production Manager")
);

router.get("/", (_req, res) => res.json([]));
router.put("/read-all", (_req, res) => res.json({ updated: 0 }));
router.put("/:id/read", (_req, res) => res.json({ updated: 0 }));

export default router;
