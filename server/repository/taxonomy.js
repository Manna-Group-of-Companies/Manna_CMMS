import {
  callMethod,
  createDoc,
  deleteDoc,
  docExists,
  listAll,
  updateDoc,
} from "../integrations/erpnext/client.js";
import { MAINTENANCE_ROOT, MAINTENANCE_SUFFIX } from "../integrations/erpnext/masterData.js";
import { forgetCatalog } from "./catalog.js";

/**
 * The category tree, for settling what the catalog is actually filed under.
 *
 * These are ERPNext Item Groups beneath the maintenance root. The catalog
 * screens read them; this is where they get corrected — because the tree came
 * out of a spreadsheet and carries the spreadsheet's typos. "BERAINGS" sits
 * under "Bearings" with one item in it, and until somebody folds it in, that
 * item is invisible to anyone browsing bearings.
 *
 * Two facts shape everything here:
 *
 *   Item Group names are unique across the whole of ERPNext, and the
 *   comparison ignores case. That is why some groups carry a bracketed
 *   qualifier — "Bolt (Fasteners(MM))" — and why a rename has to be checked
 *   against every group, not just its siblings.
 *
 *   Renaming is not a relabel. ERPNext re-points every item at the new name as
 *   part of the rename, so nothing is orphaned; and renaming onto a name that
 *   already exists *merges* the two, which is the operation this tree most
 *   needs.
 */

/** The suffixes the screens hide, stripped for display. */
export const displayNameOf = (name, parent = "") => {
  let clean = String(name || "");
  if (clean.endsWith(MAINTENANCE_SUFFIX)) clean = clean.slice(0, -MAINTENANCE_SUFFIX.length);
  const qualifier = ` (${parent})`;
  if (parent && clean.endsWith(qualifier)) clean = clean.slice(0, -qualifier.length);
  return clean.trim();
};

/**
 * The whole tree, with a count against every group.
 *
 * The counts are the point. Deciding whether "BERAINGS" is a typo or a real
 * classification is impossible without knowing it holds one item and its
 * neighbour holds thirty-two.
 */
export const readTree = async () => {
  const [groups, items] = await Promise.all([
    listAll("Item Group", { fields: ["name", "parent_item_group", "is_group"] }),
    listAll("Item", { fields: ["name", "item_group", "disabled"] }),
  ]);

  const counts = new Map();
  for (const item of items) {
    // A disabled item is out of the catalog, so counting it would make an
    // empty group look occupied and stop somebody tidying it away.
    if (item.disabled) continue;
    counts.set(item.item_group, (counts.get(item.item_group) || 0) + 1);
  }

  const children = new Map();
  for (const g of groups) {
    const parent = g.parent_item_group || "";
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(g);
  }

  const taken = new Set(groups.map((g) => g.name));

  const categories = (children.get(MAINTENANCE_ROOT) || [])
    .map((cat) => {
      const subs = (children.get(cat.name) || []).map((sub) => ({
        name: sub.name,
        displayName: displayNameOf(sub.name, cat.name),
        itemCount: counts.get(sub.name) || 0,
        parent: cat.name,
      }));

      return {
        name: cat.name,
        displayName: displayNameOf(cat.name),
        // Items filed on the category itself, which ERPNext allows and the
        // import used for rows that named no sub-category.
        itemCount: counts.get(cat.name) || 0,
        totalItems: (counts.get(cat.name) || 0) + subs.reduce((s, x) => s + x.itemCount, 0),
        subCategories: subs.sort((a, b) => a.displayName.localeCompare(b.displayName)),
      };
    })
    .sort((a, b) => a.displayName.localeCompare(b.displayName));

  return {
    root: MAINTENANCE_ROOT,
    categories,
    // Items sitting on the root itself: they have no category at all, which is
    // worth surfacing rather than hiding in a tree that only shows categories.
    uncategorised: counts.get(MAINTENANCE_ROOT) || 0,
    totals: {
      categories: categories.length,
      subCategories: categories.reduce((s, c) => s + c.subCategories.length, 0),
      items: categories.reduce((s, c) => s + c.totalItems, 0) + (counts.get(MAINTENANCE_ROOT) || 0),
      empty: categories.filter((c) => c.totalItems === 0).length,
    },
    // Every name in use anywhere in ERPNext, so the client can warn about a
    // clash before the server refuses one.
    takenNames: [...taken],
  };
};

/** Case-insensitive, because ERPNext's own uniqueness check is. */
const nameIsTaken = async (name) => docExists("Item Group", String(name).trim());

