import { plainQuotes } from "../utils/quotes.js";
import { createDoc, getDoc, listDocs, updateDoc } from "../integrations/erpnext/client.js";
import { erpNow } from "../integrations/erpnext/time.js";
import { catalogProducts, forgetCatalog, levelKey } from "./catalog.js";

/**
 * The engineering catalog's three category levels, mirrored 1:1 from SAP.
 *
 *     CMMS level     ERPNext Item field        SAP Items field
 *     1 category     custom_sap_item_group     ItemsGroupCode (the group's name)
 *     2 sub-cat. A   custom_sap_sub_type_a     U_SubTypeA
 *     3 sub-cat. B   custom_sap_sub_type_b     U_SubTypeB
 *
 * This server never talks to SAP (Frappe Cloud cannot reach the SAP LAN, and
 * nor may anything but the reviewed syncs on the SAP server). An edit here
 * writes the new values onto the ERPNext Item, marks it
 * `custom_sap_category_pending`, and raises `sync_requested` on the Single
 * below. Invoke-FlagWatch.ps1 on the SAP server sees the flag and runs
 * Sync-SapItemCategories.ps1, which patches those three SAP fields and clears
 * the pending mark. (The item master sync, deployed on the SAP server.)
 *
 * Level 1 moves an item between its own SAP company's engineering item groups.
 * A new group is asked for here (requestItemGroup) and created in SAP by the
 * same sync, with the accounts of the company's existing engineering group
 * (decided 9 Oct 2026); renaming a group stays in the SAP client. Levels 2 and
 * 3 are free text in SAP (50 characters), so they can be typed, and renamed in
 * bulk - a new value reaches SAP with the item it is given to.
 */
export const CONTROL = "SAP Item Category Sync Control";

/** SAP's own limit on U_SubTypeA / U_SubTypeB. */
const SAP_TEXT_MAX = 50;

const tidy = (value) => String(value ?? "").trim().replace(/\s+/g, " ");

const badRequest = (message) => Object.assign(new Error(message), { status: 400 });

/* ------------------------------------------------------------- the control doc */

let groupsCache = null;

/**
 * Engineering item groups per company, as the sync last published them from SAP:
 * { MRPPL: { company, sap_db, groups: [{ code, name }] }, ... }
 */
const readControl = async () => getDoc(CONTROL, CONTROL);

export const engineeringGroups = async () => {
  if (groupsCache && Date.now() - groupsCache.at < 5 * 60_000) return groupsCache.map;
  const doc = await readControl();
  let map = {};
  try {
    map = JSON.parse(doc.engineering_groups || "{}");
  } catch {
    map = {};
  }
  groupsCache = { at: Date.now(), map };
  return map;
};

/** Where the SAP copy stands, for the screens. */
export const categorySyncStatus = async () => {
  const [doc, products] = await Promise.all([readControl(), catalogProducts()]);
  const pending = products.filter((p) => p.sapCategory?.pending);
  const failed = products.filter((p) => p.sapCategory?.error);
  const requested = Number(doc.sync_requested) === 1;
  return {
    // "Queued" is derived, as the stock status script does: the flag is up and
    // no run has claimed it yet. The poller owns every other status value.
    status: requested && doc.status !== "Running" ? "Queued" : doc.status || "Idle",
    dryRun: Number(doc.dry_run) === 1,
    requestedAt: doc.sync_requested_at || null,
    requestedBy: doc.sync_requested_by || "",
    lastSyncAt: doc.last_sync_at || null,
    lastRunStartedAt: doc.last_run_started_at || null,
    lastResult: doc.last_result_message || "",
    lastRowsChanged: Number(doc.last_rows_changed || 0),
    cooldownUntil: doc.cooldown_until || null,
    pendingCount: pending.length,
    failedCount: failed.length,
    failed: failed.slice(0, 20).map((p) => ({ code: p.code, name: p.name, error: p.sapCategory.error })),
  };
};

