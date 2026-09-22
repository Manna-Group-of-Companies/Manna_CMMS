import { useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth, homePathFor, canSeeAdminConsole } from "../context/AuthContext";
import Sidebar from "../components/Sidebar";
import Navbar from "../components/Navbar";

const AdminLayout = () => {
  const { user, loading } = useAuth();
  const location = useLocation();
  // The sidebar is a drawer below lg; this is what opens it.
  const [menuOpen, setMenuOpen] = useState(false);

  if (loading) {
    return (
      <div className="min-h-screen bg-canvas text-slate-900 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-brand-500"></div>
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
    ["/admin/breakdown-report", "Breakdown Report", "Downtime and reliability across the group"],
    ["/admin/breakdowns", "Breakdowns", ""],
    // No strapline: the screen is named plainly enough, and a sentence under
    // every title is a sentence nobody reads twice.
    ["/admin/maintenance-requests", "Maintenance Requests", ""],
    ["/admin/preventive", "Preventive Maintenance", "Checklists and what they are due on"],
    ["/admin/products", "Engineering Stock", "The catalog and what is on the shelves"],
    ["/admin/categories", "Categories", "The category tree items are filed under"],
    [
      "/admin/low-stock",
      "Low Stock",
      "Every item at or below its minimum, and what refilling it takes",
    ],
    ["/admin/requests", "Item Naming", "Approve, reject or hold a proposed item name"],
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

  return (
    <div className="min-h-screen bg-canvas flex">
      {/* Sidebar Navigation */}
      <Sidebar open={menuOpen} onClose={() => setMenuOpen(false)} />

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col h-screen max-h-[100dvh] overflow-hidden">
        <Navbar title={title} subtitle={subtitle} onMenuClick={() => setMenuOpen(true)} />
        <main className="flex-1 overflow-y-auto bg-canvas">
          {/* Capped so the tables do not stretch to the full width of a very
              wide monitor, which leaves the eye travelling across empty cells. */}
          <div className="mx-auto w-full max-w-[1600px] p-4 sm:p-6 lg:p-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
};

export default AdminLayout;