/**
 * Adds a category, or a sub-category under one.
 *
 * Serially by nature: Item Group is a nested set, and ERPNext locks the
 * parent's bounds while inserting a child.
 */
export const addGroup = async ({ name, parent = "" } = {}) => {
  const clean = String(name || "").trim();
  if (!clean) throw new Error("A name is required");

  const under = String(parent || "").trim() || MAINTENANCE_ROOT;
  if (under !== MAINTENANCE_ROOT && !(await docExists("Item Group", under))) {
    throw new Error(`There is no category called "${under}"`);
  }

  if (await nameIsTaken(clean)) {
    throw new Error(
      `"${clean}" already exists. Item Group names are unique across the whole of ERPNext, ` +
        "including the production tree, so pick another or merge into the existing one."
    );
  }

  await createDoc("Item Group", {
    doctype: "Item Group",
    item_group_name: clean,
    parent_item_group: under,
    // A category is a group node so sub-categories can hang off it; a
    // sub-category is a leaf. ERPNext will not let a leaf take children.
    is_group: under === MAINTENANCE_ROOT ? 1 : 0,
  });

  forgetCatalog();
  return { name: clean, parent: under };
};

/**
 * Renames a group, or merges it into another.
 *
 * `merge` is the operation this tree exists for. Renaming "BERAINGS" onto
 * "Bearings" moves its item across and removes the empty group, in one step
 * that ERPNext performs atomically — which is the only safe way to do it,
 * because the alternative is repointing items by hand and hoping nothing is
 * missed.
 */
export const renameGroup = async ({ from, to, merge = false } = {}) => {
  const oldName = String(from || "").trim();
  const newName = String(to || "").trim();

  if (!oldName || !newName) throw new Error("Both names are required");
  if (oldName === newName) throw new Error("That is the same name");
  if (oldName === MAINTENANCE_ROOT) throw new Error("The root cannot be renamed");
  if (!(await docExists("Item Group", oldName))) throw new Error(`There is no group called "${oldName}"`);

  const exists = await nameIsTaken(newName);
  if (exists && !merge) {
    throw new Error(
      `"${newName}" already exists. Tick merge to fold "${oldName}" into it, ` +
        "or choose a different name."
    );
  }
  if (!exists && merge) {
    throw new Error(`There is nothing called "${newName}" to merge into`);
  }

  await callMethod("frappe.client.rename_doc", {
    doctype: "Item Group",
    old_name: oldName,
    new_name: newName,
    ...(merge ? { merge: 1 } : {}),
  });

  forgetCatalog();
  return { from: oldName, to: newName, merged: Boolean(merge) };
};

/**
 * Removes a group, but only an empty one.
 *
 * Deleting a group that still holds items would leave them pointing at nothing,
 * and ERPNext would refuse anyway. Saying so plainly beats surfacing a link
 * error, and the answer — merge it instead — is right there.
 */
export const removeGroup = async (name) => {
  const clean = String(name || "").trim();
  if (!clean) throw new Error("A name is required");
  if (clean === MAINTENANCE_ROOT) throw new Error("The root cannot be removed");

  const items = await listAll("Item", {
    fields: ["name"],
    filters: [["Item", "item_group", "=", clean]],
  });
  if (items.length) {
    throw new Error(
      `"${clean}" still holds ${items.length} item${items.length === 1 ? "" : "s"}. ` +
        "Merge it into another group instead of deleting it."
    );
  }

  const children = await listAll("Item Group", {
    fields: ["name"],
    filters: [["Item Group", "parent_item_group", "=", clean]],
  });
  if (children.length) {
    throw new Error(
      `"${clean}" still has ${children.length} sub-categor${children.length === 1 ? "y" : "ies"} under it.`
    );
  }

  await deleteDoc("Item Group", clean);
  forgetCatalog();
  return { removed: clean };
};

/**
 * Moves a sub-category under a different category.
 *
 * A rename in ERPNext's eyes is a change of name, not of parent, so this is a
 * separate operation — and a common one when a tree built from a spreadsheet
 * put something in the wrong place.
 */
export const moveGroup = async ({ name, newParent } = {}) => {
  const clean = String(name || "").trim();
  const parent = String(newParent || "").trim();
  if (!clean || !parent) throw new Error("Both the group and its new parent are required");
  if (clean === MAINTENANCE_ROOT) throw new Error("The root cannot be moved");
  if (clean === parent) throw new Error("A group cannot sit under itself");
  if (!(await docExists("Item Group", parent))) throw new Error(`There is no category called "${parent}"`);

  await updateDoc("Item Group", clean, { parent_item_group: parent });

  forgetCatalog();
  return { name: clean, parent };
};