/**
 * Raises the flag. Never touches `status` - the poller owns it, and writing
 * "Queued" over a "Running" would hide a run in progress.
 *
 * One flag for the whole item master: the same run creates approved items in
 * SAP and pushes pending edits.
 */
export const raiseSapFlag = async (email) =>
  updateDoc(CONTROL, CONTROL, {
    sync_requested: 1,
    sync_requested_by: email || "",
    sync_requested_at: erpNow(),
  });
const raiseFlag = raiseSapFlag;

let optionsCache = null;

/**
 * Per-company SAP item master options, as the sync last published them:
 * { MRPPL: { company, sap_db, series, groups: [{ code, name, prefix }],
 *            next_codes: { "ENG-": 437 }, units, tax_rates, hsn: ["84819090", ...] }, ... }
 * `prefix` "" means SAP's own automatic series assigns the code.
 */
export const itemMasterOptions = async () => {
  if (optionsCache && Date.now() - optionsCache.at < 5 * 60_000) return optionsCache.map;
  const doc = await readControl();
  let map = {};
  try {
    map = JSON.parse(doc.item_master_options || "{}");
  } catch {
    map = {};
  }
  optionsCache = { at: Date.now(), map };
  return map;
};

/** Checks a value against one company's published SAP list, returning SAP's own spelling. */
export const pickFrom = (list, value, what, company) => {
  const clean = tidy(value);
  if (!clean) return "";
  const hit = (list || []).find((v) => levelKey(v) === levelKey(clean));
  if (!hit) {
    throw badRequest(`"${clean}" is not a ${what} set up in SAP for ${company}. Pick one from the list, or have it added in the SAP client first.`);
  }
  return hit;
};

/** HSN codes are compared as digits: "8481.90.90" = "84819090". */
export const pickHsn = (list, value, company) => {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return "";
  if (!(list || []).includes(digits)) {
    throw badRequest(`HSN ${digits} is not in SAP's HSN list for ${company}. New HSN codes are added in the SAP client.`);
  }
  return digits;
};

/** An HSN code as digits only: "7318.15.00" -> "73181500". */
export const hsnDigits = (value) => String(value ?? "").replace(/\D/g, "");

/**
 * Why these digits are not an HSN code, or "" when they are one.
 *
 * 4, 6 or 8 digits, in a chapter that exists: 01 to 98, and not 77, which the
 * tariff keeps empty. Checked here and in the goods receipt form alike, since
 * a code that is not in SAP's list yet is created in SAP from what is typed
 * (20 Oct 2026) and has no list to be checked against.
 */
export const hsnProblem = (digits) => {
  if (![4, 6, 8].includes(digits.length)) return "an HSN code has 4, 6 or 8 digits";
  const chapter = Number(digits.slice(0, 2));
  if (chapter < 1 || chapter > 98 || chapter === 77) return `chapter ${digits.slice(0, 2)} does not exist in the HSN`;
  return "";
};

/** SAP's Items.ItemName is 100 characters. */
export const SAP_NAME_MAX = 100;

/* ------------------------------------------------------------- editing */

const findProduct = async (code) => {
  const products = await catalogProducts();
  const product = products.find((p) => p.code === code);
  if (!product) throw Object.assign(new Error("Engineering Stock not found"), { status: 404 });
  if (!product.sapCategory) {
    throw badRequest("This item is not mirrored from SAP, so it has no SAP category to edit.");
  }
  return product;
};

/** The level-1 groups an item may be moved to: its own SAP company's engineering groups. */
export const categoryOptionsFor = async (code) => {
  const product = await findProduct(code);
  const map = await engineeringGroups();
  const entry = map[product.sapCategory.company];
  return {
    code: product.code,
    company: entry?.company || product.sapCategory.company,
    sapDb: entry?.sap_db || "",
    groups: (entry?.groups || []).map((g) => g.name),
    current: {
      category: product.sapCategory.group,
      subCategory: product.sapCategory.subTypeA,
      subCategoryB: product.sapCategory.subTypeB,
    },
    pending: product.sapCategory.pending,
    error: product.sapCategory.error,
  };
};

