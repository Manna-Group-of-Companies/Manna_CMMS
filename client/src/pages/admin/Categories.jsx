import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ChevronRight, FolderTree, Loader2, Merge, Pencil, Plus, RefreshCw, Search, X } from "lucide-react";

import API from "../../services/api";
import { useAuth, MAINTENANCE_MANAGER } from "../../context/AuthContext";
import { useNotifications } from "../../context/NotificationContext";
import CategorySyncNote from "../../components/CategorySyncNote";
import useAutoRefresh from "../../hooks/useAutoRefresh";

/**
 * The engineering catalog's categories, as SAP files them. Three levels:
 *
 *     1  Item group        SAP item group (per SAP company)
 *     2  Sub-category A    SAP U_SubTypeA
 *     3  Sub-category B    SAP U_SubTypeB
 *
 * Read from the items themselves (GET /api/taxonomy/sap). Renaming a level-2 or
 * level-3 value rewrites every item under it here at once, and SAP follows
 * through the flagged category sync on the SAP server. Since 9 Oct 2026 the
 * Maintenance Manager can ask for a new item group (level 1) here: the SAP
 * server creates it in SAP, copying the G/L accounts and settings of one of the
 * company's groups, within a minute. Renaming a group stays in the SAP client.
 *
 * Spellings that differ only in capitals ("Tools", "TOOLS") are one category
 * here, shown under the spelling most items use.
 */

const NONE = "";
const label = (name) => name || "(none)";

