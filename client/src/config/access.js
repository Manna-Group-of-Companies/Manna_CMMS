import {
  AlertTriangle,
  BarChart3,
  Boxes,
  CalendarCheck,
  ClipboardCheck,
  ClipboardList,
  Contact,
  Factory,
  FolderTree,
  Gauge,
  Hammer,
  KeyRound,
  PackageOpen,
  TrendingDown,
  Wrench,
} from "lucide-react";

/**
 * Who may see what.
 *
 * The mirror of `server/config/access.js`, which is the enforcement — this one
 * decides what a person is offered, and offering somebody a screen the server
 * will refuse is the failure mode worth avoiding. Change the two together.
 *
 * It also carries the navigation, so a screen is described once: its audience,
 * its label, its path and its icon in one row. Adding a page used to mean
 * editing the sidebar, the router and a role list in three separate files, and
 * the role list was the one that got forgotten.
 */

export const MANAGER = "Manager";
export const MAINTENANCE_MANAGER = "Maintenance Manager";
export const SUPERVISOR = "Supervisor";
/** A plant head. Confined to their own plant by the server, not by this file. */
export const PRODUCTION_MANAGER = "Production Manager";
/** The MD, the executive director and the GM, treated as one audience. */
export const HIGHER_MANAGEMENT = "Higher Management";
/** The Vice President, Operations. */
export const VP_OPERATIONS = "VP Operations";

export const ROLES = [
  MANAGER,
  MAINTENANCE_MANAGER,
  SUPERVISOR,
  PRODUCTION_MANAGER,
  HIGHER_MANAGEMENT,
  VP_OPERATIONS,
];

/**
 * The screens, and who gets each one.
 *
 * A role absent from a list does not see that screen. There is no implicit
 * "and the Manager too" — the Manager is written out everywhere it applies,
 * because a matrix with an unwritten exception in it is a matrix nobody reads
 * twice.
 */
export const VIEWS = {
  engineeringStock: ROLES,
  /**
   * The category tree, which is created and deleted from this screen.
   *
   * Not the Admin's. Editing the tree re-points every item filed under a group
   * and can merge two groups into one, and the business has put that with
   * maintenance rather than with the store — so the screen is where the
   * decision is made, and the Admin is not offered it.
   */
  categories: [MAINTENANCE_MANAGER, VP_OPERATIONS, SUPERVISOR],
  lowStock: [MANAGER, MAINTENANCE_MANAGER, PRODUCTION_MANAGER, HIGHER_MANAGEMENT],
  /**
   * The item-naming queue.
   *
   * Raised by maintenance, agreed by operations. The plant heads were on this
   * list and are deliberately off it: every naming request went to all four of
   * them plus the Admin, and a queue that is everybody's is nobody's. The
   * catalog is not split by plant either, so a plant head approving a name was
   * approving it for the whole group.
   *
   * The Maintenance Manager is new here. They raise every one of these and
   * could not previously see where any of them got to, which was a gap rather
   * than a decision.
   */
  itemNaming: [MANAGER, MAINTENANCE_MANAGER, VP_OPERATIONS, HIGHER_MANAGEMENT, SUPERVISOR],
  breakdowns: [MANAGER, MAINTENANCE_MANAGER, HIGHER_MANAGEMENT, PRODUCTION_MANAGER, SUPERVISOR],
  assets: ROLES,
  breakdownReport: [MANAGER, MAINTENANCE_MANAGER, VP_OPERATIONS],
  scrap: [MANAGER, PRODUCTION_MANAGER, HIGHER_MANAGEMENT],

  /**
   * The two Module 2 screens the restrictions said nothing about.
   *
   * Left at the audience they already had rather than widened to the new
   * management roles: nobody asked for them there, and inventing access is the
   * one mistake a permissions change cannot be forgiven for. Plant heads are
   * still confined to their own plant on both.
   */
  maintenanceRequests: [MANAGER, MAINTENANCE_MANAGER, PRODUCTION_MANAGER, SUPERVISOR],
  preventive: [MANAGER, MAINTENANCE_MANAGER, PRODUCTION_MANAGER, SUPERVISOR],

  /** No content behind these yet, so they stay with the Admin until there is. */
  stockAudits: [MANAGER],
  recipients: [MANAGER],
  users: [MANAGER],

  /** The store floor. Unchanged — the restrictions were about management. */
  redStockRoom: [SUPERVISOR],
  branchApprovals: [SUPERVISOR],
  monthlyAudit: [SUPERVISOR],
};


