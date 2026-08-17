import express from "express";
import {
  getProducts,
  getProductById,
  getCategories,
  getSubCategories,
  createProduct,
  updateProduct,
  deleteProduct,
  getProductRooms,
  previewItemName,
  checkDuplicates,
  getSapPending,
  updateSapStatus,
} from "../controllers/productController.js";
import { protect, authorizeRoles } from "../middleware/auth.js";

const router = express.Router();

// The catalog is a whole-company view. A Branch account only ever sees the
// stock sitting in its own room, so it is kept out of every route here.
router.use(protect, authorizeRoles("Admin", "Supervisor"));

router.get("/", getProducts);
router.get("/categories", getCategories);
router.get("/subcategories", getSubCategories);

// The intake checks. All three are named routes and must stay above "/:id",
// or Express hands "duplicates" to getProductById as an id.
//
// A supervisor drafting an ADD request needs the same naming help and the same
// duplicate warning as the Admin creating the product outright, so these are
// open to both roles. Only the creates and deletes below are Admin-only.
router.post("/name-preview", previewItemName);
router.get("/duplicates", checkDuplicates);
router.get("/sap-pending", getSapPending);

// Creating a catalog item is Admin-only; a supervisor raises an ADD request,
// which is the one request left in the flow.
router.post("/", authorizeRoles("Admin"), createProduct);

router.get("/:id", getProductById);
router.get("/:id/rooms", getProductRooms);
router.put("/:id/sap", authorizeRoles("Admin"), updateSapStatus);
// An edit is saved straight to the product — supervisors no longer raise an
// EDIT request for it. Quantity is the exception: only an Admin may set it from
// here, because stock still comes in through a Stock In request (see
// updateProduct).
router.put("/:id", authorizeRoles("Admin", "Supervisor"), updateProduct);
router.delete("/:id", authorizeRoles("Admin"), deleteProduct);

export default router;