const Categories = () => {
  const { user } = useAuth();
  // Kept in step with PUT /api/taxonomy/sap/rename and POST /api/taxonomy/sap/groups
  // (Maintenance Manager only).
  const canEdit = user?.role === MAINTENANCE_MANAGER;

  const [tree, setTree] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [selected1, setSelected1] = useState("");
  const [selected2, setSelected2] = useState(null); // null = nothing picked; "" = "(none)"
  const [renaming, setRenaming] = useState(null);
  const [addingGroup, setAddingGroup] = useState(false);
  const [syncKey, setSyncKey] = useState(0);

  // [silent] is the poll while a new group waits for SAP: no spinner, no sync-note re-read.
  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const { data } = await API.get("/taxonomy/sap");
      setTree(data);
      setError("");
      setSelected1((current) =>
        data.categories.some((c) => c.name === current) ? current : data.categories[0]?.name || ""
      );
    } catch (err) {
      if (!silent) setError(err.response?.data?.message || `Cannot reach the server at ${API.defaults.baseURL}.`);
    } finally {
      if (!silent) {
        setLoading(false);
        setSyncKey((k) => k + 1);
      }
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // A new item group takes the SAP server about a minute; re-read until it is there.
  const groupRequests = tree?.groupRequests || [];
  useAutoRefresh(() => load({ silent: true }), { enabled: groupRequests.some((g) => g.status === "Queued") });

  const groups = useMemo(() => {
    if (!tree) return [];
    const term = search.trim().toLowerCase();
    if (!term) return tree.categories;
    return tree.categories.filter(
      (c) =>
        c.name.toLowerCase().includes(term) ||
        c.subCategories.some(
          (a) => a.name.toLowerCase().includes(term) || a.subCategoriesB.some((b) => b.name.toLowerCase().includes(term))
        )
    );
  }, [tree, search]);

  const level1 = tree?.categories.find((c) => c.name === selected1) || null;
  const level2 = level1 && selected2 !== null ? level1.subCategories.find((a) => a.name === selected2) || null : null;

  // A new level-1 pick resets level 2.
  useEffect(() => {
    setSelected2(null);
  }, [selected1]);

  const companyName = (abbr) => tree?.companies?.[abbr]?.company || abbr;

  return (
    <div className="space-y-5">
      <div className="panel">
        <div className="flex items-center gap-3">
          <span className="panel-icon">
            <FolderTree className="h-5 w-5" />
          </span>
          <div>
            <h2 className="panel-title">Categories</h2>
            <p className="panel-sub">
              As SAP files the engineering items: item group › Sub-category A › Sub-category B.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn btn-sm btn-neutral" onClick={() => load()} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
          {canEdit && (
            <button className="btn btn-sm btn-primary" onClick={() => setAddingGroup(true)}>
              <Plus className="h-4 w-4" />
              New item group
            </button>
          )}
        </div>
      </div>

      <CategorySyncNote refreshKey={syncKey} />

      {groupRequests.length > 0 && (
        <div className="table-card">
          <div className="p-3 border-b border-slate-200">
            <p className="eyebrow">New item groups · waiting for SAP</p>
          </div>
          <ul className="divide-y divide-slate-100">
            {groupRequests.map((g) => (
              <li key={g.id} className="px-4 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="text-sm font-semibold text-slate-800">{g.name}</span>
                <span className="text-[12px] text-slate-500">
                  {companyName(g.company)} · {g.prefix ? `codes ${g.prefix}…` : "SAP automatic numbering"}
                </span>
                <span className={`badge ${g.status === "Failed" ? "badge-rose" : "badge-amber badge-soft"}`}>
                  {g.status === "Failed" ? "Failed" : "Waiting for the SAP server"}
                </span>
                {g.error && <span className="basis-full text-[12px] text-rose-700">SAP said: {g.error}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && (
        <div className="note note-rose">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading && !tree ? (
        <div className="h-40 grid place-items-center">
          <Loader2 className="h-6 w-6 animate-spin text-brand-500" />
        </div>
      ) : !tree ? null : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat label="Item groups" value={tree.categories.length} />
            <Stat label="Items" value={tree.totals.items} />
            <Stat
              label="No Sub-category A"
              value={tree.totals.withoutSubCategory}
              tone={tree.totals.withoutSubCategory ? "amber" : ""}
            />
            <Stat label="Waiting for SAP" value={tree.totals.pending} tone={tree.totals.pending ? "amber" : ""} />
          </div>

          <div className="grid lg:grid-cols-3 gap-4 items-start">
            {/* --- level 1: SAP item groups --- */}
            <div className="table-card">
              <div className="p-3 border-b border-slate-200 space-y-2">
                <p className="eyebrow">1 · Item group (SAP)</p>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                    <Search className="h-4 w-4" />
                  </span>
                  <input
                    className="field field-search"
                    placeholder="Find a category at any level…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    aria-label="Search categories"
                  />
                </div>
              </div>
              <ul className="max-h-[32rem] overflow-y-auto divide-y divide-slate-100">
                {groups.map((c) => (
                  <li key={c.name}>
                    <button
                      onClick={() => setSelected1(c.name)}
                      className={`w-full text-left px-4 py-2.5 flex items-center gap-2 cursor-pointer transition-colors ${
                        selected1 === c.name ? "bg-brand-50" : "hover:bg-slate-50"
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <p className={`text-sm truncate ${selected1 === c.name ? "font-bold text-brand-700" : "font-medium text-slate-800"}`}>
                          {c.name}
                        </p>
                        <p className="text-[11px] text-slate-500 truncate" title={c.companies.map(companyName).join(", ")}>
                          {c.companies.join(" · ")}
                          {c.pending > 0 && ` · ${c.pending} waiting for SAP`}
                        </p>
                      </div>
                      <span className={`badge shrink-0 ${c.itemCount === 0 ? "badge-amber" : "badge-slate badge-soft"}`}>{c.itemCount}</span>
                      <ChevronRight className="h-4 w-4 text-slate-300 shrink-0" />
                    </button>
                  </li>
                ))}
                {groups.length === 0 && (
                  <li className="px-4 py-6 text-center text-sm text-slate-500">Nothing matches “{search}”.</li>
                )}
              </ul>
              <p className="px-4 py-2.5 text-[11px] text-slate-500 border-t border-slate-100">
                {canEdit ? "New item groups are created here (New item group); " : "New item groups are created here by the Maintenance Manager; "}
                renaming a group stays in the SAP client. An item is moved between its company's groups from the catalog
                (the folder button on the item).
              </p>
            </div>

            {/* --- level 2: Sub-category A --- */}
            <LevelList
              title="2 · Sub-category A (SAP SubTypeA)"
              parentLabel={level1?.name}
              rows={level1?.subCategories || []}
              selected={selected2}
              onSelect={setSelected2}
              canEdit={canEdit}
              onRename={(name) => setRenaming({ level: 2, category: level1.name, from: name, siblings: level1.subCategories.map((a) => a.name) })}
              empty="Pick an item group."
            />

            {/* --- level 3: Sub-category B --- */}
            <LevelList
              title="3 · Sub-category B (SAP SubTypeB)"
              parentLabel={level2 ? `${level1.name} › ${label(level2.name)}` : ""}
              rows={level2?.subCategoriesB || []}
              canEdit={canEdit && Boolean(level2?.name)}
              onRename={(name) =>
                setRenaming({
                  level: 3,
                  category: level1.name,
                  subCategory: level2.name,
                  from: name,
                  siblings: level2.subCategoriesB.map((b) => b.name),
                })
              }
              empty={level1 ? "Pick a Sub-category A." : "Pick an item group."}
            />
          </div>
        </>
      )}

      {renaming && (
        <RenameModal
          {...renaming}
          onClose={() => setRenaming(null)}
          onSaved={() => {
            setRenaming(null);
            load();
          }}
        />
      )}

      {addingGroup && (
        <NewGroupModal
          onClose={() => setAddingGroup(false)}
          onSaved={() => {
            setAddingGroup(false);
            load();
          }}
        />
      )}
    </div>
  );
};

/** One column of the tree: level 2 or level 3. */
const LevelList = ({ title, parentLabel, rows, selected, onSelect, canEdit, onRename, empty }) => (
  <div className="table-card">
    <div className="p-3 border-b border-slate-200">
      <p className="eyebrow">{title}</p>
      {parentLabel && <p className="mt-0.5 text-[12px] text-slate-600 truncate">under {parentLabel}</p>}
    </div>
    {!parentLabel ? (
      <div className="empty">
        <p className="empty-sub">{empty}</p>
      </div>
    ) : (
      <ul className="max-h-[32rem] overflow-y-auto divide-y divide-slate-100">
        {rows.map((row) => {
          const active = onSelect && selected === row.name;
          return (
            <li key={row.name || NONE} className={`flex items-center gap-2 px-4 py-2.5 ${active ? "bg-brand-50" : ""}`}>
              <button
                type="button"
                disabled={!onSelect}
                onClick={() => onSelect?.(row.name)}
                className={`min-w-0 flex-1 text-left ${onSelect ? "cursor-pointer" : "cursor-default"}`}
              >
                <span className={`text-sm truncate block ${row.name ? (active ? "font-bold text-brand-700" : "font-medium text-slate-800") : "italic text-slate-500"}`}>
                  {label(row.name)}
                </span>
              </button>
              <span className="badge badge-slate badge-soft shrink-0">{row.itemCount}</span>
              {canEdit && row.name && (
                <button className="icon-btn" onClick={() => onRename(row.name)} aria-label={`Rename ${row.name}`} title="Rename">
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              )}
              {onSelect && <ChevronRight className="h-4 w-4 text-slate-300 shrink-0" />}
            </li>
          );
        })}
        {rows.length === 0 && <li className="px-4 py-6 text-center text-sm text-slate-500">Nothing filed here.</li>}
      </ul>
    )}
  </div>
);

const Stat = ({ label: text, value, tone = "" }) => (
  <div className="card p-4">
    <p className="eyebrow">{text}</p>
    <p className={`mt-1 text-2xl font-bold tracking-tight tabular-nums ${tone === "amber" ? "text-amber-600" : "text-slate-900"}`}>
      {value}
    </p>
  </div>
);

/**
 * Renames a Sub-category A or B on every item under it. Typing a name that
 * already exists at that level merges the two - the items simply join it.
 */
const RenameModal = ({ level, category, subCategory, from, siblings, onClose, onSaved }) => {
  const { showToast } = useNotifications();
  const [name, setName] = useState(from);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState("");
  const what = level === 2 ? "Sub-category A" : "Sub-category B";

  const clash = useMemo(() => {
    const wanted = name.trim().toLowerCase();
    if (!wanted || wanted === from.toLowerCase()) return null;
    return (siblings || []).find((n) => n && n.toLowerCase() === wanted) || null;
  }, [name, from, siblings]);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setProblem("");
    try {
      const { data } = await API.put("/taxonomy/sap/rename", { level, category, subCategory, from, to: name.trim() });
      showToast(
        `${data.renamed} item${data.renamed === 1 ? "" : "s"} renamed${data.failures?.length ? `, ${data.failures.length} failed` : ""}. SAP is updated by the category sync.`,
        data.failures?.length ? "error" : "success"
      );
      onSaved();
    } catch (err) {
      setProblem(err.response?.data?.message || "Could not rename it");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal max-w-lg" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="modal-head">
          <h3 className="modal-title">Rename {what} “{from}”</h3>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="modal-body space-y-4">
          {problem && <div className="note note-rose">{problem}</div>}
          <p className="text-[13px] text-slate-600">
            Under {category}
            {subCategory ? ` › ${subCategory}` : ""}.
          </p>
          <div>
            <label className="field-label">New name</label>
            <input className="field" value={name} maxLength={50} onChange={(e) => setName(e.target.value)} required autoFocus />
          </div>
          {clash && (
            <div className="note note-amber">
              <Merge className="h-4 w-4 shrink-0" />
              <span>
                <strong>{clash}</strong> already exists here — the items of “{from}” will join it.
              </span>
            </div>
          )}
          <p className="text-xs text-slate-500">
            Every item under “{from}” (any capitalisation) gets the new name here at once, and in SAP when the category
            sync runs. SAP allows 50 characters.
          </p>
        </div>

        <div className="modal-foot">
          <button type="button" className="btn btn-neutral" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving || !name.trim() || name.trim() === from}>
            {saving ? "Saving…" : clash ? `Merge into ${clash}` : "Rename"}
          </button>
        </div>
      </form>
    </div>
  );
};

/** SAP's limit on an item group name. */
const GROUP_NAME_MAX = 20;
const OTHER = "__other";

/** "ENG-437" -> "ENG-": the code prefixes a company's groups already number with. */
const prefixesOf = (groups = []) => [
  ...new Set(groups.map((g) => String(g.nextCode || "").replace(/\d+$/, "")).filter(Boolean)),
];

/**
 * Asks the SAP server for a new engineering item group in one company. It is
 * created in SAP with the G/L accounts and settings of the group it copies, and
 * appears in the tree once SAP has it.
 */
const NewGroupModal = ({ onClose, onSaved }) => {
  const { showToast } = useNotifications();
  const [companies, setCompanies] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [company, setCompany] = useState("");
  const [name, setName] = useState("");
  const [prefixChoice, setPrefixChoice] = useState("");
  const [otherPrefix, setOtherPrefix] = useState("");
  const [template, setTemplate] = useState("");
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState("");

  useEffect(() => {
    API.get("/naming-requests/options")
      .then(({ data }) => {
        const list = Array.isArray(data) ? data : [];
        setCompanies(list);
        if (list.length === 1) pickCompany(list[0].abbr, list);
      })
      .catch((e) => setLoadError(e.response?.data?.message || "Could not load the SAP companies."));
  }, []);

  const chosen = (companies || []).find((c) => c.abbr === company) || null;
  const prefixes = prefixesOf(chosen?.groups);
  const clash = chosen?.groups.find((g) => g.name.toLowerCase() === name.trim().toLowerCase()) || null;
  const prefix = prefixChoice === OTHER ? otherPrefix.trim().toUpperCase() : prefixChoice;

  // A new company: its own groups, defaulting to the prefix most of them share.
  function pickCompany(abbr, list = companies) {
    const next = (list || []).find((c) => c.abbr === abbr);
    setCompany(abbr);
    setTemplate("");
    setOtherPrefix("");
    setPrefixChoice(prefixesOf(next?.groups)[0] || "");
  }

  const submit = async (e) => {
    e.preventDefault();
    setProblem("");
    if (prefixChoice === OTHER && !/^[A-Z]{1,6}-$/.test(prefix)) {
      return setProblem('A code prefix is letters followed by a dash, e.g. "ENG-" or "EL-".');
    }
    setSaving(true);
    try {
      const { data } = await API.post("/taxonomy/sap/groups", { company, name: name.trim(), prefix, template });
      showToast(`${data.name} sent to SAP. It appears under item groups once SAP has created it.`, "success");
      onSaved();
    } catch (err) {
      setProblem(err.response?.data?.message || "Could not ask for the item group");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal max-w-lg" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="modal-head">
          <h3 className="modal-title">New item group</h3>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="modal-body space-y-4">
          <p className="text-[13px] text-slate-600">
            Created in SAP by the SAP server within a minute, with the same G/L accounts as the group it copies. Items
            can be filed under it once it is created.
          </p>

          {loadError && <div className="note note-rose text-sm">{loadError}</div>}
          {!companies && !loadError && (
            <div className="flex items-center gap-2 text-slate-500 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading SAP companies…
            </div>
          )}

          {companies && (
            <>
              <div>
                <label className="field-label" htmlFor="grp-company">SAP company *</label>
                <select id="grp-company" className="field cursor-pointer" value={company} onChange={(e) => pickCompany(e.target.value)} required>
                  <option value="">Choose…</option>
                  {companies.map((c) => (
                    <option key={c.abbr} value={c.abbr}>
                      {c.company}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="field-label" htmlFor="grp-name">Group name *</label>
                <input
                  id="grp-name"
                  className="field"
                  value={name}
                  maxLength={GROUP_NAME_MAX}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Pneumatics"
                  disabled={!chosen}
                  required
                />
                <div className="mt-1 flex justify-between gap-2 text-[11px]">
                  <span className="text-rose-700">{clash ? `${chosen.company} already has “${clash.name}”.` : ""}</span>
                  <span className="text-slate-400 shrink-0">{name.length}/{GROUP_NAME_MAX} (SAP's limit)</span>
                </div>
              </div>

              <div>
                <label className="field-label" htmlFor="grp-prefix">Item code prefix</label>
                <select id="grp-prefix" className="field cursor-pointer" value={prefixChoice} onChange={(e) => setPrefixChoice(e.target.value)} disabled={!chosen}>
                  {prefixes.map((p) => (
                    <option key={p} value={p}>
                      {p} (as its other groups)
                    </option>
                  ))}
                  <option value="">SAP automatic numbering</option>
                  <option value={OTHER}>Other…</option>
                </select>
                {prefixChoice === OTHER && (
                  <input
                    className="field mono mt-2"
                    value={otherPrefix}
                    maxLength={7}
                    onChange={(e) => setOtherPrefix(e.target.value.toUpperCase())}
                    placeholder="e.g. PN-"
                    required
                  />
                )}
                <p className="mt-1 text-[11px] text-slate-500">
                  {!prefix
                    ? "SAP's automatic series gives items made in it their codes."
                    : prefixes.includes(prefix)
                      ? `Items made in it carry on the company's ${prefix} series (next ${chosen.groups.find((g) => g.nextCode.startsWith(prefix))?.nextCode}).`
                      : `Items made in it get codes ${prefix}1, ${prefix}2… (or the next free number).`}
                </p>
              </div>

              <div>
                <label className="field-label" htmlFor="grp-template">Copy accounts and settings from</label>
                <select id="grp-template" className="field cursor-pointer" value={template} onChange={(e) => setTemplate(e.target.value)} disabled={!chosen}>
                  <option value="">Automatic (the group most of its items are in)</option>
                  {(chosen?.groups || []).map((g) => (
                    <option key={g.code} value={g.name}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}

          {problem && <div className="note note-rose text-sm">{problem}</div>}
        </div>

        <div className="modal-foot">
          <button type="button" className="btn btn-neutral" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving || !chosen || !name.trim() || Boolean(clash)}>
            {saving ? "Sending…" : "Create in SAP"}
          </button>
        </div>
      </form>
    </div>
  );
};

export default Categories;
