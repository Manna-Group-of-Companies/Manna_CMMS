import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ChevronRight, FolderTree, Loader2, Merge, Pencil, Search, X } from "lucide-react";

import API from "../../services/api";
import { useAuth, MAINTENANCE_MANAGER } from "../../context/AuthContext";
import { useNotifications } from "../../context/NotificationContext";
import CategorySyncNote from "../../components/CategorySyncNote";
import { useErpRefresh } from "../../hooks/useErpRefresh";

/**
 * The engineering catalog's categories, as SAP files them: Sub-category A
 * (SAP U_SubTypeA) and Sub-category B (U_SubTypeB).
 *
 * Every item sits in the one SAP item group, Engineering Stocks, so the item
 * group is not a level here and cannot be chosen anywhere in CMMS; new items
 * go to each company's Engineering Stocks group. Renaming an A or B value
 * rewrites every item under it here at once, and SAP follows through the
 * flagged category sync on the SAP server.
 *
 * Spellings that differ only in capitals ("Tools", "TOOLS") are one category
 * here, shown under the spelling most items use.
 */

const NONE = "";
const label = (name) => name || "(none)";

const Categories = () => {
  const { user } = useAuth();
  // Kept in step with PUT /api/taxonomy/sap/rename (Maintenance Manager only).
  const canEdit = user?.role === MAINTENANCE_MANAGER;

  const [tree, setTree] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  // "" = every company; otherwise a SAP company abbreviation (MRPPL, HRI, ...).
  const [company, setCompany] = useState("");
  const [selected2, setSelected2] = useState(null); // null = nothing picked; "" = "(none)"
  const [renaming, setRenaming] = useState(null);
  const [syncKey, setSyncKey] = useState(0);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const { data } = await API.get("/taxonomy/sap");
      setTree(data);
      setError("");
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

  // The top bar's Refresh: read ERPNext again without leaving the screen.
  useErpRefresh(() => load({ silent: true }));

  /**
   * Engineering Stocks, recounted for the chosen company. Every item is in
   * that one item group, so the group is not shown as a level of its own:
   * the screen starts at Sub-category A. With a company picked, a
   * sub-category that company files nothing under is left out.
   */
  const stock = useMemo(() => {
    if (!tree) return null;
    const group =
      tree.categories.find((c) => c.name.trim().toLowerCase() === "engineering stocks") ||
      tree.categories.find((c) => c.itemCount > 0) ||
      null;
    if (!group) return null;
    const count = (n) => (company ? n.byCompany?.[company] || 0 : n.itemCount);
    return {
      ...group,
      itemCount: count(group),
      subCategories: group.subCategories
        .map((a) => ({
          ...a,
          itemCount: count(a),
          subCategoriesB: a.subCategoriesB
            .map((b) => ({ ...b, itemCount: count(b) }))
            .filter((b) => !company || b.itemCount > 0),
        }))
        .filter((a) => !company || a.itemCount > 0),
    };
  }, [tree, company]);

  // The search finds a Sub-category A by its own name or by a B under it.
  const rowsA = useMemo(() => {
    const all = stock?.subCategories || [];
    const term = search.trim().toLowerCase();
    if (!term) return all;
    return all.filter(
      (a) => a.name.toLowerCase().includes(term) || a.subCategoriesB.some((b) => b.name.toLowerCase().includes(term))
    );
  }, [stock, search]);

  const level2 = stock && selected2 !== null ? stock.subCategories.find((a) => a.name === selected2) || null : null;
  const withoutSubA = stock?.subCategories.find((a) => !a.name)?.itemCount || 0;

  return (
    <div className="space-y-5">
      <div className="panel">
        <div className="flex items-center gap-3">
          <span className="panel-icon">
            <FolderTree className="h-5 w-5" />
          </span>
          <h2 className="panel-title">Categories</h2>
        </div>
        {tree && (
          <select
            value={company}
            onChange={(e) => {
              setCompany(e.target.value);
              setSelected2(null);
            }}
            className="field field-sm w-auto cursor-pointer"
            aria-label="Filter by company"
          >
            <option value="">All companies</option>
            {Object.entries(tree.companies || {}).map(([abbr, c]) => (
              <option key={abbr} value={abbr}>
                {c.company || abbr}
              </option>
            ))}
          </select>
        )}
      </div>

      <CategorySyncNote refreshKey={syncKey} />

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
      ) : !stock ? null : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Stat label="Items" value={stock.itemCount} />
            <Stat label="No Sub-category A" value={withoutSubA} tone={withoutSubA ? "amber" : ""} />
            <Stat label="Waiting for SAP" value={tree.totals.pending} tone={tree.totals.pending ? "amber" : ""} />
          </div>

          <div className="grid gap-4 items-start lg:grid-cols-3">
            {/* The item group: Engineering Stocks, the one group every item
                is in, shown as the top of the tree and always selected. */}
            <div className="table-card">
              <div className="border-b border-slate-200 p-3">
                <p className="eyebrow">Item group</p>
              </div>
              <div className="flex items-center gap-2 bg-brand-50 px-4 py-2.5">
                <span className="min-w-0 flex-1 truncate text-sm font-bold text-brand-700">{stock.name}</span>
                <span className="badge badge-slate badge-soft shrink-0">{stock.itemCount}</span>
                <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" />
              </div>
            </div>

            <LevelList
              title="Sub-category A"
              search={
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                    <Search className="h-4 w-4" />
                  </span>
                  <input
                    className="field field-sm field-search"
                    placeholder="Search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    aria-label="Search categories"
                  />
                </div>
              }
              rows={rowsA}
              selected={selected2}
              onSelect={setSelected2}
              canEdit={canEdit}
              onRename={(name) =>
                setRenaming({ level: 2, category: stock.name, from: name, siblings: stock.subCategories.map((a) => a.name) })
              }
            />

            <LevelList
              title={level2 ? `Sub-category B · ${label(level2.name)}` : "Sub-category B"}
              show={Boolean(level2)}
              empty="Pick a Sub-category A."
              rows={level2?.subCategoriesB || []}
              canEdit={canEdit && Boolean(level2?.name)}
              onRename={(name) =>
                setRenaming({
                  level: 3,
                  category: stock.name,
                  subCategory: level2.name,
                  from: name,
                  siblings: level2.subCategoriesB.map((b) => b.name),
                })
              }
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
    </div>
  );
};

/** One column: Sub-category A or B. */
const LevelList = ({ title, search, show = true, empty = "", rows, selected, onSelect, canEdit, onRename }) => (
  <div className="table-card">
    <div className="flex items-center justify-between gap-3 border-b border-slate-200 p-3">
      <p className="eyebrow truncate">{title}</p>
      {search && <div className="w-48 shrink-0">{search}</div>}
    </div>
    {!show ? (
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
        {rows.length === 0 && <li className="px-4 py-6 text-center text-sm text-slate-500">Nothing here.</li>}
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
          {subCategory && <p className="text-[13px] text-slate-600">Under {subCategory}</p>}
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
          <p className="text-xs text-slate-500">Renames every item under “{from}”, here and in SAP.</p>
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

export default Categories;
