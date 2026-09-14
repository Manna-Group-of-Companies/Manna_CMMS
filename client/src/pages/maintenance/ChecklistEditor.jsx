import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Copy,
  Loader2,
  Plus,
  Printer,
  Save,
  ShieldAlert,
  Trash2,
  X,
} from "lucide-react";

import API from "../../services/api";
import ChecklistSheet from "./ChecklistSheet";
import { useNotifications } from "../../context/NotificationContext";

/**
 * One checklist, and the points on it.
 *
 * The screen the maintenance manager actually lives in: adding a point has to
 * be a two-second job, because the moment it is not, points stop being added
 * and the checklist quietly becomes whatever it was a year ago.
 *
 * Order is editable and never sorted. A round is walked in a sequence — down
 * one side of the machine and back up the other — and a list reordered by
 * anything else sends the inspector back and forth across the machine, which is
 * how points get skipped.
 *
 * Saving bumps the revision. That is not bookkeeping for its own sake: a signed
 * sheet in a file has a revision printed in its footer, and if the revision
 * never moves there is no telling which list somebody was working from.
 */

const RESPONSIBILITIES = ["", "Operator", "Fitter", "Electrician", "Maintenance Team", "Contractor"];

const ChecklistEditor = ({ id, machines, systems, canEdit, onClose, onChanged }) => {
  const { showToast } = useNotifications();

  const [checklist, setChecklist] = useState(null);
  const [points, setPoints] = useState([]);
  const [head, setHead] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [copying, setCopying] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await API.get(`/preventive/${id}`);
      setChecklist(data);
      setPoints(data.points.map((p) => ({ ...p })));
      setHead({
        title: data.title,
        responsibility: data.responsibility,
        estimatedMinutes: data.estimatedMinutes || "",
        safetyNote: data.safetyNote,
        notes: data.notes,
        effectiveFrom: data.effectiveFrom || "",
        isActive: data.isActive,
      });
      setDirty(false);
      setError("");
    } catch (err) {
      setError(err.response?.data?.message || "Could not load that checklist");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const setPoint = (i, key, value) => {
    setPoints((rows) => rows.map((r, n) => (n === i ? { ...r, [key]: value } : r)));
    setDirty(true);
  };

  const move = (i, by) => {
    setPoints((rows) => {
      const next = [...rows];
      const target = i + by;
      if (target < 0 || target >= next.length) return rows;
      [next[i], next[target]] = [next[target], next[i]];
      return next;
    });
    setDirty(true);
  };

  const addPoint = () => {
    setPoints((rows) => [
      ...rows,
      {
        // `point` must be present and a string: the input below binds straight
        // to it, and React treats an undefined value as an uncontrolled field.
        point: "",
        howToCheck: "",
        isSafety: false,
      },
    ]);
    setDirty(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      const { data } = await API.put(`/preventive/${id}`, {
        ...head,
        estimatedMinutes: Number(head.estimatedMinutes) || 0,
        points: points.filter((p) => String(p.point || "").trim()),
      });
      setChecklist(data);
      setPoints(data.points.map((p) => ({ ...p })));
      setDirty(false);
      showToast(`Saved as revision ${data.revision}`, "success");
      onChanged?.();
    } catch (err) {
      showToast(err.response?.data?.message || "Could not save", "error");
    } finally {
      setSaving(false);
    }
  };

  const close = () => {
    if (dirty && !window.confirm("There are unsaved changes. Close anyway?")) return;
    onClose();
  };

  return (
    <div className="modal-backdrop items-stretch justify-end p-0" onClick={close}>
      <div
        className="bg-white w-full max-w-3xl h-full overflow-y-auto shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {loading ? (
          <div className="h-full grid place-items-center">
            <Loader2 className="h-7 w-7 animate-spin text-brand-500" />
          </div>
        ) : error ? (
          <div className="p-6">
            <div className="note note-rose">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
            <button className="btn btn-neutral mt-4" onClick={onClose}>
              Close
            </button>
          </div>
        ) : (
          <>
            <div className="sticky top-0 z-10 bg-white border-b border-slate-200 px-6 py-4">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="mono text-sm font-semibold text-slate-900">{checklist.id}</span>
                    <span className="badge badge-brand">{checklist.frequency}</span>
                    <span className="badge badge-slate badge-soft">Rev {checklist.revision}</span>
                    {!checklist.isActive && <span className="badge badge-slate">Retired</span>}
                  </div>
                  <h2 className="mt-1 text-lg font-bold tracking-tight text-slate-900 text-balance">
                    {checklist.title}
                  </h2>
                  <p className="text-xs text-slate-500">
                    {checklist.assetName} ({checklist.asset}) · {checklist.plant}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <button className="btn btn-sm btn-neutral" onClick={() => setPrinting(true)}>
                    <Printer className="h-3.5 w-3.5" />
                    Print
                  </button>
                  {canEdit && (
                    <button
                      className="btn btn-sm btn-primary"
                      onClick={save}
                      disabled={saving || !dirty}
                    >
                      <Save className="h-3.5 w-3.5" />
                      {saving ? "Saving…" : dirty ? "Save" : "Saved"}
                    </button>
                  )}
                  <button className="modal-close" onClick={close} aria-label="Close">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>

            <div className="px-6 pb-10 space-y-5 pt-5">
              {!canEdit && (
                <div className="note note-slate">
                  <span>
                    Read only. Checklists are the standard the plant is inspected against, so only
                    maintenance writes them — you can still print this one.
                  </span>
                </div>
              )}

              <div className="card p-5 space-y-4">
                <h3 className="section-title">The sheet</h3>

                <div>
                  <label className="field-label">Title</label>
                  <input
                    className="field"
                    value={head.title}
                    disabled={!canEdit}
                    onChange={(e) => {
                      setHead((h) => ({ ...h, title: e.target.value }));
                      setDirty(true);
                    }}
                  />
                </div>

                <div className="grid sm:grid-cols-3 gap-4">
                  <div>
                    <label className="field-label">Done by</label>
                    <select
                      className="field"
                      value={head.responsibility || ""}
                      disabled={!canEdit}
                      onChange={(e) => {
                        setHead((h) => ({ ...h, responsibility: e.target.value }));
                        setDirty(true);
                      }}
                    >
                      {RESPONSIBILITIES.map((r) => (
                        <option key={r} value={r}>
                          {r || "Not decided"}
                        </option>
                      ))}
                    </select>
                    {/* Said out loud because it is the reason daily lists work
                        or do not: most daily points belong to the operator who
                        is standing there anyway. */}
                    <p className="mt-1 text-xs text-slate-500">
                      A daily round given to a fitter becomes a weekly one in practice.
                    </p>
                  </div>
                  <div>
                    <label className="field-label">Takes about (minutes)</label>
                    <input
                      type="number"
                      min="0"
                      className="field"
                      value={head.estimatedMinutes}
                      disabled={!canEdit}
                      onChange={(e) => {
                        setHead((h) => ({ ...h, estimatedMinutes: e.target.value }));
                        setDirty(true);
                      }}
                    />
                  </div>
                  <div>
                    <label className="field-label">Effective from</label>
                    <input
                      type="date"
                      className="field"
                      value={head.effectiveFrom || ""}
                      disabled={!canEdit}
                      onChange={(e) => {
                        setHead((h) => ({ ...h, effectiveFrom: e.target.value }));
                        setDirty(true);
                      }}
                    />
                  </div>
                </div>

                <div>
                  <label className="field-label">
                    <ShieldAlert className="inline h-3 w-3 mr-1" />
                    Before you start
                  </label>
                  <textarea
                    className="field field-area"
                    rows={2}
                    value={head.safetyNote || ""}
                    disabled={!canEdit}
                    placeholder="Isolate at the main switch and lock off. Permit required for work inside the mixer."
                    onChange={(e) => {
                      setHead((h) => ({ ...h, safetyNote: e.target.value }));
                      setDirty(true);
                    }}
                  />
                  <p className="mt-1 text-xs text-slate-500">
                    Printed in a box at the top of the sheet, not as a point halfway down.
                  </p>
                </div>
              </div>

              <Points
                rows={points}
                canEdit={canEdit}
                onSet={setPoint}
                onMove={move}
                onAdd={addPoint}
                onRemove={(i) => {
                  setPoints((rows) => rows.filter((_, n) => n !== i));
                  setDirty(true);
                }}
              />

              {canEdit && (
                <div className="flex flex-wrap items-center gap-2">
                  <button className="btn btn-neutral" onClick={() => setCopying(true)}>
                    <Copy className="h-4 w-4" />
                    Copy to another asset
                  </button>
                  <button
                    className="btn btn-neutral"
                    onClick={async () => {
                      if (!window.confirm(`Retire ${checklist.title}?`)) return;
                      try {
                        const { data } = await API.delete(`/preventive/${id}`);
                        showToast(
                          data.deleted ? "Deleted — it had no points" : "Retired",
                          "success"
                        );
                        onChanged?.();
                        onClose();
                      } catch (err) {
                        showToast(err.response?.data?.message || "Could not retire it", "error");
                      }
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                    Retire
                  </button>
                  {dirty && (
                    <span className="text-xs text-amber-700">
                      Unsaved changes. Saving makes this revision{" "}
                      {/^\d+$/.test(String(checklist.revision))
                        ? Number(checklist.revision) + 1
                        : "the next one"}
                      .
                    </span>
                  )}
                </div>
              )}
            </div>
          </>
        )}

        {printing && (
          <ChecklistSheet
            checklist={
              // Printed from what is on screen, unsaved edits included. A manager
              // who has just typed three points and wants to see the sheet should
              // see those three points; printing the saved version instead reads
              // as the edits having been lost.
              { ...checklist, ...head, points: points.filter((p) => String(p.point || "").trim()) }
            }
            onClose={() => setPrinting(false)}
          />
        )}

        {copying && (
          <CopyModal
            checklist={checklist}
            machines={machines}
            systems={systems}
            onClose={() => setCopying(false)}
            onDone={(created) => {
              setCopying(false);
              showToast(`Copied to ${created.assetName}`, "success");
              onChanged?.();
            }}
          />
        )}
      </div>
    </div>
  );
};

