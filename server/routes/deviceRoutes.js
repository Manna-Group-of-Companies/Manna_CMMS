import express from "express";

import { register, unregister } from "../controllers/deviceController.js";
import { protect } from "../middleware/session.js";

const router = express.Router();

// Any signed-in role may register; which roles are actually rung is decided
// where the push is sent (PUSH_ROLE in integrations/push.js), and the app
// only registers the phones of that role in the first place.
router.use(protect);

router.put("/", register);
router.delete("/:token", unregister);

export default router;