const checkText = (label, value) => {
  const clean = tidy(value);
  if (clean.length > SAP_TEXT_MAX) {
    throw badRequest(`${label} can be at most ${SAP_TEXT_MAX} characters - that is SAP's limit.`);
  }
  return clean;
};

/**
 * Re-files one item. Writes ERPNext, marks it pending, raises the SAP flag.
 *
 * @returns the fresh catalog row
 */
export const updateItemCategory = async (code, { category, subCategory, subCategoryB }, user) => {
  const options = await categoryOptionsFor(code);

  const wanted = tidy(category) || options.current.category;
  const group = options.groups.find((g) => levelKey(g) === levelKey(wanted));
  if (!group) {
    throw badRequest(
      `"${wanted}" is not an engineering item group of ${options.company} in SAP. ` +
        `Choose one of: ${options.groups.join(", ")}. A new item group is added on the Categories page first.`
    );
  }
  const a = checkText("Sub-category A", subCategory);
  const b = checkText("Sub-category B", subCategoryB);
  if (b && !a) throw badRequest("Sub-category B needs a Sub-category A above it.");

  const unchanged =
    group === options.current.category &&
    a === options.current.subCategory &&
    b === options.current.subCategoryB;
  if (unchanged) return (await catalogProducts()).find((p) => p.code === code);

  await updateDoc("Item", code, {
    custom_sap_item_group: group,
    custom_sap_sub_type_a: a,
    custom_sap_sub_type_b: b,
    custom_sap_category_pending: 1,
    custom_sap_category_error: "",
  });
  await raiseFlag(user?.email);
  forgetCatalog();
  return (await catalogProducts()).find((p) => p.code === code);
};

/**
 * Renames a level-2 or level-3 value on every item filed under it.
 *
 * Matches case-insensitively, as the screens group them, so renaming "Tools"
 * also rewrites the items SAP holds as "TOOLS". Level 1 is not renamed here:
 * a SAP item group's name is SAP configuration.
 */
export const renameCategoryValue = async ({ level, category, subCategory, from, to }, user) => {
  const lvl = Number(level);
  if (lvl !== 2 && lvl !== 3) {
    throw badRequest("Only Sub-category A (level 2) and Sub-category B (level 3) can be renamed here. Item groups are renamed in the SAP client.");
  }
  const label = lvl === 2 ? "Sub-category A" : "Sub-category B";
  const target = checkText(label, to);
  if (!target) throw badRequest(`Give the new name for this ${label}.`);
  if (!tidy(from)) throw badRequest(`Say which ${label} to rename.`);
  if (lvl === 3 && !tidy(subCategory)) throw badRequest("Say which Sub-category A it sits under.");

  const products = (await catalogProducts()).filter(
    (p) =>
      p.sapCategory &&
      levelKey(p.category) === levelKey(category) &&
      (lvl === 2
        ? levelKey(p.subCategory) === levelKey(from)
        : levelKey(p.subCategory) === levelKey(subCategory) &&
          levelKey(p.subCategoryB) === levelKey(from))
  );
  if (!products.length) throw Object.assign(new Error(`No items are filed under "${from}".`), { status: 404 });

  const field = lvl === 2 ? "custom_sap_sub_type_a" : "custom_sap_sub_type_b";
  const current = (p) => (lvl === 2 ? p.sapCategory.subTypeA : p.sapCategory.subTypeB);
  const todo = products.filter((p) => current(p) !== target);

  // A few at a time: Frappe Cloud is fine with that, and a rename of a large
  // category should not take minutes.
  const failures = [];
  for (let i = 0; i < todo.length; i += 4) {
    await Promise.all(
      todo.slice(i, i + 4).map((p) =>
        updateDoc("Item", p.code, { [field]: target, custom_sap_category_pending: 1, custom_sap_category_error: "" })
          .catch((error) => failures.push(`${p.code}: ${error.message}`))
      )
    );
  }
  if (todo.length > failures.length) await raiseFlag(user?.email);
  forgetCatalog();
  return { renamed: todo.length - failures.length, alreadyNamed: products.length - todo.length, failures };
};

