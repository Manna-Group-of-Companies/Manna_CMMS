import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { NotificationProvider } from "./context/NotificationContext";

// Layout wrappers
import Breakdowns from "./pages/maintenance/Breakdowns";
import AdminLayout from "./layouts/AdminLayout";
import SupervisorLayout from "./layouts/SupervisorLayout";
import BranchLayout from "./layouts/BranchLayout";

// Pages
import Login from "./pages/auth/Login";
import ChecklistSheetPreview from "./pages/maintenance/ChecklistSheetPreview";
import NamingRequests from "./pages/admin/NamingRequests";
import Categories from "./pages/admin/Categories";
import AssetManagement from "./pages/maintenance/AssetManagement";
import MaintenanceRequests from "./pages/maintenance/MaintenanceRequests";
import PreventiveMaintenance from "./pages/maintenance/PreventiveMaintenance";
import BreakdownReport from "./pages/admin/BreakdownReport";
import AdminProductList from "./pages/admin/ProductList";
import AdminLowStock from "./pages/admin/LowStockReport";
import ProductList from "./pages/supervisor/ProductList";
import MyReturns from "./pages/supervisor/MyReturns";
import BranchDashboard from "./pages/branch/BranchDashboard";
import BranchMyRequests from "./pages/branch/MyRequests";
import AdminUsers from "./pages/admin/Users";
import AdminRecipients from "./pages/admin/Recipients";
import AdminScrapReport from "./pages/admin/ScrapReport";
import AdminAuditReport from "./pages/admin/AuditReport";
import SupervisorStockAudit from "./pages/supervisor/StockAudit";
import BranchApprovals from "./pages/supervisor/BranchApprovals";

// Protected Route Root Switcher
import { useAuth, homePathFor } from "./context/AuthContext";
import RequireView from "./components/RequireView";

/**
 * Sends somebody to the first screen their role can open.
 *
 * Used wherever a route used to point at the dashboard. It cannot be a plain
 * `<Navigate to="...">` any more: with no dashboard there is no single page
 * every role may see, so the target has to be worked out from who is signed in.
 * `homePathFor` answers that from their own menu.
 */
