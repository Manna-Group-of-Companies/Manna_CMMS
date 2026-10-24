import { useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth, homePathFor, canSeeAdminConsole } from "../context/AuthContext";
import Sidebar from "../components/Sidebar";
import Navbar from "../components/Navbar";
import { useErpRefreshFallback } from "../hooks/useErpRefresh";

const AdminLayout = () => {
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
          <span className="text-sm font-medium text-slate-600">Loading your session...</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (!canSeeAdminConsole(user.role)) {
    // The store supervisor belongs in the store console, not on the login
    // screen — and a role this build does not know belongs nowhere, which
    // homePathFor answers with the login.
    return <Navigate to={homePathFor(user.role)} replace />;
  }

  /**
   * Title and one-line context for the bar above the page.
   *
   * Every route in this console has an entry, so none of them falls back to a
   * heading meant for another. Matched by prefix, longest first, so
   * "/admin/breakdown-report" is not answered by "/admin/breakdowns".
   */
  const PAGE_META = [
    ["/admin/dashboard", "Dashboard", ""],
    ["/admin/breakdown-report", "Breakdown Report", "Downtime and reliability across the group"],
    ["/admin/breakdowns", "Breakdowns", ""],
    // No strapline: the screen is named plainly enough, and a sentence under
    // every title is a sentence nobody reads twice.
    ["/admin/maintenance-requests", "Maintenance Requests", ""],
    ["/admin/preventive", "Preventive Maintenance", "Checklists and what they are due on"],
    ["/admin/products", "Engineering Stock", "The catalog and what is on the shelves"],
    [
      "/admin/goods-receipts",
      "Goods Receipts",
      "Stock brought in, with or without a bill, and whether SAP has posted it",
    ],
    [
      "/admin/purchase-requests",
      "Purchase Requests",
      "Requests sent to SAP, and the purchase orders raised from them",
    ],
    [
      "/admin/purchase-quotations",
      "Purchase Quotations",
      "The chosen vendor's quotation for each request, printed for signature",
    ],
    ["/admin/purchase-orders", "Purchase Orders", "Made from quotations, and where each stands with SAP"],
    // Titled by the page itself (its header carries the date and time too), so
    // the bar above stays empty rather than saying it twice.
    ["/admin/low-value-purchases", "", ""],
    ["/admin/settings", "Settings", ""],
    [
      "/admin/low-stock",
      "Low Stock",
      "Every item at or below its minimum, and what refilling it takes",
    ],
    ["/admin/assets", "Asset Management", "The machine register and everything known about each"],
    ["/admin/electrical", "Electrical Systems", "Panels, supplies and what they feed"],
    ["/admin/scrap", "Scrap & Consumption", "Value written off across the stores"],
    [
      "/admin/audits",
      "Stock Audits",
      "Monthly counts, the score each store room earned, and the history",
    ],
    ["/admin/recipients", "Recipients", "Who stock may be issued to"],
    ["/admin/users", "Users & Passwords", "Accounts and the ERPNext roles they sign in with"],
  ];

  const [, title, subtitle] =
    PAGE_META.filter(([path]) => location.pathname.startsWith(path)).sort(
      (a, b) => b[0].length - a[0].length
    )[0] || ["", "Stock Master Control", ""];

  /**
   * The screens SAP is behind, and the only ones offered the sync.
   *
   * There is one sync for the whole system - it carries items, item groups,
   * goods receipts and purchase requests in one run - so the question each
   * screen answers is not "which sync" but "is any of what I show SAP's".
   * Breakdowns, assets, preventive maintenance and attendance are ERPNext's
   * alone; a run started from one of them would finish having changed nothing
   * the person was looking at, which reads as a sync that failed.
   */
  const SAP_SYNC_PATHS = [
    "/admin/products",
    "/admin/goods-receipts",
    "/admin/purchase-requests",
    "/admin/purchase-quotations",
    "/admin/purchase-orders",
    "/admin/low-stock",
    "/admin/settings",
  ];
  const onSapScreen = SAP_SYNC_PATHS.some((path) => location.pathname.startsWith(path));

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
          title={title}
          subtitle={subtitle}
          onMenuClick={() => setMenuOpen(true)}
          sapSync={onSapScreen}
        />
        <main id="main" tabIndex={-1} className="focus:outline-none flex-1 overflow-y-auto bg-canvas">
          {/* Capped so the tables do not stretch to the full width of a very
              wide monitor, which leaves the eye travelling across empty cells. */}
          <div className="mx-auto w-full max-w-[1600px] p-4 sm:p-6 lg:p-8">
            <Outlet key={reloadKey} />
          </div>
        </main>
      </div>
    </div>
  );
};

export default AdminLayout;