/**
 * The points themselves.
 *
 * Three columns rather than one: what to look at, how to tell, and what counts
 * as right. A point that says only "check the belt" gets a tick from anybody
 * who saw a belt.
 */
const Points = ({ rows, canEdit, onSet, onMove, onAdd, onRemove }) => (
  <div className="card p-5">
    <div className="flex items-center justify-between mb-3">
      <div>
        <h3 className="section-title">Points</h3>
        <p className="panel-sub">
          In the order the round is walked. {rows.length} point{rows.length === 1 ? "" : "s"}.
        </p>
      </div>
      {canEdit && (
        <button className="btn btn-sm btn-primary" onClick={onAdd}>
          <Plus className="h-3.5 w-3.5" />
          Add a point
        </button>
      )}
    </div>

    {rows.length === 0 ? (
      <div className="empty-inline">
        <p className="empty-sub">
          Nothing on this checklist yet. A sheet with no points on it gets signed as readily as a
          full one, so add them before anybody prints it.
        </p>
      </div>
    ) : (
      <div className="space-y-3">
        {rows.map((row, i) => (
          <div key={row.id || i} className="rounded-xl border border-slate-200 p-3 space-y-2">
            <div className="flex items-start gap-2">
              <span className="mt-2 w-6 shrink-0 text-center text-xs font-semibold text-slate-400 tabular-nums">
                {i + 1}
              </span>
              <input
                className="field field-sm flex-1"
                placeholder="What to check — bearing housing temperature"
                value={row.point}
                disabled={!canEdit}
                onChange={(e) => onSet(i, "point", e.target.value)}
              />
              {canEdit && (
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => onMove(i, -1)}
                    disabled={i === 0}
                    aria-label="Move up"
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => onMove(i, 1)}
                    disabled={i === rows.length - 1}
                    aria-label="Move down"
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    className="icon-btn icon-btn-danger"
                    onClick={() => onRemove(i)}
                    aria-label="Remove"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </div>

            {/*
              How, and nothing else.

              A point used to carry a section and an acceptance criterion too.
              Three boxes per point is what made a twelve-point list a long
              afternoon, and in practice the section repeated the obvious and
              the acceptance repeated the how. What the person at the machine
              needs is the check and the way to do it.
            */}
            <div className="pl-8">
              <input
                className="field field-sm w-full"
                placeholder="How — by hand, with a gun"
                value={row.howToCheck || ""}
                disabled={!canEdit}
                onChange={(e) => onSet(i, "howToCheck", e.target.value)}
              />
            </div>

            <label className="flex items-center gap-2 pl-8 cursor-pointer">
              <input
                type="checkbox"
                className="h-3.5 w-3.5 accent-brand-600"
                checked={Boolean(row.isSafety)}
                disabled={!canEdit}
                onChange={(e) => onSet(i, "isSafety", e.target.checked)}
              />
              <span className="text-xs text-slate-600">
                Safety point — marked on the sheet, and never quietly dropped when the list is
                trimmed
              </span>
            </label>
          </div>
        ))}
      </div>
    )}
  </div>
);

