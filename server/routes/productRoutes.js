import express from "express";
import {
  getProducts,
  getProductById,
  getCategories,
  getSubCategories,
  getUnits,
  createProduct,
  updateProduct,
  deleteProduct,
  getProductRooms,
  addStock,
  previewItemName,
  checkDuplicates,
  getSapPending,
  updateSapStatus,
} from "../controllers/productController.js";
import { protect, requireRole } from "../middleware/session.js";
import { requireView } from "../config/access.js";

const router = express.Router();

/**
 * Not yet moved off MongoDB.
 *
 * The reads below come from ERPNext; these writes still expect a database that
 * is no longer there. Mounted with an honest refusal rather than left to fail
 * on a dead connection, because "Not authorized" or a stack trace would send
 * whoever hit it looking for a permission problem that does not exist.
 */
const notYetMoved = (what) => (_req, res) =>
  res.status(501).json({
    message: `${what} has not been moved to ERPNext yet. Do it in ERPNext directly for now.`,
  });

/**
 * The catalog is open to every signed-in role.
 *
 * It is one catalog rather than four on purpose — a plant head reads it to
 * find out which site holds a spare. What a plant head sees is nevertheless
 * their own site's shelves alone: the confinement is applied in the
 * controller, against the signed-in user, so it is not a filter a caller can
 * decline to send.
 *
 * The same endpoint serves Low Stock, whose audience is narrower. The
 * difference is a query parameter rather than a route, so the narrowing is
 * enforced on the screen rather than here; widening this to the Low Stock
 * audience would take Engineering Stock away from everyone else.
 */
router.use(protect, requireView("engineeringStock"));

router.get("/", getProducts);
router.get("/categories", getCategories);
router.get("/subcategories", getSubCategories);
router.get("/units", getUnits);

// The intake checks. All three are named routes and must stay above "/:id",
// or Express hands "duplicates" to getProductById as an id.
router.post("/name-preview", previewItemName);
router.get("/duplicates", notYetMoved("The duplicate check"));
router.get("/sap-pending", notYetMoved("The SAP hand-off queue"));

router.post("/", requireRole("Manager"), createProduct);

router.get("/:id", getProductById);
router.get("/:id/rooms", getProductRooms);
router.post("/:id/stock-in", notYetMoved("Adding stock"));
router.put("/:id/sap", requireRole("Manager"), notYetMoved("Setting the SAP code"));
router.put("/:id", requireRole("Manager", "Supervisor"), notYetMoved("Editing an item"));
router.delete("/:id", requireRole("Manager"), deleteProduct);

export default router;