/* ------------------------------------------------------------- the rest of the item master */

/**
 * Edits a SAP-mirrored item: description (the SOP name), foreign name, HSN,
 * tax rate, minimum stock, brand, and the three category levels.
 *
 * Every field but brand is a SAP field, so a change marks the item pending and
 * raises the flag; the sync patches SAP (ItemName, ForeignName, ChapterID,
 * U_TaxRate, MinInventory, ItemsGroupCode, U_SubTypeA/B). Brand is the CMMS's
 * own. The unit is not editable: SAP refuses a new inventory unit once an item
 * has transactions.
 */
export const updateSapItem = async (code, body = {}, user, { resolveName, ensureBrand } = {}) => {
  const product = await findProduct(code);
  const options = (await itemMasterOptions())[product.sapCategory.company];
  if (!options) throw badRequest(`No SAP options are published for ${product.sapCategory.company} yet.`);
  const company = options.company || product.sapCategory.company;

  const edits = {};
  let sapChanged = false;
  const set = (field, value, current, sap = true) => {
    if (value === undefined) return;
    if (String(value ?? "") === String(current ?? "")) return;
    edits[field] = value;
    if (sap) sapChanged = true;
  };

  if (body.name !== undefined || body.naming) {
    const resolved = resolveName({ name: body.name, naming: body.naming || null });
    // Plain quotes, as a new item's name has them - see utils/quotes.js.
    const name = tidy(plainQuotes(resolved.name));
    if (!name) throw badRequest("The description (item name) cannot be empty.");
    if (name.length > SAP_NAME_MAX) throw badRequest(`The description can be at most ${SAP_NAME_MAX} characters - that is SAP's limit.`);
    set("item_name", name, product.name);
    if (edits.item_name) edits.description = name;
  }
  if (body.foreignName !== undefined) {
    const foreign = tidy(body.foreignName);
    if (foreign.length > SAP_NAME_MAX) throw badRequest(`The foreign name can be at most ${SAP_NAME_MAX} characters.`);
    set("custom_sap_foreign_name", foreign, product.foreignName);
  }
  if (body.hsnCode !== undefined) set("custom_sap_hsn_code", pickHsn(options.hsn, body.hsnCode, company), product.hsnCode);
  if (body.taxRate !== undefined) set("custom_sap_tax_rate", pickFrom(options.tax_rates, body.taxRate, "tax rate", company), product.taxRate);
  if (body.minStock !== undefined) {
    const min = Number(body.minStock);
    if (!Number.isFinite(min) || min < 0) throw badRequest("Minimum stock must be zero or more.");
    set("safety_stock", min, product.minStock);
  }
  if (body.brand !== undefined) {
    const brand = tidy(body.brand);
    if (brand && brand !== product.brand) await ensureBrand(brand);
    set("brand", brand, product.brand, false);
  }

  const levels = ["category", "subCategory", "subCategoryB"].some((k) => body[k] !== undefined);
  if (Object.keys(edits).length) {
    await updateDoc("Item", code, {
      ...edits,
      ...(sapChanged ? { custom_sap_category_pending: 1, custom_sap_category_error: "" } : {}),
    });
    if (sapChanged) await raiseFlag(user?.email);
    forgetCatalog();
  }
  // The category levels have their own rules (the company's groups, B needs A).
  if (levels) {
    return updateItemCategory(
      code,
      {
        category: body.category ?? product.sapCategory.group,
        subCategory: body.subCategory ?? product.sapCategory.subTypeA,
        subCategoryB: body.subCategoryB ?? product.sapCategory.subTypeB,
      },
      user
    );
  }
  return (await catalogProducts()).find((p) => p.code === code);
};