/**
 * Copying a checklist onto another machine.
 *
 * The only realistic way a plant ever gets a full set. Three of the mills are
 * the same mill, and typing the same fourteen points three times is how the
 * third one ends up with eleven of them.
 */
const CopyModal = ({ checklist, machines, systems, onClose, onDone }) => {
  const [machine, setMachine] = useState("");

  /**
   * A sheet is copied onto the same kind of asset it came from.
   *
   * A refiner's weekly round means nothing on a switchboard, and offering the
   * two lists together would make that mistake one wrong click away.
   */
  const electrical = checklist.assetKind === "electrical";
  const targets = electrical
    ? systems.map((sys) => ({ code: sys.id, name: sys.name, area: "" }))
    : machines;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const { data } = await API.post(`/preventive/${checklist.id}/copy`, { machine });
      onDone(data);
    } catch (err) {
      setError(err.response?.data?.message || "Could not copy it");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal max-w-md" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="modal-head">
          <div>
            <h3 className="modal-title">
              <Copy className="h-5 w-5 text-brand-600" />
              Copy this checklist
            </h3>
            <p className="modal-sub">
              {checklist.points.length} point{checklist.points.length === 1 ? "" : "s"}, at{" "}
              {checklist.frequency.toLowerCase()}, onto another machine.
            </p>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="modal-body space-y-4">
          {error && <div className="note note-rose">{error}</div>}
          <div>
            <label className="field-label">Machine</label>
            <select
              className="field"
              value={machine}
              onChange={(e) => setMachine(e.target.value)}
              required
            >
              <option value="">Choose the machine…</option>
              {targets
                .filter((m) => m.code !== checklist.asset)
                .map((m) => (
                  <option key={m.code} value={m.code}>
                    {/* Named the way the asset register names it: the machine
                        first, its code after. The area used to trail in brackets
                        and made every option read as a different machine from the
                        one on the register. */}
                    {m.name} — {m.code}
                  </option>
                ))}
            </select>
          </div>
          <p className="text-xs text-slate-500">
            The copy starts at revision 1 and can be edited on its own. Nothing links the two after
            this — a change here will not reach the copy.
          </p>
        </div>

        <div className="modal-foot">
          <button type="button" className="btn btn-neutral" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving || !machine}>
            {saving ? "Copying…" : "Copy it"}
          </button>
        </div>
      </form>
    </div>
  );
};

export default ChecklistEditor;
