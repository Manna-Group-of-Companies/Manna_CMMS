import { useCallback, useEffect, useState } from "react";
import {
  CalendarCheck,
  CheckCircle2,
  Circle,
  Loader2,
  Printer,
  ShieldCheck,
} from "lucide-react";

import API from "../../services/api";
import ChecklistSheet from "./ChecklistSheet";
import { useNotifications } from "../../context/NotificationContext";

/**
 * What is being done to stop this machine failing.
 *
 * Kept apart from the breakdown history on the same page, and that separation
 * is the point. The history says what the machine keeps doing; this says what
 * anybody has done about it — and until now the second was invisible, because
 * every prevention action lived a click deep inside an individual breakdown.
 * A decision nobody can find is a decision nobody chases.
 *
 * Two halves of one question:
 *
 *   the checklists    what is inspected on a schedule so a failure never happens
 *   the actions       what was changed after one did
 *
 * A machine with neither is a machine nobody is looking after, and that is only
 * ever visible with both on the same screen.
 */

const FREQUENCY_STYLE = {
  Daily: "badge-rose",
  Weekly: "badge-orange",
  Monthly: "badge-amber",
  Quarterly: "badge-cyan",
  "Half-Yearly": "badge-indigo",
  Yearly: "badge-violet",
};

const day = (v) => {
  if (!v) return "—";
  const d = new Date(String(v).replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleDateString("en-IN", { dateStyle: "medium" });
};

const today = () => new Date().toISOString().slice(0, 10);

const MachinePrevention = ({ machineId, canEdit }) => {
  const { showToast } = useNotifications();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [printing, setPrinting] = useState(null);
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    try {
      const { data: d } = await API.get(`/assets/${machineId}/prevention`);
      setData(d);
      setError("");
    } catch (err) {
      setError(err.response?.data?.message || "Could not load the preventive record");
    } finally {
      setLoading(false);
    }
  }, [machineId]);

  useEffect(() => {
    load();
  }, [load]);

  const openSheet = async (id) => {
    try {
      const { data: checklist } = await API.get(`/preventive/${id}`);
      setPrinting(checklist);
    } catch (err) {
      showToast(err.response?.data?.message || "Could not open that checklist", "error");
    }
  };

  const toggle = async (action) => {
    setBusy(action.id);
    try {
      await API.put(`/assets/${machineId}/prevention/${action.breakdown}/${action.id}`, {
        completed: !action.completed,
      });
      await load();
    } catch (err) {
      showToast(err.response?.data?.message || "Could not update that action", "error");
    } finally {
      setBusy("");
    }
  };

  if (loading) {
    return (
      <div className="card p-5">
        <h3 className="section-title mb-3">
          <ShieldCheck className="inline h-4 w-4 mr-1.5" />
          Preventive maintenance
        </h3>
        <div className="h-20 grid place-items-center">
          <Loader2 className="h-5 w-5 animate-spin text-brand-500" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card p-5">
        <h3 className="section-title mb-2">Preventive maintenance</h3>
        <div className="note note-rose">{error}</div>
      </div>
    );
  }

  const { checklists, actions, summary } = data;

  return (
    <div className="card p-5">
      <div className="mb-3">
        <h3 className="section-title">
          <ShieldCheck className="inline h-4 w-4 mr-1.5" />
          Preventive maintenance
        </h3>
        <p className="panel-sub">
          What is inspected on a schedule, and what was changed after each failure.
        </p>
      </div>

      {/* --- the checklists --------------------------------------------- */}
      <div className="mb-5">
        <div className="flex items-center justify-between mb-2">
          <p className="kv-label mb-0">
            <CalendarCheck className="inline h-3 w-3 mr-1" />
            Checklists
          </p>
          {summary.checklists > 0 && (
            <span className="text-xs text-slate-500">
              {summary.checklists} sheet{summary.checklists === 1 ? "" : "s"}
            </span>
          )}
        </div>

        {checklists.length === 0 ? (
          <div className="empty-inline">
            <p className="empty-sub">
              No checklists for this machine. Nothing is being inspected on a schedule, so every
              failure on it will be found by the machine stopping. Write one in Preventive
              Maintenance.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {checklists.map((c) => (
              <li key={c.id} className="flex items-center gap-3 py-2.5">
                <span className={`badge ${FREQUENCY_STYLE[c.frequency] || "badge-slate"} shrink-0`}>
                  {c.frequency}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-800 truncate">{c.title}</p>
                  <p className="text-xs text-slate-500">
                    {c.responsibility || "nobody assigned"} · Rev {c.revision}
                    {c.estimatedMinutes ? ` · about ${c.estimatedMinutes} min` : ""}
                    {c.isActive ? "" : " · retired"}
                  </p>
                </div>
                <button
                  className="btn btn-sm btn-neutral shrink-0"
                  onClick={() => openSheet(c.id)}
                >
                  <Printer className="h-3.5 w-3.5" />
                  Print
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* --- what was changed after a failure ---------------------------- */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="kv-label mb-0">
            <ShieldCheck className="inline h-3 w-3 mr-1" />
            Actions taken after failures
          </p>
          {summary.actions > 0 && (
            <span className="text-xs text-slate-500">
              {summary.outstanding} of {summary.actions} outstanding
              {summary.overdue > 0 && (
                <span className="text-rose-600"> · {summary.overdue} overdue</span>
              )}
            </span>
          )}
        </div>

        {actions.length === 0 ? (
          <div className="empty-inline">
            <p className="empty-sub">
              Nothing recorded. Either this machine has had no closed breakdowns, or its failures
              were repaired without anything being changed — which is how the same failure comes
              back.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {actions.map((a) => {
              const overdue = !a.completed && a.targetDate && a.targetDate < today();
              return (
                <li key={a.id} className="flex items-start gap-3 py-3">
                  <button
                    className="mt-0.5 shrink-0 cursor-pointer disabled:cursor-not-allowed"
                    onClick={() => canEdit && toggle(a)}
                    disabled={!canEdit || busy === a.id}
                    aria-label={a.completed ? "Mark as not done" : "Mark as done"}
                    title={
                      canEdit
                        ? a.completed
                          ? "Mark as not done"
                          : "Mark as done"
                        : "Only maintenance can tick these off"
                    }
                  >
                    {busy === a.id ? (
                      <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
                    ) : a.completed ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    ) : (
                      <Circle className={`h-4 w-4 ${overdue ? "text-rose-500" : "text-slate-300"}`} />
                    )}
                  </button>

                  <div className="min-w-0 flex-1">
                    <p className="text-sm">
                      <span className="font-medium text-slate-800">{a.actionType}</span>
                      <span className="text-slate-600"> — {a.description}</span>
                    </p>
                    <p className="text-xs text-slate-500">
                      {a.owner || "no owner"} · by {day(a.targetDate)}
                      {overdue && <span className="text-rose-600 font-medium"> · overdue</span>}
                      {a.completed && <span className="text-emerald-600"> · done</span>}
                    </p>
                    {/* The failure it came out of, on the row. Without it an
                        action reads as a task somebody invented rather than a
                        decision with a reason behind it. */}
                    <p className="mt-0.5 text-xs text-slate-500">
                      <span className="mono">{a.breakdown}</span>
                      {a.failureMode ? ` · ${a.failureMode}` : ""}
                      {a.repeatFailure && (
                        <span className="ml-1 badge badge-rose badge-soft">repeat</span>
                      )}
                    </p>
                    {a.rootCause && (
                      <p className="mt-0.5 text-xs text-slate-600 italic">{a.rootCause}</p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {printing && <ChecklistSheet checklist={printing} onClose={() => setPrinting(null)} />}
    </div>
  );
};

export default MachinePrevention;