/* ------------------------------------------------------------- new item groups */

const GROUP_REQUEST = "CMMS SAP Item Group Request";

/** SAP's OITB.ItmsGrpNam is 20 characters. */
const SAP_GROUP_NAME_MAX = 20;

const toGroupRequest = (row) => ({
  id: row.name,
  company: row.company,
  name: row.group_name,
  prefix: row.code_prefix || "",
  status: row.status || "Queued",
  sapGroupCode: row.sap_group_code || null,
  error: row.error || "",
  raisedBy: row.raised_by || "",
  raisedAt: row.raised_at || null,
});

export const listItemGroupRequests = async ({ limit = 50 } = {}) =>
  (
    await listDocs(GROUP_REQUEST, {
      fields: ["name", "company", "group_name", "code_prefix", "status", "sap_group_code", "error", "raised_by", "raised_at"],
      orderBy: "creation desc",
      limit,
    })
  ).map(toGroupRequest);

/**
 * Asks for a new engineering item group in one SAP company.
 *
 * The sync creates it in SAP copying every account and setting of the
 * company's existing engineering group (`template`, by default the one most of
 * its items are in), then publishes it, so items can be filed under it.
 *
 * @param prefix  item code prefix for items made in it ("ENG-", "EL-"), or "" for SAP's automatic numbering
 */
export const requestItemGroup = async ({ company, name, prefix = "", template = "" } = {}, user) => {
  const abbr = tidy(company).toUpperCase();
  const options = (await itemMasterOptions())[abbr];
  if (!options) throw badRequest("Choose the SAP company the item group is for.");
  const label = options.company || abbr;

  const groupName = tidy(name);
  if (!groupName) throw badRequest("Give the new item group a name.");
  if (groupName.length > SAP_GROUP_NAME_MAX) throw badRequest(`An item group name can be at most ${SAP_GROUP_NAME_MAX} characters - that is SAP's limit.`);
  if ((options.groups || []).some((g) => levelKey(g.name) === levelKey(groupName))) {
    throw badRequest(`${label} already has an item group called "${groupName}".`);
  }
  const waiting = await listDocs(GROUP_REQUEST, {
    fields: ["name"],
    filters: [[GROUP_REQUEST, "company", "=", abbr], [GROUP_REQUEST, "group_name", "=", groupName], [GROUP_REQUEST, "status", "in", ["Queued", "Failed"]]],
    limit: 1,
  });
  if (waiting.length) throw badRequest(`"${groupName}" is already waiting to be created in SAP (${waiting[0].name}).`);

  const cleanPrefix = tidy(prefix).toUpperCase();
  if (cleanPrefix && !/^[A-Z]{1,6}-$/.test(cleanPrefix)) throw badRequest(`A code prefix is letters followed by a dash, e.g. "ENG-" or "EL-" - or leave it empty for SAP's automatic numbering.`);

  // The template: the group named, else the group with the most of this company's items.
  const products = await catalogProducts();
  const counts = new Map();
  for (const p of products) if (p.sapCategory?.company === abbr) counts.set(levelKey(p.sapCategory.group), (counts.get(levelKey(p.sapCategory.group)) || 0) + 1);
  const groups = options.groups || [];
  if (!groups.length) throw badRequest(`${label} has no engineering item group in SAP to copy the accounts from.`);
  const base =
    groups.find((g) => levelKey(g.name) === levelKey(template)) ||
    [...groups].sort((x, y) => (counts.get(levelKey(y.name)) || 0) - (counts.get(levelKey(x.name)) || 0))[0];

  const created = await createDoc(GROUP_REQUEST, {
    doctype: GROUP_REQUEST,
    company: abbr,
    group_name: groupName,
    code_prefix: cleanPrefix,
    template_group_code: Number(base.code),
    status: "Queued",
    raised_by: user?.email || "",
    raised_at: erpNow(),
  });
  await raiseFlag(user?.email);
  return toGroupRequest(await getDoc(GROUP_REQUEST, created.name));
};

