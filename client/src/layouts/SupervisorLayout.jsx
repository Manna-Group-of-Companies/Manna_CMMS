import { useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth, homePathFor } from "../context/AuthContext";
import Sidebar from "../components/Sidebar";
import Navbar from "../components/Navbar";

const SupervisorLayout = () => {
  const { user, loading } = useAuth();
  const location = useLocation();
  // The sidebar is a drawer below lg; this is what opens it.
  const [menuOpen, setMenuOpen] = useState(false);

  if (loading) {
    return (
      <div className="min-h-screen bg-canvas text-slate-900 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-brand-500"></div>
          <span className="text-sm font-medium text-slate-600">Loading supervisor session...</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (user.role !== "Supervisor") {
    return <Navigate to={homePathFor(user.role)} replace />;
  }

  const getPageTitle = () => {
    const path = location.pathname;
    if (path.includes("/dashboard")) return "Supervisor Dashboard";
    if (path.includes("/products")) return "Browse Engineering Stock Catalog";
    if (path.includes("/requests")) return "My Requests Tracker";
    if (path.includes("/audit")) return "Monthly Stock Audit";
    return "Supervisor Stock Manager";
  };

  return (
    <div className="min-h-screen bg-canvas flex">
      {/* Sidebar Navigation */}
      <Sidebar open={menuOpen} onClose={() => setMenuOpen(false)} />

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col h-screen max-h-[100dvh] overflow-hidden">
        <Navbar title={getPageTitle()} onMenuClick={() => setMenuOpen(true)} />
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 bg-canvas">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default SupervisorLayout;
