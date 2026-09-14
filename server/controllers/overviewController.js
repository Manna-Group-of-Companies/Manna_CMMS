import { listCatalog } from "../repository/catalog.js";
import { listBreakdowns } from "../repository/maintenance.js";

/**
 * The stock summary, served from ERPNext.
 *
 * This was the two web landing pages. They are gone — every role now lands on
 * the first screen its menu offers — and what is left is the one summary the
 * phone still asks for.
 *
 * Deliberately not the old `dashboardController`, which counts request,
 * merge and audit records in MongoDB. Those flows have not been moved yet —
 * and most of them were retired outright when the request flow was cut back to
 * item-name creation — so this serves what is real today rather than keeping
 * the whole page dark until everything else follows.
 *
 * Counts that belong to a flow which no longer exists are sent as zero, and
 * the tiles that showed them are gone from the screens. A number that cannot
 * be worked out yet is sent as zero too; where that would be read as a
 * finding rather than an absence, the screen says so instead.
 */

/** The stock picture both roles share. */
const stockOverview = async () => {
  const products = await listCatalog();
  const low = products.filter((p) => p.minStock > 0 && p.quantity <= p.minStock);

  return {
    totalProducts: products.length,
    lowStockProductsCount: low.length,
    // The worst first: what is furthest below its minimum is what somebody
    // should be ordering, not whatever happens to sort first alphabetically.
    lowStockProducts: low
      .slice()
      .sort((a, b) => a.quantity - a.minStock - (b.quantity - b.minStock))
      .slice(0, 10),
    outOfStockCount: products.filter((p) => p.quantity === 0).length,
    redStockCount: products.filter((p) => p.redStock > 0).length,
    totalUnits: Math.round(products.reduce((sum, p) => sum + p.quantity, 0) * 10) / 10,
  };
};

/** Breakdowns are Module 2 and already on ERPNext, so they are real numbers. */
const breakdownOverview = async () => {
  try {
    const open = await listBreakdowns({ open: true });
    return {
      openBreakdowns: open.length,
      unassessedBreakdowns: open.filter((b) => b.state === "Reported").length,
    };
  } catch {
    // A dashboard tile is not worth failing the whole page for.
    return { openBreakdowns: 0, unassessedBreakdowns: 0 };
  }
};

/**
 * Everything the old payload carried that has no source yet.
 *
 * Kept in the response so the screens render rather than throwing on an
 * undefined, and kept together here so it is obvious at a glance which numbers
 * are real and which are waiting on the rest of the move.
 */
const NOT_YET_MOVED = {
  pendingRequests: 0,
  approvedRequests: 0,
  rejectedRequests: 0,
  todayRequestsCount: 0,
  todayRequests: [],
  issuedTodayCount: 0,
  recentIssues: [],
  restockPendingCount: 0,
  restockPendingQuantity: 0,
  mergePendingCount: 0,
  recentRestockItems: [],
  branchPendingAdmin: 0,
  branchPendingSupervisor: 0,
};

/**
 * @desc    The stock summary the phone shows in Settings
 * @route   GET /api/dashboard/supervisor
 * @access  Private (Supervisor)
 *
 * `getAdminOverview` sat here too and is gone with the web dashboard it fed.
 * This one survives because it is not a page: the Flutter app reads it for the
 * summary on its Settings screen, and a build already in people's hands would
 * have started failing.
 */
export const getSupervisorOverview = async (_req, res) => {
  try {
    const [stock, breakdowns] = await Promise.all([stockOverview(), breakdownOverview()]);
    res.json({
      ...NOT_YET_MOVED,
      ...stock,
      ...breakdowns,
      // The supervisor page shows "mine" alongside the totals. Nothing records
      // who did what yet, so these stay at zero rather than showing the
      // store's totals as though one person had done all of it.
      myPendingRequests: 0,
      myApprovedRequests: 0,
      myRejectedRequests: 0,
      myIssuedTodayCount: 0,
      myRestockPendingCount: 0,
      todayActivity: [],
    });
  } catch (error) {
    res.status(502).json({ message: `Could not read from ERPNext: ${error.message}` });
  }
};
