import StockMovement from "../models/StockMovement.js";

/**
 * @desc    Stock movement ledger, newest first
 * @route   GET /api/movements?product=<id>&type=MERGE_IN&limit=100
 * @access  Private (Admin)
 */
export const getStockMovements = async (req, res) => {
  try {
    const query = {};
    const { product, type } = req.query;

    if (product) query.product = product;
    if (type && type !== "All") query.type = type;

    const limit = Math.min(Number(req.query.limit) || 200, 500);

    const movements = await StockMovement.find(query)
      .populate("performedBy", "name email role")
      .sort({ createdAt: -1 })
      .limit(limit);

    res.json(movements);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
