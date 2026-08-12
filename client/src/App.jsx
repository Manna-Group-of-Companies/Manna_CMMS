import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { NotificationProvider } from "./context/NotificationContext";

// Layout wrappers
import AdminLayout from "./layouts/AdminLayout";
import SupervisorLayout from "./layouts/SupervisorLayout";

// Pages
import Login from "./pages/auth/Login";
import AdminDashboard from "./pages/admin/AdminDashboard";
import RequestManagement from "./pages/admin/RequestManagement";
import AdminIssueHistory from "./pages/admin/IssueHistory";
import AdminProductList from "./pages/admin/ProductList";
import SupervisorDashboard from "./pages/supervisor/SupervisorDashboard";
import ProductList from "./pages/supervisor/ProductList";
import MyRequests from "./pages/supervisor/MyRequests";
import SupervisorIssueHistory from "./pages/supervisor/IssueHistory";

// Protected Route Root Switcher
import { useAuth } from "./context/AuthContext";

const RootRoute = () => {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-100 text-slate-900 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-brand-500"></div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (user.role === "Admin") {
    return <Navigate to="/admin/dashboard" replace />;
  }

  return <Navigate to="/supervisor/dashboard" replace />;
};

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <NotificationProvider>
          <Routes>
            {/* Public Access */}
            <Route path="/login" element={<Login />} />

            {/* Admin Console Route Group */}
            <Route path="/admin" element={<AdminLayout />}>
              <Route path="dashboard" element={<AdminDashboard />} />
              <Route path="products" element={<AdminProductList />} />
              <Route path="requests" element={<RequestManagement />} />
              <Route path="issues" element={<AdminIssueHistory />} />
              <Route path="" element={<Navigate to="dashboard" replace />} />
            </Route>

            {/* Supervisor Portal Route Group */}
            <Route path="/supervisor" element={<SupervisorLayout />}>
              <Route path="dashboard" element={<SupervisorDashboard />} />
              <Route path="products" element={<ProductList />} />
              <Route path="requests" element={<MyRequests />} />
              <Route path="issues" element={<SupervisorIssueHistory />} />
              <Route path="" element={<Navigate to="dashboard" replace />} />
            </Route>

            {/* Default Catch-All */}
            <Route path="/" element={<RootRoute />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </NotificationProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
