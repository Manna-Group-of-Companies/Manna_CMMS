import { useEffect, useRef } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useDialog } from "../context/DialogContext";
import MannaLogo from "./MannaLogo";
import { navFor } from "../config/access";
import { LogOut, X } from "lucide-react";

/**
 * Portal navigation. Fixed on the left from `lg` up; below that it slides in
 * over the page as a drawer, opened by the hamburger in the Navbar.
 *
 * The menu itself is not written here. It comes from the screen matrix in
 * `config/access.js`, so a role's menu and what that role is actually allowed
 * to open cannot disagree.
 *
 * Redesign (22 Oct 2026): the flat list of up to fifteen links is grouped
 * into the parts of the job they belong to, so the eye finds "the store" or
 * "maintenance" first and the screen second. The grouping is display only -
 * `NAV`'s order still decides where a role lands (see homePathFor), which is
 * why the sections are kept here rather than by reordering `NAV`.
 */
const SECTIONS = [
  { label: "Overview", views: ["dashboard", "breakdownReport"] },
  {
    label: "Maintenance",
    views: ["breakdowns", "maintenanceRequests", "preventive", "assets"],
  },
  {
    label: "Engineering store",
    views: [
      "engineeringStock",
      "lowStock",
      "goodsReceipts",
      "purchaseRequests",
      "lowValuePurchases",
    ],
  },
  { label: "Store floor", views: ["redStockRoom", "branchApprovals", "monthlyAudit"] },
  { label: "Administration", views: ["scrap", "stockAudits", "recipients", "users", "settings"] },
];

const initials = (name = "") =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("") || "?";

const Sidebar = ({ open = false, onClose = () => {} }) => {
  const { user, logout } = useAuth();
  const { confirm } = useDialog();
  const location = useLocation();
  const closeRef = useRef(null);
  // The layouts pass a fresh arrow every render; read it through a ref so the
  // effect below runs once per open, not on every re-render while open.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // As a drawer (below lg): focus moves into it on open, Escape closes it, and
  // focus goes back to whatever opened it - the hamburger - on close.
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement;
    closeRef.current?.focus();
    const onKey = (e) => e.key === "Escape" && onCloseRef.current();
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
  }, [open]);

  const handleLogout = async () => {
    const ok = await confirm({
      title: "Sign out?",
      message: "You will need your ERPNext email and password to sign back in.",
      confirmLabel: "Sign out",
    });
    if (ok) logout();
  };

  const links = navFor(user?.role);

  // Every link lands in exactly one section; anything a future NAV entry adds
  // without a section still shows, under "More", rather than vanishing.
  const placed = new Set(SECTIONS.flatMap((s) => s.views));
  const sections = [
    ...SECTIONS.map((s) => ({
      label: s.label,
      links: s.views.map((v) => links.find((l) => l.view === v)).filter(Boolean),
    })),
    { label: "More", links: links.filter((l) => !placed.has(l.view)) },
  ].filter((s) => s.links.length > 0);

  // A detail route (/admin/assets/ABC) keeps its parent highlighted.
  const isActive = (to) => location.pathname === to || location.pathname.startsWith(`${to}/`);

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
        // Closed, the drawer is only pushed off-screen, so it is also made
        // invisible: otherwise Tab walks through every link nobody can see.
        // Visibility flips at the end of the slide, so the exit still shows.
        className={`w-[264px] shrink-0 bg-ink-900 text-slate-300 flex flex-col
          fixed inset-y-0 left-0 z-50 transition-[transform,visibility] duration-200 ease-out
          lg:visible lg:static lg:z-auto lg:translate-x-0
          lg:m-3 lg:mr-0 lg:h-[calc(100dvh-1.5rem)] lg:rounded-2xl lg:overflow-hidden lg:shadow-xl lg:shadow-ink-950/20
          ${open ? "visible translate-x-0" : "invisible -translate-x-full"}`}
      >
        {/* Brand — same 64px as the Navbar it lines up with. */}
        <div className="h-16 flex items-center px-4 gap-3 border-b border-white/[0.07] shrink-0">
          <MannaLogo onDark className="h-6 w-auto" />
          <div className="h-7 w-px bg-white/15 shrink-0" aria-hidden="true" />
          <span className="font-bold text-[15px] text-white leading-none tracking-tight">CMMS</span>
          <button
            ref={closeRef}
            onClick={onClose}
            className="ml-auto grid h-10 w-10 shrink-0 place-items-center rounded-lg text-slate-400 hover:text-white hover:bg-white/10 cursor-pointer lg:hidden"
            aria-label="Close menu"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Navigation */}
        <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
          {sections.map((section) => (
            <div key={section.label}>
              {/* slate-400, not 500: 500 on the ink is 3.6:1, under AA. */}
              <p
                id={`nav-${section.label}`}
                className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400"
              >
                {section.label}
              </p>
              <div role="group" aria-labelledby={`nav-${section.label}`} className="space-y-1">
                {section.links.map((link) => {
                  const Icon = link.icon;
                  const active = isActive(link.to);
                  return (
                    <Link
                      key={link.to}
                      to={link.to}
                      // Following a link on a phone should get the drawer out of the way.
                      onClick={onClose}
                      aria-current={active ? "page" : undefined}
                      className={`flex min-h-11 items-center gap-3 px-3.5 rounded-xl text-[14px] transition-colors duration-150 cursor-pointer group ${
                        active
                          ? "bg-brand-600 text-white font-semibold shadow-[0_8px_18px_-8px_rgba(209,74,12,0.7)]"
                          : "font-medium text-slate-300 hover:bg-white/[0.06] hover:text-white"
                      }`}
                    >
                      <Icon
                        className={`h-[18px] w-[18px] shrink-0 ${
                          active ? "text-white" : "text-slate-400 group-hover:text-white"
                        }`}
                      />
                      <span className="truncate">{link.label}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Who is signed in, and the way out. Several people here have more
            than one account, so the address is a hover away. */}
        <div className="p-3 shrink-0">
          <div className="flex items-center gap-3 rounded-xl bg-white/[0.05] px-2.5 py-2.5">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-ink-700 text-[13px] font-semibold text-white">
              {initials(user?.name)}
            </div>
            <div className="min-w-0 flex-1" title={user?.email || ""}>
              <p className="text-[13px] font-semibold text-white truncate">{user?.name}</p>
              <p className="text-[12px] text-slate-400 truncate">{user?.role}</p>
            </div>
            <button
              onClick={handleLogout}
              className="grid h-10 w-10 shrink-0 cursor-pointer place-items-center rounded-lg text-slate-400 transition-colors hover:bg-rose-500/15 hover:text-rose-300"
              aria-label="Sign out"
              title="Sign out"
            >
              <LogOut className="h-[18px] w-[18px]" />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
};

export default Sidebar;
