import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import Sidebar from "../components/Sidebar";
import Navbar from "../components/Navbar";

const AdminLayout = () => {
  const { user, loading } = useAuth();
  const location = useLocation();

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
    // If not Admin, redirect to Supervisor dashboard if they are Supervisor, otherwise Login
    return user.role === "Supervisor" ? (
      <Navigate to="/supervisor/dashboard" replace />
    ) : (
      <Navigate to="/login" replace />
    );
  }

  // Generate dynamic page title based on path
  const getPageTitle = () => {
    const path = location.pathname;
    if (path.includes("/dashboard")) return "Admin Dashboard";
    if (path.includes("/requests")) return "Request Management Panel";
    if (path.includes("/issues")) return "Issue History Log";
    return "Stock Master Control";
  };

  return (
    <div className="min-h-screen bg-canvas flex">
      {/* Sidebar Navigation */}
      <Sidebar />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col h-screen overflow-hidden">
        <Navbar title={getPageTitle()} />
        <main className="flex-1 overflow-y-auto p-8 bg-canvas">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default AdminLayout;
