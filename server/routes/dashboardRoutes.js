import express from "express";
import { getSupervisorOverview } from "../controllers/overviewController.js";
import { protect, requireRole } from "../middleware/session.js";

const router = express.Router();

/**
 * One endpoint, and it is not a dashboard any more.
 *
 * The web dashboards are gone — every role now lands on the first screen its
 * menu offers. `/admin` went with the screen it fed, because an endpoint whose
 * only caller has been deleted is one nobody will remember to keep working.
 *
 * `/supervisor` stays because the phone still calls it: the Settings screen in
 * the Flutter app reads this for its stock summary. It is a summary the app
 * asks for, not a page anybody opens, so removing it here would have broken a
 * build already in people's hands.
 *
 * The Branch dashboard went earlier, with the Branch role and the request flow
 * it served.
 */
router.get("/supervisor", protect, requireRole("Supervisor"), getSupervisorOverview);

export default router;
