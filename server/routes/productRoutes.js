import express from "express";
import { getProducts, getProductById, getCategories } from "../controllers/productController.js";
import { protect } from "../middleware/auth.js";

const router = express.Router();

router.get("/", protect, getProducts);
router.get("/categories", protect, getCategories);
router.get("/:id", protect, getProductById);

export default router;
