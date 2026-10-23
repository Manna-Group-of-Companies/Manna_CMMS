import { useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth, homePathFor, canSeeSupervisorConsole } from "../context/AuthContext";
import Sidebar from "../components/Sidebar";
import Navbar from "../components/Navbar";
import { useErpRefreshFallback } from "../hooks/useErpRefresh";

/**
 * The routes both consoles serve, under the same names.
 *
 * Only these can be carried across when somebody who no longer belongs in this
 * console arrives with an old link. The rest — the Red Stock Room, the branch
 * approvals, the monthly count — are the store supervisor's alone and have no
 * counterpart to send them to.
 */
const SHARED_WITH_CONSOLE = [
  "/products",
  "/goods-receipts",
  "/purchase-requests",
  "/assets",
  "/electrical",
  "/categories",
  "/settings",
  "/breakdowns",
  "/maintenance-requests",
  "/preventive",
];

/** The store screens SAP is behind - the same rule as the shared console. */
const SAP_SYNC_PATHS = [
  "/supervisor/products",
  "/supervisor/goods-receipts",
  "/supervisor/purchase-requests",
  "/supervisor/settings",
];

const SupervisorLayout = () => {
  const { user, loading } = useAuth();
  const location = useLocation();
  // The sidebar is a drawer below lg; this is what opens it.
  const [menuOpen, setMenuOpen] = useState(false);
  // Refresh on a screen with no reload of its own remounts it, so every view
  // offers the top bar's Refresh (23 Oct 2026).
  const [reloadKey, setReloadKey] = useState(0);
  useErpRefreshFallback(() => setReloadKey((k) => k + 1));

  if (loading) {
    return (
      <div className="min-h-dvh bg-canvas text-slate-900 flex items-center justify-center">
        <div role="status" className="flex flex-col items-center gap-3">
          <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-brand-500" aria-hidden="true"></div>
          <span className="text-sm font-medium text-slate-600">Loading supervisor session...</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (!canSeeSupervisorConsole(user.role)) {
    /**
     * Everybody but the store supervisor works in the shared console now.
     *
     * The maintenance manager and the plant heads used to work here, and the
     * screens they used still exist under /admin under the same names — so an
     * old bookmark is carried across to the page it named rather than dropped
     * on the catalog, which is what a redirect to their home would do.
     */
    const sub = location.pathname.replace(/^\/supervisor/, "");
    const target = SHARED_WITH_CONSOLE.includes(sub) ? `/admin${sub}` : homePathFor(user.role);
    return <Navigate to={target} replace />;
  }

  const getPageTitle = () => {
    const path = location.pathname;
    if (path.includes("/dashboard")) return "Dashboard";
    if (path.includes("/products")) return "Browse Engineering Stock Catalog";
    if (path.includes("/goods-receipts")) return "Goods Receipts";
    if (path.includes("/purchase-requests")) return "Purchase Requests";
    if (path.includes("/audit")) return "Monthly Stock Audit";
    if (path.includes("/returns")) return "Red Stock Room";
    if (path.includes("/breakdowns")) return "Breakdowns";
    if (path.includes("/maintenance-requests")) return "Maintenance Requests";
    if (path.includes("/preventive")) return "Preventive Maintenance";
    if (path.includes("/assets")) return "Asset Management";
    if (path.includes("/settings") || path.includes("/categories")) return "Settings";
    return "Supervisor Stock Manager";
  };

  return (
    <div className="min-h-dvh bg-canvas flex">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      {/* Sidebar Navigation */}
      <Sidebar open={menuOpen} onClose={() => setMenuOpen(false)} />

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col h-dvh overflow-hidden">
        <Navbar
          title={getPageTitle()}
          onMenuClick={() => setMenuOpen(true)}
          sapSync={SAP_SYNC_PATHS.some((p) => location.pathname.startsWith(p))}
        />
        <main id="main" tabIndex={-1} className="focus:outline-none flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 bg-canvas">
          <Outlet key={reloadKey} />
        </main>
      </div>
    </div>
  );
};

export default SupervisorLayout;
