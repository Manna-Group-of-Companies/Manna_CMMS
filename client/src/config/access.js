import {
  AlertTriangle,
  BarChart3,
  Boxes,
  CalendarCheck,
  ClipboardCheck,
  Contact,
  Factory,
  Gauge,
  Hammer,
  LayoutDashboard,
  KeyRound,
  PackageOpen,
  ReceiptIndianRupee,
  Settings,
  ShoppingCart,
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
/**
 * A hand on the maintenance team. Served by the phone app only — they clock
 * in and out there — so the web console offers them nothing and lands them on
 * the no-access page. Not in `ROLES`, which is handed whole to the catalog.
 */
export const MAINTENANCE_MEMBER = "Maintenance Member";
/**
 * The purchase manager (Shantu, 20 Oct 2026). Works in the shared console but
 * is not in `ROLES` either: they buy, and have no use for the catalog or the
 * asset register.
 */
export const PURCHASE_MANAGER = "Purchase Manager";

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
  /**
   * The home screen (22 Oct 2026): breakdowns and maintenance requests summed
   * up, for everyone on either of those two screens. It reads only their two
   * lists, each still guarded by its own view, so this entry adds no data.
   */
  dashboard: [MANAGER, MAINTENANCE_MANAGER, HIGHER_MANAGEMENT, PRODUCTION_MANAGER, SUPERVISOR],
  /**
   * The catalog. Narrowed on 14 Oct 2026 from every role to the three who run
   * stock day to day, so releasing it reaches the plant heads and nobody else.
   */
  engineeringStock: [MANAGER, MAINTENANCE_MANAGER, PRODUCTION_MANAGER],

  /** Goods receipts and stock additions. Its own screen since 14 Oct 2026. */
  goodsReceipts: [MANAGER, MAINTENANCE_MANAGER, PRODUCTION_MANAGER],
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
   * Purchase requests sent to SAP, and where each stands. Its own screen since
   * 14 Oct 2026, so the plant heads and the Admin can follow the purchase
   * queue; it was part of Engineering Stock, which this release keeps to the
   * Maintenance Manager. Raising one stays the Maintenance Manager's.
   */
  purchaseRequests: [MANAGER, MAINTENANCE_MANAGER, PRODUCTION_MANAGER, PURCHASE_MANAGER],

  /**
   * Low value purchase requests (20 Oct 2026): small buys made locally, kept in
   * ERPNext and never posted to SAP. Every manager and the plant heads raise
   * them; the purchase manager buys them.
   */
  lowValuePurchases: [
    MANAGER,
    MAINTENANCE_MANAGER,
    PRODUCTION_MANAGER,
    VP_OPERATIONS,
    HIGHER_MANAGEMENT,
    PURCHASE_MANAGER,
  ],
  // itemNaming (the "New Items" page, /requests) removed 10 Oct 2026: it was the VP Operations'
  // approval queue for new items, and since 9 Oct 2026 items go straight to SAP with no approval.
  // The server keeps its entry, which still guards the /naming-requests read API.
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
  /**
   * The maintenance team register - who may be named on a repair.
   *
   * The Maintenance Manager's alone. It decides whose name can appear in the
   * history of every repair, which is a maintenance judgement; the plant that
   * reports a breakdown has no business adding or retiring a fitter.
   */
  technicians: [MAINTENANCE_MANAGER],
  preventive: [MANAGER, MAINTENANCE_MANAGER, PRODUCTION_MANAGER, SUPERVISOR],

  /**
   * The maintenance team's attendance and leave. Phone only — there is no
   * page for it here and no NAV entry — but the key is kept so this file holds
   * the same set of screens as the server's, which is what the mirror is for.
   */
  attendance: [MAINTENANCE_MEMBER, MAINTENANCE_MANAGER, MANAGER],

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
// itemNaming was released 25 Sep 2026 for the VP Operations to approve new items; held back again on
// 29 Sep, and its approval step removed on 10 Oct 2026.
// purchaseRequests released 14 Oct 2026, so the Admin can follow the purchase queue.
// engineeringStock and goodsReceipts released 14 Oct 2026: the plant heads run their own store.
// lowValuePurchases released 20 Oct 2026, with the purchase manager's view.
// dashboard released 22 Oct 2026, as the home of everyone who follows maintenance.
export const RELEASED = new Set([
  "dashboard",
  "breakdowns",
  "maintenanceRequests",
  "purchaseRequests",
  "engineeringStock",
  "goodsReceipts",
  "lowValuePurchases",
]);


/**
 * Roles the release scope does not apply to.
 *
 * The Maintenance Manager. Taken off on 29 Sep 2026, when the release became the two maintenance
 * screens for every role; back on since the merge of 13 Oct 2026, because from 9 Oct they run the
 * engineering store from the CMMS - new items with no approval step, goods receipts, stock additions,
 * purchase requests, item groups and the SAP sync (user, 9 Oct 2026). Everybody else still gets only
 * what `RELEASED` names, and the matrix still decides: a screen they are not on stays invisible.
 */
const RELEASE_EXEMPT = [MAINTENANCE_MANAGER];

/** One screen of the matrix, given the release. */
const maySeeOne = (role, view) =>
  (RELEASED.has(view) || RELEASE_EXEMPT.includes(role)) && (VIEWS[view] || []).includes(role);

/**
 * Settings (23 Oct 2026): the category tree and the maintenance team on one
 * screen. Not a screen of its own in the matrix - each tab keeps its own
 * audience, and Settings is offered to anybody who may open at least one tab.
 * The server guards each tab's API as before.
 */
export const SETTINGS_TABS = ["categories", "technicians"];

/** True when this role may see this screen, given the matrix and the release. */
export const maySee = (role, view) =>
  view === "settings"
    ? SETTINGS_TABS.some((tab) => maySeeOne(role, tab))
    : maySeeOne(role, view);

/**
 * Whether this role is shown what an item is worth (23 Oct 2026). The
 * Maintenance Manager's alone; the server strips the value for anyone else.
 */
export const maySeeItemValue = (role) => role === MAINTENANCE_MANAGER;

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
  // First, so it is where a role that has it lands - see homePathFor.
  { view: "dashboard", label: "Dashboard", path: "dashboard", icon: LayoutDashboard },
  { view: "engineeringStock", label: "Engineering Stock", path: "products", icon: Boxes },
  { view: "goodsReceipts", label: "Goods Receipts", path: "goods-receipts", icon: ClipboardCheck },
  { view: "purchaseRequests", label: "Purchase Requests", path: "purchase-requests", icon: ShoppingCart },
  { view: "lowStock", label: "Low Stock", path: "low-stock", icon: AlertTriangle },
  { view: "breakdowns", label: "Breakdowns", path: "breakdowns", icon: Wrench },
  {
    view: "maintenanceRequests",
    label: "Maintenance Requests",
    path: "maintenance-requests",
    icon: Hammer,
  },
  // After the maintenance screens rather than beside Purchase Requests: the
  // first entry is where a role lands, and placed earlier this would move the
  // board's landing off Breakdowns.
  {
    view: "lowValuePurchases",
    label: "Miscellaneous Purchases",
    path: "low-value-purchases",
    icon: ReceiptIndianRupee,
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
  // Categories and the maintenance team, combined (23 Oct 2026).
  { view: "settings", label: "Settings", path: "settings", icon: Settings },
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