const Home = () => {
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

            {/*
              The printed checklist sheet with stand-in content, for reviewing
              the format of the sheet itself.

              Development only, so a deployed site has no unauthenticated route
              to it. It renders the real ChecklistSheet rather than a mock-up:
              the whole point is to argue about column widths and page breaks,
              and a replica would drift from the sheet people actually print.
            */}
            {import.meta.env.DEV && (
              <Route path="/sheet-preview" element={<ChecklistSheetPreview />} />
            )}

            {/* The shared console. Every role but the store supervisor works
                here; which of these routes each one may open is the matrix in
                config/access.js, applied by RequireView. */}
            <Route path="/admin" element={<AdminLayout />}>
              <Route
                path="products"
                element={
                  <RequireView view="engineeringStock">
                    <AdminProductList />
                  </RequireView>
                }
              />
              <Route
                path="categories"
                element={
                  <RequireView view="categories">
                    <Categories />
                  </RequireView>
                }
              />
              <Route
                path="low-stock"
                element={
                  <RequireView view="lowStock">
                    <AdminLowStock />
                  </RequireView>
                }
              />
              <Route
                path="requests"
                element={
                  <RequireView view="itemNaming">
                    <NamingRequests />
                  </RequireView>
                }
              />
              <Route
                path="assets"
                element={
                  <RequireView view="assets">
                    <AssetManagement />
                  </RequireView>
                }
              />
              <Route
                path="electrical"
                element={
                  <RequireView view="assets">
                    <AssetManagement initialTab="electrical" />
                  </RequireView>
                }
              />
              <Route
                path="breakdown-report"
                element={
                  <RequireView view="breakdownReport">
                    <BreakdownReport />
                  </RequireView>
                }
              />
              <Route
                path="breakdowns"
                element={
                  <RequireView view="breakdowns">
                    <Breakdowns />
                  </RequireView>
                }
              />
              {/* Planned work, deliberately its own route rather than a tab on
                  breakdowns: a fabrication job and a stopped machine are
                  different records with different stages, and sharing a screen
                  was what let them share a form. */}
              <Route
                path="maintenance-requests"
                element={
                  <RequireView view="maintenanceRequests">
                    <MaintenanceRequests />
                  </RequireView>
                }
              />
              <Route
                path="preventive"
                element={
                  <RequireView view="preventive">
                    <PreventiveMaintenance />
                  </RequireView>
                }
              />
              <Route
                path="scrap"
                element={
                  <RequireView view="scrap">
                    <AdminScrapReport />
                  </RequireView>
                }
              />
              <Route
                path="audits"
                element={
                  <RequireView view="stockAudits">
                    <AdminAuditReport />
                  </RequireView>
                }
              />
              {/* SAP Hand-off and Branch Requests are hidden from the
                  console. Kept as redirects rather than deleted so a bookmark
                  or an old link lands somewhere real instead of a blank screen
                  — the pages are still in pages/admin/ if either comes back. */}
              <Route path="sap-handoff" element={<Home />} />
              <Route path="branch-requests" element={<Home />} />
              <Route
                path="users"
                element={
                  <RequireView view="users">
                    <AdminUsers />
                  </RequireView>
                }
              />
              <Route
                path="recipients"
                element={
                  <RequireView view="recipients">
                    <AdminRecipients />
                  </RequireView>
                }
              />
              {/* Red Stock is decided in Request Control now; an old link or a
                  bookmark lands on their own home rather than a dead route. */}
              <Route path="red-stock" element={<Home />} />
              {/* Issue History went with the issuing system: items are marked
                  consumed on the maintenance log sheet now, so there is no
                  issue to have a history of. */}
              <Route path="issues" element={<Home />} />
              {/* The dashboard is gone. A bookmark on it, and the bare console
                  path, both land on the first screen the person can open. */}
              <Route path="dashboard" element={<Home />} />
              <Route path="" element={<Home />} />
            </Route>

            {/* The store console. The store supervisor's, and nobody else's. */}
            <Route path="/supervisor" element={<SupervisorLayout />}>
              <Route
                path="products"
                element={
                  <RequireView view="engineeringStock">
                    <ProductList />
                  </RequireView>
                }
              />
              <Route
                path="requests"
                element={
                  <RequireView view="itemNaming">
                    <NamingRequests />
                  </RequireView>
                }
              />
              <Route
                path="assets"
                element={
                  <RequireView view="assets">
                    <AssetManagement />
                  </RequireView>
                }
              />
              <Route
                path="electrical"
                element={
                  <RequireView view="assets">
                    <AssetManagement initialTab="electrical" />
                  </RequireView>
                }
              />
              <Route
                path="categories"
                element={
                  <RequireView view="categories">
                    <Categories />
                  </RequireView>
                }
              />
              <Route
                path="breakdowns"
                element={
                  <RequireView view="breakdowns">
                    <Breakdowns />
                  </RequireView>
                }
              />
              <Route
                path="maintenance-requests"
                element={
                  <RequireView view="maintenanceRequests">
                    <MaintenanceRequests />
                  </RequireView>
                }
              />
              <Route
                path="preventive"
                element={
                  <RequireView view="preventive">
                    <PreventiveMaintenance />
                  </RequireView>
                }
              />
              <Route
                path="returns"
                element={
                  <RequireView view="redStockRoom">
                    <MyReturns />
                  </RequireView>
                }
              />
              <Route
                path="branch-approvals"
                element={
                  <RequireView view="branchApprovals">
                    <BranchApprovals />
                  </RequireView>
                }
              />
              <Route
                path="audit"
                element={
                  <RequireView view="monthlyAudit">
                    <SupervisorStockAudit />
                  </RequireView>
                }
              />
              {/* Issue History went with the issuing system. */}
              <Route path="issues" element={<Home />} />
              {/* The dashboard is gone; see the note in the shared console. */}
              <Route path="dashboard" element={<Home />} />
              <Route path="" element={<Home />} />
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
            <Route path="/" element={<Home />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </NotificationProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
