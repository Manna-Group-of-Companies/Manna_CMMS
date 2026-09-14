import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import MannaLogo from "./MannaLogo";
import { navFor } from "../config/access";
import { LogOut, User, ShieldCheck, Warehouse, X } from "lucide-react";

/**
 * Portal navigation. Fixed on the left from `lg` up; below that it slides in
 * over the page as a drawer, opened by the hamburger in the Navbar.
 *
 * The menu itself is not written here any more. It comes from the screen
 * matrix in `config/access.js`, so a role's menu and what that role is
 * actually allowed to open cannot disagree — they used to be three hand-kept
 * lists, and a link to a screen the server refused looked to the person
 * clicking it like a broken page rather than a permission.
 */
const Sidebar = ({ open = false, onClose = () => {} }) => {
  const { user, logout } = useAuth();
  const location = useLocation();

  const handleLogout = () => {
    if (window.confirm("Are you sure you want to sign out?")) {
      logout();
    }
  };

  const links = navFor(user?.role);

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
        className={`w-64 shrink-0 bg-charcoal-900 text-slate-300 flex flex-col
          fixed inset-y-0 left-0 z-50 overflow-y-auto transition-transform duration-200 ease-out
          lg:static lg:z-auto lg:h-screen lg:translate-x-0
          ${open ? "translate-x-0" : "-translate-x-full"}`}
      >
        {/* Brand Header — same 64px as the Navbar it lines up with.
            px-3, not px-4: the user card below is mx-3 and every nav pill sits
            inside a px-3 nav, so 12px is the rail this whole column is hung
            from. The header was the one row off it. */}
        <div className="h-16 flex items-center px-3 gap-3 border-b border-white/10 shrink-0">
          <MannaLogo onDark className="h-6 w-auto" />
          {/* A rule, then "CMMS" — the lockup reads as one name across it.
              The logo already draws MANNA, so setting "Manna CMMS" beside it
              printed the word twice at two different sizes within an inch of
              itself, which is what made the header look wrong. */}
          <div className="h-7 w-px bg-white/15 shrink-0" aria-hidden="true" />
          {/* The role used to sit under this, and clipped to "MAINTENANCE
              MANAG…" — 256px will not carry the product name and the person's
              job on the same row. The role moved to the account card below,
              which is where the rest of who-you-are already is. */}
          <h1 className="font-bold text-[15px] text-white leading-none tracking-tight">CMMS</h1>
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
            {user?.role === "Manager" ? (
              <ShieldCheck className="h-[18px] w-[18px] text-brand-400" />
            ) : user?.role === "Maintenance Manager" ? (
              <Warehouse className="h-[18px] w-[18px] text-brand-400" />
            ) : (
              <User className="h-[18px] w-[18px] text-brand-400" />
            )}
          </div>
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-white truncate">{user?.name}</p>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-brand-400 truncate">
              {user?.role}
            </p>
            {/* Several people here have more than one account. The address is
                how you tell at a glance which one you are signed in to. */}
            {user?.email && (
              <p className="text-[11px] text-slate-400 truncate" title={user.email}>
                {user.email}
              </p>
            )}
          </div>
        </div>

        {/* Navigation Links */}
        <nav className="flex-1 px-3 space-y-0.5">
          <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Menu
          </p>
          {links.map((link) => {
            const Icon = link.icon;
            const isActive = location.pathname === link.to;
            return (
              <Link
                key={link.to}
                to={link.to}
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
                <span className="truncate">{link.label}</span>
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
