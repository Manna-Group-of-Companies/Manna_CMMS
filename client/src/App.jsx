import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { NotificationProvider } from "./context/NotificationContext";

// Layout wrappers
import AdminLayout from "./layouts/AdminLayout";
import SupervisorLayout from "./layouts/SupervisorLayout";
import BranchLayout from "./layouts/BranchLayout";

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
import MyReturns from "./pages/supervisor/MyReturns";
import BranchDashboard from "./pages/branch/BranchDashboard";
import BranchMyRequests from "./pages/branch/MyRequests";
import AdminBranchRequests from "./pages/admin/BranchRequests";
import AdminUsers from "./pages/admin/Users";
import AdminRecipients from "./pages/admin/Recipients";
import AdminScrapReport from "./pages/admin/ScrapReport";
import AdminAuditReport from "./pages/admin/AuditReport";
import SupervisorStockAudit from "./pages/supervisor/StockAudit";
import AdminSapHandoff from "./pages/admin/SapHandoff";
import BranchApprovals from "./pages/supervisor/BranchApprovals";

// Protected Route Root Switcher
import { useAuth, homePathFor } from "./context/AuthContext";

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

  return <Navigate to={homePathFor(user.role)} replace />;
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
              <Route path="scrap" element={<AdminScrapReport />} />
              <Route path="audits" element={<AdminAuditReport />} />
              <Route path="sap-handoff" element={<AdminSapHandoff />} />
              <Route path="branch-requests" element={<AdminBranchRequests />} />
              <Route path="users" element={<AdminUsers />} />
              <Route path="recipients" element={<AdminRecipients />} />
              {/* Red Stock is decided in Request Control now; an old link or a
                  bookmark lands on the dashboard rather than a dead route. */}
              <Route path="red-stock" element={<Navigate to="/admin/dashboard" replace />} />
              <Route path="" element={<Navigate to="dashboard" replace />} />
            </Route>

            {/* Supervisor Portal Route Group */}
            <Route path="/supervisor" element={<SupervisorLayout />}>
              <Route path="dashboard" element={<SupervisorDashboard />} />
              <Route path="products" element={<ProductList />} />
              <Route path="requests" element={<MyRequests />} />
              <Route path="issues" element={<SupervisorIssueHistory />} />
              <Route path="returns" element={<MyReturns />} />
              <Route path="branch-approvals" element={<BranchApprovals />} />
              <Route path="audit" element={<SupervisorStockAudit />} />
              <Route path="" element={<Navigate to="dashboard" replace />} />
            </Route>

            {/* Branch Portal Route Group — one room's stock, read-only */}
            <Route path="/branch" element={<BranchLayout />}>
              <Route path="stock" element={<BranchDashboard />} />
              <Route path="requests" element={<BranchMyRequests />} />
              {/* "dashboard" is the habit from the other two portals. */}
              <Route path="dashboard" element={<Navigate to="/branch/stock" replace />} />
              <Route path="" element={<Navigate to="stock" replace />} />
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
