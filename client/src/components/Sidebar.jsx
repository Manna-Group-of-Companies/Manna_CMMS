import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import {
  LayoutDashboard,
  Boxes,
  ClipboardList,
  History,
  LogOut,
  User,
  ShieldCheck,
  Send,
  PackageOpen,
  Warehouse,
  ClipboardCheck,
  KeyRound,
  Contact,
  TrendingDown,
  ArrowRightLeft,
  X,
} from "lucide-react";

/**
 * Portal navigation. Fixed on the left from `lg` up; below that it slides in
 * over the page as a drawer, opened by the hamburger in the Navbar.
 */
const Sidebar = ({ open = false, onClose = () => {} }) => {
  const { user, logout } = useAuth();
  const location = useLocation();

  const handleLogout = () => {
    if (window.confirm("Are you sure you want to sign out?")) {
      logout();
    }
  };

  const adminLinks = [
    {
      name: "Dashboard",
      path: "/admin/dashboard",
      icon: LayoutDashboard,
    },
    {
      name: "Products & Stock",
      path: "/admin/products",
      icon: Boxes,
    },
    {
      name: "Request Control",
      path: "/admin/requests",
      icon: ClipboardList,
    },
    {
      name: "Issue History",
      path: "/admin/issues",
      icon: Send,
    },
    {
      name: "Scrap & Consumption",
      path: "/admin/scrap",
      icon: TrendingDown,
    },
    {
      name: "SAP Hand-off",
      path: "/admin/sap-handoff",
      icon: ArrowRightLeft,
    },
    {
      name: "Branch Requests",
      path: "/admin/branch-requests",
      icon: ClipboardCheck,
    },
    {
      name: "Recipients",
      path: "/admin/recipients",
      icon: Contact,
    },
    {
      name: "Users & PINs",
      path: "/admin/users",
      icon: KeyRound,
    },
  ];

  const supervisorLinks = [
    {
      name: "Dashboard",
      path: "/supervisor/dashboard",
      icon: LayoutDashboard,
    },
    {
      name: "Browse Products",
      path: "/supervisor/products",
      icon: Boxes,
    },
    {
      name: "Requests",
      path: "/supervisor/requests",
      icon: History,
    },
    {
      name: "Issue History",
      path: "/supervisor/issues",
      icon: Send,
    },
    {
      name: "Red Stock Room",
      path: "/supervisor/returns",
      icon: PackageOpen,
    },
    {
      name: "Branch Approvals",
      path: "/supervisor/branch-approvals",
      icon: ClipboardCheck,
    },
  ];

  // A branch sees its own room's stock, and the requests it has raised on it.
  const branchLinks = [
    {
      name: user?.stockRoom?.name ? `${user.stockRoom.name} Stock` : "Company Stock",
      path: "/branch/stock",
      icon: Warehouse,
    },
    {
      name: "My Requests",
      path: "/branch/requests",
      icon: ClipboardList,
    },
  ];

  const linksByRole = {
    Admin: adminLinks,
    Branch: branchLinks,
  };
  const links = linksByRole[user?.role] || supervisorLinks;

  return (
    <>
      {/* Scrim behind the drawer — tapping it closes the menu. */}
      {open && (
        <div
          onClick={onClose}
          className="fixed inset-0 z-40 bg-slate-900/50 backdrop-blur-sm lg:hidden"
          aria-hidden="true"
        />
      )}

      <aside
        className={`w-64 shrink-0 bg-navy-900 text-slate-300 flex flex-col
          fixed inset-y-0 left-0 z-50 overflow-y-auto transition-transform duration-200 ease-out
          lg:static lg:z-auto lg:h-screen lg:translate-x-0
          ${open ? "translate-x-0" : "-translate-x-full"}`}
      >
        {/* Brand Header — same 64px as the Navbar it lines up with. */}
        <div className="h-16 flex items-center px-4 gap-3 border-b border-white/10 shrink-0">
          <div className="bg-brand-600 h-9 w-9 grid place-items-center rounded-xl shadow-lg shadow-brand-900/40 shrink-0">
            <Boxes className="h-5 w-5 text-white" />
          </div>
          <div className="min-w-0">
            <h1 className="font-bold text-[15px] text-white leading-tight tracking-tight truncate">
              StockMaster
            </h1>
            <span className="text-[10px] text-brand-400 font-semibold tracking-wider uppercase">
              {user?.role} Portal
            </span>
          </div>
          <button
            onClick={onClose}
            className="ml-auto grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-400 hover:text-white hover:bg-white/10 cursor-pointer lg:hidden"
            aria-label="Close menu"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* User Information */}
        <div className="mx-3 mt-4 mb-5 p-3 rounded-xl bg-white/5 border border-white/10 flex items-center gap-3 shrink-0">
          <div className="bg-brand-600/20 h-9 w-9 rounded-full flex items-center justify-center border border-brand-500/30 shrink-0">
            {user?.role === "Admin" ? (
              <ShieldCheck className="h-[18px] w-[18px] text-brand-400" />
            ) : user?.role === "Branch" ? (
              <Warehouse className="h-[18px] w-[18px] text-brand-400" />
            ) : (
              <User className="h-[18px] w-[18px] text-brand-400" />
            )}
          </div>
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-white truncate">{user?.name}</p>
            {/* Email is optional now that accounts sign in by name + PIN. */}
            <p className="text-[11px] text-slate-400 truncate">
              {user?.email || user?.stockRoom?.name || user?.role}
            </p>
          </div>
        </div>

        {/* Navigation Links */}
        <nav className="flex-1 px-3 space-y-0.5">
          <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Menu
          </p>
          {links.map((link) => {
            const Icon = link.icon;
            const isActive = location.pathname === link.path;
            return (
              <Link
                key={link.path}
                to={link.path}
                // Following a link on a phone should get the drawer out of the way.
                onClick={onClose}
                aria-current={isActive ? "page" : undefined}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium transition-colors duration-150 cursor-pointer group ${
                  isActive
                    ? "bg-brand-600 text-white shadow-md shadow-brand-900/40"
                    : "text-slate-300 hover:bg-white/5 hover:text-white"
                }`}
              >
                <Icon
                  className={`h-[18px] w-[18px] shrink-0 ${
                    isActive ? "text-white" : "text-slate-400 group-hover:text-brand-400"
                  }`}
                />
                <span className="truncate">{link.name}</span>
              </Link>
            );
          })}
        </nav>

        {/* Sidebar Footer / Logout */}
        <div className="p-3 mt-4 border-t border-white/10 shrink-0">
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-3 px-3 py-2.5 text-[13px] font-medium rounded-xl text-slate-400 hover:bg-rose-500/10 hover:text-rose-300 border border-transparent hover:border-rose-500/20 transition-colors duration-150 cursor-pointer"
          >
            <LogOut className="h-[18px] w-[18px] shrink-0" />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>
    </>
  );
};

export default Sidebar;
