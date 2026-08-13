import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth, homePathFor } from "../context/AuthContext";
import Sidebar from "../components/Sidebar";
import Navbar from "../components/Navbar";

const SupervisorLayout = () => {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen bg-canvas text-slate-900 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-emerald-500"></div>
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
    if (path.includes("/products")) return "Browse Products Catalog";
    if (path.includes("/requests")) return "My Requests Tracker";
    return "Supervisor Stock Manager";
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

export default SupervisorLayout;
