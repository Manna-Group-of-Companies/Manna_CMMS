import { listDocs } from "../integrations/erpnext/client.js";
import { resolveStore } from "../integrations/erpnext/stores.js";
import { isPlantScoped } from "../config/access.js";

/**
 * Which plants a person is confined to.
 *
 * Defined in ERPNext as User Permissions on CMMS Plant, and applied here. It
 * lives in its own module because more than one screen needs the same answer,
 * and two copies of a rule about who may see what is one copy too many.
 *
 * ERPNext would enforce these itself if every read were made as that person.
 * They are not: reads go through the integration account, and fall back to it
 * whenever a Frappe session has expired — so a scoped user would quietly see
 * every plant the first time their session lapsed. ERPNext stays the place the
 * scope is *defined*; this is where it is *applied*.
 *
 * An empty list means unscoped, not "no plants". Somebody with no permission
 * set sees everything, which is how a Manager who runs the whole group works —
 * and giving them one plant permission is all it takes to narrow them.
 */
export const plantsFor = async (email) => {
  if (!email) return [];

  const rows = await listDocs("User Permission", {
    fields: ["for_value"],
    filters: [
      ["User Permission", "user", "=", email],
      ["User Permission", "allow", "=", "CMMS Plant"],
    ],
    limit: 20,
  }).catch(() => []);

  return rows.map((r) => r.for_value).filter(Boolean);
};


/**
 * The store rooms that belong to a set of plants.
 *
 * A site's plant and its store carry the same name, so this is a lookup rather
 * than a table — see the note on `STORES`. A plant with no store of its own
 * simply contributes nothing, which is the honest answer: there are no shelves
 * there to show.
 */
export const storesForPlants = (plants) =>
  (plants || [])
    .map((plant) => resolveStore(plant))
    .filter(Boolean)
    .map((store) => store.label);

/**
 * What one signed-in person is confined to.
 *
 * The single place a controller should ask.
 *
 * `plants` and `stores` are `null` for a role that is not confined at all, and
 * an array otherwise — and an empty array means *nothing*, not everything.
 * That distinction is the whole point of returning null rather than `[]`: a
 * plant head whose ERPNext permission is missing must see no plant, not every
 * plant, and an `if (list.length)` test somewhere downstream would have given
 * them the run of the group. `plantsFor` reads the other way round on purpose
 * — there, empty means unscoped — so the two are not interchangeable.
 */
export const scopeFor = async (user) => {
  if (!isPlantScoped(user?.role)) {
    return { scoped: false, plants: null, stores: null };
  }

  const plants = await plantsFor(user.email);
  return { scoped: true, plants, stores: storesForPlants(plants) };
};

/** True when a scope permits this plant. An unscoped one permits every plant. */
export const withinScope = (scope, plant) => !scope?.scoped || scope.plants.includes(plant);
