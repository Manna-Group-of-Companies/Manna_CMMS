/**
 * Who may see what.
 *
 * One table rather than a `requireRole(...)` list repeated across twenty route
 * files. The matrix below is the business's own, given per screen rather than
 * per endpoint, so it is written that way here and the routes ask it questions.
 * `client/src/config/access.js` mirrors it for the navigation and the route
 * guards; the two have to be changed together, and the client copy is a
 * convenience — this one is the enforcement.
 */

/**
 * The CMMS roles, as `ROLE_MAP` in integrations/erpnext/auth.js reports them.
 *
 * `Manager` is the administrator. It is not renamed to Admin because that is
 * what the ERPNext mapping already calls it and what every existing guard
 * spells; the business calls the person holding it the Admin.
 */
export const MANAGER = "Manager";
export const MAINTENANCE_MANAGER = "Maintenance Manager";
export const SUPERVISOR = "Supervisor";
/** A plant head. Scoped to their own plant everywhere it matters. */
export const PRODUCTION_MANAGER = "Production Manager";
/** The MD, the executive director and the GM, who are treated as one. */
export const HIGHER_MANAGEMENT = "Higher Management";
/** The Vice President, Operations. */
export const VP_OPERATIONS = "VP Operations";
/**
 * A hand on the maintenance team — a fitter or electrician who clocks in and
 * out and applies for leave on the phone. Sunny, Ramesh and Saji as of
 * October 2026.
 *
 * Deliberately not in `ROLES` below: that list stands for the people who work
 * the stores and the plants, and it is handed whole to the catalog and the
 * asset register. A member clocks in; they do not browse the catalog.
 */
export const MAINTENANCE_MEMBER = "Maintenance Member";

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
 * Read this as the whole of the rule: a role absent from a list does not see
 * that screen, and there is no implicit "and the Manager too" — the Manager is
 * listed everywhere it applies, because a matrix with an exception in it is a
 * matrix nobody trusts.
 *
 * The Supervisor's entries are the store console as it already stood. The
 * restrictions the business asked for are about the management roles; taking
 * screens off the store floor was not part of it.
 */
