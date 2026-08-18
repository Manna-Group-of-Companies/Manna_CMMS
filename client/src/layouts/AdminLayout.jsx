import { useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth, homePathFor } from "../context/AuthContext";
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
          <span className="text-sm font-medium text-slate-600">Loading admin session...</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (user.role !== "Admin") {
    // Anyone else belongs in their own portal, not on the login screen.
    return <Navigate to={homePathFor(user.role)} replace />;
  }

  // Title and one-line context for the bar above the page. Every admin route
  // has an entry so none of them falls back to a heading meant for another.
  const PAGE_META = [
    ["/admin/dashboard", "Dashboard", "Stock, requests and alerts at a glance"],
    ["/admin/products", "Engineering Stock", "The catalog and what is on the shelves"],
    ["/admin/requests", "Request Control", "Approve, reject or hold supervisor requests"],
    ["/admin/issues", "Issue History", "Every engineering stock item issued, by every supervisor"],
    ["/admin/scrap", "Scrap & Consumption", "Value written off across the stores"],
    ["/admin/audits", "Stock Audits", "Monthly counts, the score each store room earned, and the history"],
    ["/admin/sap-handoff", "SAP Hand-off", "Names waiting to be created in SAP"],
    ["/admin/branch-requests", "Branch Requests", "First-stage approval for branch orders"],
    ["/admin/users", "Users & PINs", "Accounts and the PINs they sign in with"],
  ];

  const [, title, subtitle] =
    PAGE_META.find(([path]) => location.pathname.startsWith(path)) || [
      "",
      "Stock Master Control",
      "",
    ];

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