/**
 * The screens this release ships.
 *
 * The matrix above is the full picture of who may see what, and it stays
 * intact. This is the narrower question of what is switched on today: the first
 * release is breakdowns and maintenance requests only, and everything else is
 * held back rather than shown half-finished.
 *
 * A separate list rather than edits to the matrix, because deleting the role
 * lists would throw away who was allowed to see each screen - and that is
 * exactly what has to be reconstructed when a screen is turned back on. Adding
 * a name here is the whole of putting one back.
 */
export const RELEASED = new Set(["breakdowns", "maintenanceRequests"]);


/**
 * Roles the release scope does not apply to.
 *
 * The Maintenance Manager is setting the system up - filling in machines,
 * checklists and the asset register - and cannot do that through two screens.
 * They see everything the matrix above grants them; everybody else still gets
 * only what `RELEASED` names, so the narrow release holds for the people it was
 * narrowed for.
 *
 * This is not "sees everything": the matrix still decides. A screen the
 * Maintenance Manager is not on stays invisible to them.
 */
const RELEASE_EXEMPT = [MAINTENANCE_MANAGER];

/** True when this role may see this screen, given the matrix and the release. */
export const maySee = (role, view) =>
  (RELEASED.has(view) || RELEASE_EXEMPT.includes(role)) && (VIEWS[view] || []).includes(role);

/**
 * Which console a role works in.
 *
 * Two, not six. The store supervisor keeps the store console; everybody else —
 * the Admin, maintenance, the plant heads, operations and the board — shares
 * one, because their screens overlap almost entirely and the difference
 * between them is the matrix above rather than a different application.
 */
export const consoleFor = (role) => (role === SUPERVISOR ? "/supervisor" : "/admin");

/**
 * The navigation, in the order it is shown.
 *
 * `path` is relative to the console, because the two consoles name the same
 * screen the same way — `/admin/assets` and `/supervisor/assets` are one page
 * reached from two menus.
 */
export const NAV = [
  { view: "engineeringStock", label: "Engineering Stock", path: "products", icon: Boxes },
  { view: "categories", label: "Categories", path: "categories", icon: FolderTree },
  { view: "lowStock", label: "Low Stock", path: "low-stock", icon: AlertTriangle },
  { view: "itemNaming", label: "Item Naming", path: "requests", icon: ClipboardList },
  { view: "breakdowns", label: "Breakdowns", path: "breakdowns", icon: Wrench },
  {
    view: "maintenanceRequests",
    label: "Maintenance Requests",
    path: "maintenance-requests",
    icon: Hammer,
  },
  { view: "preventive", label: "Preventive Maintenance", path: "preventive", icon: CalendarCheck },
  { view: "assets", label: "Asset Management", path: "assets", icon: Factory },
  { view: "breakdownReport", label: "Breakdown Report", path: "breakdown-report", icon: BarChart3 },
  { view: "scrap", label: "Scrap & Consumption", path: "scrap", icon: TrendingDown },
  { view: "redStockRoom", label: "Red Stock Room", path: "returns", icon: PackageOpen },
  { view: "branchApprovals", label: "Branch Approvals", path: "branch-approvals", icon: ClipboardCheck },
  { view: "monthlyAudit", label: "Monthly Audit", path: "audit", icon: Gauge },
  { view: "stockAudits", label: "Stock Audits", path: "audits", icon: Gauge },
  { view: "recipients", label: "Recipients", path: "recipients", icon: Contact },
  { view: "users", label: "Users & Passwords", path: "users", icon: KeyRound },
];

/** The menu one role is shown, with absolute paths. */
export const navFor = (role) => {
  const base = consoleFor(role);
  return NAV.filter((item) => maySee(role, item.view)).map((item) => ({
    ...item,
    to: `${base}/${item.path}`,
  }));
};

/**
 * Where a signed-in person lands.
 *
 * The first screen their menu offers, rather than a named page. There was a
 * dashboard here and every role landed on it; with it gone, hard-coding a
 * replacement would mean this line and the menu could disagree — and the way
 * that goes wrong is somebody being dropped on a screen their role may not
 * open, then bounced straight off it by RequireView.
 *
 * Deriving it means the answer is always a page they can actually see, and it
 * follows the menu if the order ever changes. In practice everybody lands on
 * Engineering Stock, which is what the phone already does with an old dashboard
 * link.
 *
 * A role with no menu at all has nowhere to be, and goes back to the login.
 */
export const homePathFor = (role) => navFor(role)[0]?.to || "/no-access";

/**
 * Not "/login".
 *
 * That is where this pointed, and it made a role with no screens look like a
 * failed sign-in: the password was accepted, `homePathFor` sent them to the
 * login page, and the login page sent them back. Holding screens back for a
 * release is exactly how a role ends up with an empty menu, so it now lands
 * somewhere that says so.
 */
