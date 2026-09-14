import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ChevronRight,
  FolderTree,
  Loader2,
  Merge,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react";

import API from "../../services/api";
import { useAuth, MANAGER, MAINTENANCE_MANAGER } from "../../context/AuthContext";
import { useNotifications } from "../../context/NotificationContext";

/**
 * The category tree, for settling what the catalog is filed under.
 *
 * Two panes: categories on the left, the selected one's sub-categories on the
 * right. It is a working screen rather than a browsing one — the tree came out
 * of a spreadsheet and carries its typos, and this is where they get folded in.
 *
 * The item counts are the whole point. Deciding whether "BERAINGS" is a typo or
 * a real classification is impossible until you can see it holds one item and
 * the group beside it holds thirty-one.
 */

const Categories = () => {
  const { user } = useAuth();
  const { showToast } = useNotifications();
  const canEdit = user?.role === MANAGER || user?.role === MAINTENANCE_MANAGER;

  const [tree, setTree] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState("");
  const [search, setSearch] = useState("");

  const [adding, setAdding] = useState(null);
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await API.get("/taxonomy");
      setTree(data);
      setError("");
      // Keep the selection across a reload where it still exists, so folding a
      // sub-category does not bounce you back to the top of the list.
      setSelected((current) =>
        data.categories.some((c) => c.name === current) ? current : data.categories[0]?.name || ""
      );
    } catch (err) {
      setError(err.response?.data?.message || `Cannot reach the server at ${API.defaults.baseURL}.`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const categories = useMemo(() => {
    if (!tree) return [];
    const term = search.trim().toLowerCase();
    if (!term) return tree.categories;
    // Matches a category by its own name or by any sub-category under it, so
    // searching "bolt" finds the categories that hold bolts.
    return tree.categories.filter(
      (c) =>
        c.displayName.toLowerCase().includes(term) ||
        c.subCategories.some((s) => s.displayName.toLowerCase().includes(term))
    );
  }, [tree, search]);

  const current = tree?.categories.find((c) => c.name === selected) || null;

  const remove = async (group, label) => {
    if (!window.confirm(`Remove "${label}"?`)) return;
    try {
      await API.delete(`/taxonomy/${encodeURIComponent(group)}`);
      showToast(`${label} removed`, "success");
      load();
    } catch (err) {
      showToast(err.response?.data?.message || "Could not remove it", "error");
    }
  };

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
              What the catalog is filed under. Rename, merge and tidy before it is settled.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn btn-sm btn-neutral" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
          {canEdit && (
            <button className="btn btn-sm btn-primary" onClick={() => setAdding({ parent: "" })}>
              <Plus className="h-4 w-4" />
              Add a category
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="note note-rose">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="h-40 grid place-items-center">
          <Loader2 className="h-6 w-6 animate-spin text-brand-500" />
        </div>
      ) : !tree ? null : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat label="Categories" value={tree.totals.categories} />
            <Stat label="Sub-categories" value={tree.totals.subCategories} />
            <Stat label="Items filed" value={tree.totals.items} />
            <Stat
              label="With no category"
              value={tree.uncategorised}
              tone={tree.uncategorised ? "amber" : ""}
            />
          </div>

          <div className="grid lg:grid-cols-[minmax(0,22rem)_1fr] gap-4 items-start">
            {/* --- categories --- */}
            <div className="table-card">
              <div className="p-3 border-b border-slate-200">
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                    <Search className="h-4 w-4" />
                  </span>
                  <input
                    className="field field-search"
                    placeholder="Find a category or sub-category…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    aria-label="Search categories"
                  />
                </div>
              </div>

              <ul className="max-h-[32rem] overflow-y-auto divide-y divide-slate-100">
                {categories.map((c) => (
                  <li key={c.name}>
                    <button
                      onClick={() => setSelected(c.name)}
                      className={`w-full text-left px-4 py-2.5 flex items-center gap-2 cursor-pointer transition-colors ${
                        selected === c.name ? "bg-brand-50" : "hover:bg-slate-50"
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <p
                          className={`text-sm truncate ${
                            selected === c.name ? "font-bold text-brand-700" : "font-medium text-slate-800"
                          }`}
                        >
                          {c.displayName}
                        </p>
                        <p className="text-[11px] text-slate-500">
                          {c.subCategories.length
                            ? `${c.subCategories.length} sub-categor${c.subCategories.length === 1 ? "y" : "ies"}`
                            : "no sub-categories"}
                          {c.itemCount > 0 && ` · ${c.itemCount} filed directly`}
                        </p>
                      </div>
                      <span
                        className={`badge shrink-0 ${
                          c.totalItems === 0 ? "badge-amber" : "badge-slate badge-soft"
                        }`}
                      >
                        {c.totalItems}
                      </span>
                      <ChevronRight className="h-4 w-4 text-slate-300 shrink-0" />
                    </button>
                  </li>
                ))}
                {categories.length === 0 && (
                  <li className="px-4 py-6 text-center text-sm text-slate-500">
                    Nothing matches “{search}”.
                  </li>
                )}
              </ul>
            </div>

            {/* --- the selected category --- */}
            {current ? (
              <div className="space-y-4">
                <div className="card p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="eyebrow">Category</p>
                      <h3 className="mt-0.5 text-lg font-bold tracking-tight text-slate-900 text-balance">
                        {current.displayName}
                      </h3>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {current.totalItems} item{current.totalItems === 1 ? "" : "s"} in total
                        {current.itemCount > 0 && `, ${current.itemCount} filed on the category itself`}
                      </p>
                      {current.name !== current.displayName && (
                        <p className="mt-1 text-[11px] text-slate-400 mono">
                          stored as “{current.name}” — the suffix keeps it unique in ERPNext
                        </p>
                      )}
                    </div>
                    {canEdit && (
                      <div className="flex shrink-0 gap-2">
                        <button
                          className="btn btn-sm btn-neutral"
                          onClick={() => setEditing({ group: current.name, label: current.displayName, isCategory: true })}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          Rename
                        </button>
                        <button
                          className="btn btn-sm btn-danger-soft"
                          onClick={() => remove(current.name, current.displayName)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Remove
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                <div className="table-card">
                  <div className="flex items-center justify-between p-4 pb-3">
                    <h4 className="section-title">Sub-categories</h4>
                    {canEdit && (
                      <button
                        className="btn btn-sm btn-primary"
                        onClick={() => setAdding({ parent: current.name, parentLabel: current.displayName })}
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Add
                      </button>
                    )}
                  </div>

                  {current.subCategories.length === 0 ? (
                    <div className="empty">
                      <p className="empty-title">No sub-categories</p>
                      <p className="empty-sub">
                        Items sit on the category itself, which is fine — a level nobody uses is
                        worse than none.
                      </p>
                    </div>
                  ) : (
                    <div className="table-scroll">
                      <table className="tbl">
                        <thead>
                          <tr>
                            <th>Sub-category</th>
                            <th className="text-right">Items</th>
                            {canEdit && <th></th>}
                          </tr>
                        </thead>
                        <tbody>
                          {current.subCategories.map((s) => (
                            <tr key={s.name}>
                              <td>
                                <span className="cell-title">{s.displayName}</span>
                                {s.name !== s.displayName && (
                                  <div className="mono text-[10px] text-slate-400">{s.name}</div>
                                )}
                              </td>
                              <td className="text-right tabular-nums">
                                {s.itemCount === 0 ? (
                                  <span className="badge badge-amber">empty</span>
                                ) : s.itemCount === 1 ? (
                                  <span className="badge badge-amber badge-soft">1</span>
                                ) : (
                                  s.itemCount
                                )}
                              </td>
                              {canEdit && (
                                <td className="text-right">
                                  <div className="flex justify-end gap-1">
                                    <button
                                      className="icon-btn"
                                      onClick={() =>
                                        setEditing({ group: s.name, label: s.displayName, isCategory: false })
                                      }
                                      aria-label={`Rename ${s.displayName}`}
                                    >
                                      <Pencil className="h-3.5 w-3.5" />
                                    </button>
                                    <button
                                      className="icon-btn icon-btn-danger"
                                      onClick={() => remove(s.name, s.displayName)}
                                      aria-label={`Remove ${s.displayName}`}
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                  </div>
                                </td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="table-card">
                <div className="empty">
                  <FolderTree className="h-8 w-8 text-slate-300 mb-2" />
                  <p className="empty-title">Pick a category</p>
                  <p className="empty-sub">Its sub-categories appear here.</p>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {adding && (
        <AddModal
          parent={adding.parent}
          parentLabel={adding.parentLabel}
          onClose={() => setAdding(null)}
          onSaved={() => {
            setAdding(null);
            load();
          }}
        />
      )}

      {editing && (
        <RenameModal
          group={editing.group}
          label={editing.label}
          isCategory={editing.isCategory}
          tree={tree}
          onClose={() => setEditing(null)}
          onSaved={(newName) => {
            setEditing(null);
            if (editing.isCategory) setSelected(newName);
            load();
          }}
        />
      )}
    </div>
  );
};

const Stat = ({ label, value, tone = "" }) => (
  <div className="card p-4">
    <p className="eyebrow">{label}</p>
    <p
      className={`mt-1 text-2xl font-bold tracking-tight tabular-nums ${
        tone === "amber" ? "text-amber-600" : "text-slate-900"
      }`}
    >
      {value}
    </p>
  </div>
);

const AddModal = ({ parent, parentLabel, onClose, onSaved }) => {
  const { showToast } = useNotifications();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setProblem("");
    try {
      await API.post("/taxonomy", { name, parent });
      showToast(`${name} added`, "success");
      onSaved();
    } catch (err) {
      setProblem(err.response?.data?.message || "Could not add it");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal max-w-md" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="modal-head">
          <h3 className="modal-title">
            {parent ? `Add a sub-category to ${parentLabel}` : "Add a category"}
          </h3>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="modal-body space-y-4">
          {problem && <div className="note note-rose">{problem}</div>}
          <div>
            <label className="field-label">Name</label>
            <input className="field" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
            <p className="mt-1 text-xs text-slate-500">
              Names are unique across the whole of ERPNext, including the production tree, and the
              comparison ignores case.
            </p>
          </div>
        </div>
        <div className="modal-foot">
          <button type="button" className="btn btn-neutral" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving || !name.trim()}>
            {saving ? "Adding…" : "Add it"}
          </button>
        </div>
      </form>
    </div>
  );
};

/**
 * Rename, or merge into another group.
 *
 * Merging is the operation this screen exists for, so it is offered here rather
 * than hidden behind a separate action: the moment you type a name that already
 * exists, the form stops being a rename and says so.
 */
const RenameModal = ({ group, label, isCategory, tree, onClose, onSaved }) => {
  const { showToast } = useNotifications();
  const [name, setName] = useState(label);
  const [merge, setMerge] = useState(false);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState("");

  // Warned about before the server refuses, so a merge is a deliberate tick
  // rather than a surprise.
  const clash = useMemo(() => {
    const wanted = name.trim().toLowerCase();
    if (!wanted || wanted === group.toLowerCase()) return null;
    return (tree?.takenNames || []).find((n) => n.toLowerCase() === wanted) || null;
  }, [name, group, tree]);

  useEffect(() => {
    if (!clash) setMerge(false);
  }, [clash]);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setProblem("");
    try {
      const { data } = await API.put("/taxonomy/rename", { from: group, to: name.trim(), merge });
      showToast(merge ? `Merged into ${data.to}` : `Renamed to ${data.to}`, "success");
      onSaved(data.to);
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
          <h3 className="modal-title">Rename {label}</h3>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="modal-body space-y-4">
          {problem && <div className="note note-rose">{problem}</div>}

          <div>
            <label className="field-label">New name</label>
            <input className="field" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
          </div>

          {clash && (
            <div className="note note-amber">
              <Merge className="h-4 w-4 shrink-0" />
              <div>
                <p>
                  <strong>{clash}</strong> already exists.
                </p>
                <label className="mt-2 flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-brand-600"
                    checked={merge}
                    onChange={(e) => setMerge(e.target.checked)}
                  />
                  <span>
                    Merge “{label}” into it — its items move across and this{" "}
                    {isCategory ? "category" : "sub-category"} is removed.
                  </span>
                </label>
              </div>
            </div>
          )}

          <p className="text-xs text-slate-500">
            Renaming is not just a label: ERPNext re-points every item at the new name as part of
            the same operation, so nothing is left behind.
          </p>
        </div>

        <div className="modal-foot">
          <button type="button" className="btn btn-neutral" onClick={onClose}>Cancel</button>
          <button
            type="submit"
            className={`btn ${merge ? "btn-danger" : "btn-primary"}`}
            disabled={saving || !name.trim() || (clash && !merge)}
          >
            {saving ? "Saving…" : merge ? `Merge into ${clash}` : "Rename"}
          </button>
        </div>
      </form>
    </div>
  );
};

export default Categories;
