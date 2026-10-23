import { useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth, homePathFor } from "../context/AuthContext";
import Sidebar from "../components/Sidebar";
import Navbar from "../components/Navbar";
import { useErpRefreshFallback } from "../hooks/useErpRefresh";

/**
 * The Branch portal: one room's stock, read-only.
 *
 * Everything a Branch account can reach lives under this layout, so the role
 * check here is the only gate the client needs — the API refuses the other
 * roles' endpoints regardless.
 */
const BranchLayout = () => {
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
          <span className="text-sm font-medium text-slate-600">Loading branch session...</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (user.role !== "Branch") {
    return <Navigate to={homePathFor(user.role)} replace />;
  }

  const roomName = user.stockRoom?.name || "Branch";
  const pageTitle = location.pathname.includes("/requests")
    ? `${roomName} — My Engineering Stock Requests`
    : `${roomName} Stock`;

  return (
    <div className="min-h-dvh bg-canvas flex">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      {/* Sidebar Navigation */}
      <Sidebar open={menuOpen} onClose={() => setMenuOpen(false)} />

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col h-dvh overflow-hidden">
        <Navbar title={pageTitle} onMenuClick={() => setMenuOpen(true)} />
        <main id="main" tabIndex={-1} className="focus:outline-none flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 bg-canvas">
          <Outlet key={reloadKey} />
        </main>
      </div>
    </div>
  );
};

export default BranchLayout;
