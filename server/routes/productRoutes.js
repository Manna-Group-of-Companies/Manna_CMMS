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
} from "../controllers/productController.js";
import { protect, authorizeRoles } from "../middleware/auth.js";

const router = express.Router();

// The catalog is a whole-company view. A Branch account only ever sees the
// stock sitting in its own room, so it is kept out of every route here.
router.use(protect, authorizeRoles("Admin", "Supervisor"));

router.get("/", getProducts);
router.get("/categories", getCategories);
router.get("/subcategories", getSubCategories);

// Catalog writes are Admin-only; supervisors raise ADD/EDIT requests instead.
router.post("/", authorizeRoles("Admin"), createProduct);

router.get("/:id", getProductById);
router.get("/:id/rooms", getProductRooms);
router.put("/:id", authorizeRoles("Admin"), updateProduct);
router.delete("/:id", authorizeRoles("Admin"), deleteProduct);

export default router;