/* ------------------------------------------------------------- the tree */

/**
 * The three-level tree for the category screen, from the items themselves.
 *
 * Level 1 lists every engineering item group SAP has for any company, even an
 * empty one, with the companies it belongs to. Levels 2 and 3 are the values
 * in use. Items not mirrored from SAP are counted apart, not filed.
 */
export const readSapTree = async () => {
  const [products, map, groupRequests] = await Promise.all([
    catalogProducts(),
    engineeringGroups(),
    listItemGroupRequests().catch(() => []),
  ]);

  const tree = new Map();
  const node = (name) => {
    const key = levelKey(name);
    if (!tree.has(key)) tree.set(key, { name, companies: new Set(), itemCount: 0, pending: 0, subs: new Map(), engineering: false });
    return tree.get(key);
  };
  for (const [abbr, entry] of Object.entries(map)) {
    for (const g of entry.groups || []) {
      const n = node(g.name);
      n.companies.add(abbr);
      // One of SAP's engineering item groups, as opposed to a group that is
      // here only because some item is filed under it.
      n.engineering = true;
    }
  }

  let notFromSap = 0;
  for (const p of products) {
    if (!p.sapCategory) {
      notFromSap += 1;
      continue;
    }
    const top = node(p.category);
    top.name = p.category; // the shown spelling
    top.companies.add(p.sapCategory.company);
    top.itemCount += 1;
    if (p.sapCategory.pending) top.pending += 1;
    // Per company as well, so a screen filtered to one company counts only
    // that company's items at every level.
    const co = p.sapCategory.company;
    const bump = (n) => {
      n.byCompany ??= {};
      n.byCompany[co] = (n.byCompany[co] || 0) + 1;
    };
    bump(top);

    const aKey = levelKey(p.subCategory);
    if (!top.subs.has(aKey)) top.subs.set(aKey, { name: p.subCategory, itemCount: 0, subs: new Map() });
    const a = top.subs.get(aKey);
    a.itemCount += 1;
    bump(a);

    const bKey = levelKey(p.subCategoryB);
    if (!a.subs.has(bKey)) a.subs.set(bKey, { name: p.subCategoryB, itemCount: 0 });
    a.subs.get(bKey).itemCount += 1;
    bump(a.subs.get(bKey));
  }

  const byName = (x, y) => (x.name || "\uffff").localeCompare(y.name || "\uffff");
  const categories = [...tree.values()]
    .map((c) => ({
      name: c.name,
      // True for SAP's engineering item groups; false for a group that is in
      // the tree only because some item is filed under it.
      engineering: c.engineering,
      companies: [...c.companies].sort(),
      itemCount: c.itemCount,
      byCompany: c.byCompany || {},
      pending: c.pending,
      subCategories: [...c.subs.values()]
        .map((a) => ({
          name: a.name, // "" = items with no Sub-category A
          itemCount: a.itemCount,
          byCompany: a.byCompany || {},
          subCategoriesB: [...a.subs.values()]
            .map((b) => ({ name: b.name, itemCount: b.itemCount, byCompany: b.byCompany || {} }))
            .sort(byName),
        }))
        .sort(byName),
    }))
    .sort(byName);

  return {
    categories,
    // New groups asked for and not yet created in SAP (and failures to fix).
    groupRequests: groupRequests.filter((r) => r.status !== "Created"),
    companies: Object.fromEntries(Object.entries(map).map(([abbr, e]) => [abbr, { company: e.company, sapDb: e.sap_db }])),
    totals: {
      items: products.length - notFromSap,
      notFromSap,
      withoutSubCategory: products.filter((p) => p.sapCategory && !p.subCategory).length,
      pending: products.filter((p) => p.sapCategory?.pending).length,
    },
  };
};