export const VIEWS = {
  /** The catalog. Everybody, but a plant head sees only their own store. */
  engineeringStock: ROLES,

  /**
   * The category tree, which re-points items when it is edited.
   *
   * The Admin is deliberately absent. Creating and deleting groups belongs to
   * maintenance, so the screen that does it is not offered to the Manager and
   * `/api/taxonomy` refuses them — see the note on WRITE in
   * routes/taxonomyRoutes.js, which had to move with this.
   */
  categories: [MAINTENANCE_MANAGER, VP_OPERATIONS, SUPERVISOR],

  /** Everything at or below its minimum. */
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
  // 25 Sep 2026: the Maintenance Manager creates items and the VP Operations approves them,
  // so the queue is theirs. Was [MANAGER, MAINTENANCE_MANAGER, VP_OPERATIONS, HIGHER_MANAGEMENT, SUPERVISOR].
  itemNaming: [MAINTENANCE_MANAGER, VP_OPERATIONS],

  /** Machines that have stopped. Plant-scoped for a plant head. */
  breakdowns: [MANAGER, MAINTENANCE_MANAGER, HIGHER_MANAGEMENT, PRODUCTION_MANAGER, SUPERVISOR],

  /** The asset register. Plant-scoped for a plant head. */
  assets: [
    MANAGER,
    MAINTENANCE_MANAGER,
    VP_OPERATIONS,
    HIGHER_MANAGEMENT,
    PRODUCTION_MANAGER,
    SUPERVISOR,
  ],

  /** Downtime and reliability across the group. */
  breakdownReport: [MANAGER, MAINTENANCE_MANAGER, VP_OPERATIONS],

  /** Value written off. */
  scrap: [MANAGER, PRODUCTION_MANAGER, HIGHER_MANAGEMENT],

  /**
   * The two Module 2 screens the restrictions said nothing about, left at the
   * audience they already had. A plant head raises and closes their own site's
   * requests, which is the reason the record exists.
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
   * The maintenance team's attendance and leave, on the phone only.
   *
   * A member punches in and out, looks at their month and applies for leave;
   * the Maintenance Manager decides their requests and keeps their leave
   * schemes. The Admin is here as the usual fallback. Which side of that a
   * role is on is decided per route in routes/attendanceRoutes.js — this only
   * says who sees the screen at all. Brought across from the field-sales app
   * on 12 Oct 2026.
   */
  attendance: [MAINTENANCE_MEMBER, MAINTENANCE_MANAGER, MANAGER],

  /**
   * The three screens that have no content yet. Kept to the Admin until they
   * do, rather than shown half-built to people who would have to be told to
   * ignore them.
   */
  stockAudits: [MANAGER],
  recipients: [MANAGER],
  users: [MANAGER],

  /**
   * The store floor. No route guards these yet — they are still served by the
   * MongoDB-era middleware — but they are named here so this file holds the
   * same set of screens as `client/src/config/access.js`. A key present in one
   * and missing from the other is exactly the drift this table exists to stop.
   */
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
// itemNaming released 25 Sep 2026 for the VP Operations, held back again 29 Sep (its approval step went on 10 Oct).
// attendance released 12 Oct 2026: it is the whole of what a Maintenance Member has, so it ships with them.
export const RELEASED = new Set(["breakdowns", "maintenanceRequests", "attendance"]);


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

/**
 * The roles that may see a screen, given the matrix and the release.
 *
 * An unreleased screen is left to the exempt roles rather than nobody, so the
 * enforcement matches what the menus offer. `requireView` reads this, so a
 * screen hidden from a role is refused at the API too, not just unlisted.
 */
export const rolesFor = (view) => {
  const allowed = VIEWS[view] || [];
  if (RELEASED.has(view)) return allowed;
  return allowed.filter((role) => RELEASE_EXEMPT.includes(role));
};

/** True when this role may see this screen. */
export const maySee = (role, view) => rolesFor(view).includes(role);

/**
 * The roles confined to their own plant.
 *
 * The confinement itself is defined in ERPNext, as User Permissions on CMMS
 * Plant — see repository/plantScope.js. This says which roles it is *read* for
 * at all, so a Manager who happens to carry a stray plant permission is not
 * narrowed by it.
 */
export const PLANT_SCOPED_ROLES = [PRODUCTION_MANAGER];

export const isPlantScoped = (role) => PLANT_SCOPED_ROLES.includes(role);

/**
 * An Express guard stated as a screen rather than a role list.
 *
 * Use this wherever an endpoint exists to serve one screen. Endpoints that
 * several screens share — the catalog, which is both Engineering Stock and Low
 * Stock — still take an explicit role list, because narrowing them to one
 * screen's audience would break the other's.
 */
export const requireView = (view) => {
  /**
   * A screen this table has never heard of is a mistake in the routes, not a
   * screen nobody may see.
   *
   * Thrown at import time, so the server refuses to start rather than starting
   * and answering 403 to every role including the Admin. That is not
   * hypothetical: `maintenanceRequests` and `preventive` were guarded here
   * before they were listed above, and `VIEWS[view] || []` turned the typo
   * into a silent deny-all that looked exactly like a permissions decision
   * somebody had made on purpose.
   */
  if (!Object.hasOwn(VIEWS, view)) {
    throw new Error(
      `requireView("${view}"): no such screen. Add it to VIEWS in config/access.js ` +
        `(and mirror it in client/src/config/access.js). Known screens: ${Object.keys(VIEWS).join(", ")}`
    );
  }

  return (req, res, next) => {
    if (!req.user || !maySee(req.user.role, view)) {
      return res.status(403).json({
        message: `Role (${req.user?.role || "none"}) is not allowed to access this resource`,
      });
    }
    return next();
  };
};
