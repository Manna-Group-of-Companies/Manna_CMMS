import Product from "../models/Product.js";

// @desc    Get all products with search and filtering
// @route   GET /api/products
// @access  Private (Both Admin and Supervisor)
export const getProducts = async (req, res) => {
  try {
    const { search, category, storeRoom, stockStatus } = req.query;

    let query = {};

    // Search query
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { brand: { $regex: search, $options: "i" } },
        { code: { $regex: search, $options: "i" } },
        { supplier: { $regex: search, $options: "i" } },
      ];
    }

    // Exact filters
    if (category) {
      query.category = category;
    }

    if (storeRoom) {
      query.storeRoom = storeRoom;
    }

    // Stock level filtering
    if (stockStatus === "low") {
      // quantity <= minStock
      query.$expr = { $lte: ["$quantity", "$minStock"] };
    } else if (stockStatus === "out") {
      query.quantity = 0;
    }

    const products = await Product.find(query).sort({ updatedAt: -1 });
    res.json(products);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get product by ID
// @route   GET /api/products/:id
// @access  Private
export const getProductById = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);

    if (product) {
      res.json(product);
    } else {
      res.status(404).json({ message: "Product not found" });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get all unique categories
// @route   GET /api/products/categories
// @access  Private
export const getCategories = async (req, res) => {
  try {
    const categories = await Product.distinct("category");
    res.json(categories);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
