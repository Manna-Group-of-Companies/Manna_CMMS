import { useCallback, useEffect, useMemo, useState } from "react";
import API from "../../services/api";
import { useNotifications } from "../../context/NotificationContext";
import useStockRooms from "../../hooks/useStockRooms";
import { formatCurrency } from "../../utils/currency";
import {
  AUDIT_STATUS_BADGES,
  currentPeriod,
  periodLabel,
  scoreTone,
} from "../../utils/audit";
import {
  Loader2,
  ClipboardCheck,
  Search,
  Save,
  Send,
  Plus,
  Warehouse,
  Lock,
  CheckCircle2,
  AlertTriangle,
  Calendar,
  X,
} from "lucide-react";

/**
 * The monthly count of one store room (ST-36).
 *
 * The sheet is counted blind: what the system believes a line holds stays
 * hidden until that line has been saved. A counter who can see the expected
 * figure tends to write it down, and a count that agrees with the system by
 * construction scores well while telling nobody anything. The variance appears
 * the moment the line is saved, so a genuine miscount is still caught on the
 * spot rather than a month later.
 */
const StockAudit = () => {
  const { showToast } = useNotifications();
  const rooms = useStockRooms();
  const period = currentPeriod();

  const [monthAudits, setMonthAudits] = useState([]);
  const [roomId, setRoomId] = useState("");
  const [audit, setAudit] = useState(null);
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(false);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("All"); // All | Counted | Uncounted | Variance
  /** lineId → what is in the input, before it is saved. */
  const [drafts, setDrafts] = useState({});
  const [adding, setAdding] = useState(false);

  /** This month's audits across every room, for the room strip at the top. */
  const fetchMonth = useCallback(async () => {
    try {
      const { data } = await API.get("/audits", { params: { period } });
      setMonthAudits(data);
      return data;
    } catch (error) {
      console.error("Error loading this month's audits:", error);
      return [];
    }
  }, [period]);

  /**
   * Re-reads the sheet. Deliberately leaves `drafts` alone: a save takes a
   * moment on a phone out in the store, and the counter carries on typing
   * while it lands. Clearing everything here would take those figures back off
   * the screen. Only what was actually saved is cleared, in `saveCounts`.
   */
  const fetchAudit = useCallback(
    async (id) => {
      try {
        const { data } = await API.get(`/audits/${id}`);
        setAudit(data);
      } catch (error) {
        console.error("Error loading the count sheet:", error);
        showToast("Failed to load the count sheet", "error");
      }
    },
    [showToast]
  );

  useEffect(() => {
    (async () => {
      setLoading(true);
      await fetchMonth();
      setLoading(false);
    })();
  }, [fetchMonth]);

  /** This room's audit for the month, if it has one. */
  const monthAuditId = useMemo(() => {
    const existing = monthAudits.find((row) => String(row.stockRoom?._id) === String(roomId));
    return existing ? String(existing._id) : "";
  }, [monthAudits, roomId]);

  // Picking a room loads its sheet if the month has one; otherwise the screen
  // offers to open it. Keyed on the id rather than the list, so re-reading the
  // month after a save does not fetch the same sheet a second time.
  useEffect(() => {
    if (!roomId || !monthAuditId) {
      setAudit(null);
      return;
    }
    fetchAudit(monthAuditId);
  }, [roomId, monthAuditId, fetchAudit]);

  const openCount = async () => {
    try {
      setOpening(true);
      const { data } = await API.post("/audits", { stockRoomId: roomId, period });
      showToast(data.message, "success");
      await fetchMonth();
      setAudit(data.audit);
      setDrafts({});
    } catch (error) {
      console.error("Error opening the count:", error);
      showToast(error.response?.data?.message || "Could not open the count", "error");
    } finally {
      setOpening(false);
    }
  };

  const saveCounts = async () => {
    const counts = Object.entries(drafts)
      .filter(([, value]) => value !== "")
      .map(([lineId, value]) => ({ lineId, countedQuantity: Number(value) }));

    if (counts.length === 0) {
      showToast("Nothing to save yet", "info");
      return;
    }

    try {
      setSaving(true);
      const { data } = await API.put(`/audits/${audit._id}/lines`, { counts });
      showToast(data.message, "success");
      // Only the lines that went to the server stop being pending; anything
      // typed while the save was in flight is still the counter's to save.
      setDrafts((prev) => {
        const next = { ...prev };
        for (const { lineId } of counts) {
          if (next[lineId] === drafts[lineId]) delete next[lineId];
        }
        return next;
      });
      // Re-read rather than trusting the local copy: the server refreshes each
      // line's system quantity as it saves, and those are what the variance is
      // drawn from.
      await fetchAudit(audit._id);
      await fetchMonth();
    } catch (error) {
      console.error("Error saving the count:", error);
      showToast(error.response?.data?.message || "Could not save the count", "error");
    } finally {
      setSaving(false);
    }
  };

  const submitCount = async () => {
    if (Object.keys(drafts).length > 0) {
      showToast("Save the counts you have entered before submitting", "error");
      return;
    }
    const uncounted = audit.linesTotal - audit.linesCounted;
    const warning =
      uncounted > 0
        ? `${uncounted} of ${audit.linesTotal} lines have not been counted. They score as unverified.\n\n`
        : "";
    if (
      !window.confirm(
        `${warning}Submit the ${periodLabel(audit.period)} count of ${audit.stockRoomName}? The sheet is frozen once submitted.`
      )
    ) {
      return;
    }

    try {
      setSubmitting(true);
      const { data } = await API.post(`/audits/${audit._id}/submit`);
      showToast(data.message, "success");
      setAudit(data.audit);
      await fetchMonth();
    } catch (error) {
      console.error("Error submitting the count:", error);
      showToast(error.response?.data?.message || "Could not submit the count", "error");
    } finally {
      setSubmitting(false);
    }
  };

  // Held steady across renders so the filter below is not recomputed on every
  // keystroke in an unrelated field.
  const lines = useMemo(() => audit?.lines || [], [audit]);

  const visibleLines = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return lines.filter((line) => {
      if (needle) {
        const haystack = `${line.productName} ${line.productCode} ${line.rackNumber}`.toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      const counted = line.countedQuantity !== null && line.countedQuantity !== undefined;
      if (filter === "Counted") return counted;
      if (filter === "Uncounted") return !counted;
      if (filter === "Variance") return counted && line.countedQuantity !== line.systemQuantity;
      return true;
    });
  }, [lines, search, filter]);

  const pending = Object.keys(drafts).length;
  const editable = audit?.status === "In Progress" && audit?.canCount !== false;
  const tone = scoreTone(audit?.score || 0);

  if (loading) {
    return (
      <div className="h-[60vh] flex items-center justify-center">
        <Loader2 className="h-7 w-7 text-brand-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Month and room picker */}
      <div className="p-5 rounded-2xl glass-premium border border-slate-200 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ClipboardCheck className="h-5 w-5 text-brand-600" />
            <div>
              <h3 className="text-lg font-bold text-slate-900">Monthly stock audit</h3>
              <p className="text-xs text-slate-500">
                Count one store room a month; the shelf is what counts, not the screen
              </p>
            </div>
          </div>
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 border border-slate-200 text-xs font-semibold text-slate-700">
            <Calendar className="h-3.5 w-3.5" />
            {periodLabel(period)}
          </span>
        </div>

        <div className="flex flex-wrap gap-2">
          {rooms.map((room) => {
            const existing = monthAudits.find(
              (row) => String(row.stockRoom?._id) === String(room._id)
            );
            const active = String(roomId) === String(room._id);
            return (
              <button
                key={room._id}
                onClick={() => {
                  // Counts typed but not saved belong to the room they were
                  // typed against, so leaving is worth a question.
                  if (
                    Object.keys(drafts).length > 0 &&
                    !window.confirm("Counts you have not saved will be lost. Switch store room?")
                  ) {
                    return;
                  }
                  setDrafts({});
                  setRoomId(room._id);
                }}
                className={`px-3.5 py-2 rounded-xl text-xs font-semibold border transition-all cursor-pointer flex items-center gap-2 ${
                  active
                    ? "bg-brand-600 text-white border-brand-600 shadow"
                    : "bg-white text-slate-700 border-slate-200 hover:border-brand-300"
                }`}
              >
                <Warehouse className="h-3.5 w-3.5" />
                {room.name}
                {existing ? (
                  <span
                    className={`px-1.5 py-0.5 rounded-md text-[10px] ${
                      active ? "bg-white/20 text-white" : AUDIT_STATUS_BADGES[existing.status]
                    }`}
                  >
                    {existing.status === "In Progress" ? "Open" : `${existing.score}%`}
                  </span>
                ) : (
                  <span
                    className={`px-1.5 py-0.5 rounded-md text-[10px] ${
                      active ? "bg-white/20 text-white" : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    Not counted
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {!roomId ? (
        <div className="glass-premium rounded-2xl border border-slate-200 p-12 text-center">
          <Warehouse className="h-10 w-10 text-slate-400 mx-auto mb-3" />
          <h3 className="text-base font-bold text-slate-900 mb-1">Pick a store room</h3>
          <p className="text-xs text-slate-500">
            Each room is counted once a month and scored on what the count found.
          </p>
        </div>
      ) : !audit ? (
        <div className="glass-premium rounded-2xl border border-slate-200 p-12 text-center">
          <ClipboardCheck className="h-10 w-10 text-slate-400 mx-auto mb-3" />
          <h3 className="text-base font-bold text-slate-900 mb-1">
            {periodLabel(period)} has not been counted yet
          </h3>
          <p className="text-xs text-slate-500 mb-5">
            Opening the count takes a snapshot of everything the room is holding right now.
          </p>
          <button
            onClick={openCount}
            disabled={opening}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-brand-600 text-white text-sm font-semibold shadow hover:bg-brand-700 disabled:opacity-60 cursor-pointer"
          >
            {opening ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Start the count
          </button>
        </div>
      ) : (
        <>
          {/* Score strip */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className={`glass-premium p-5 rounded-2xl border ${tone.ring}`}>
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">
                Score
              </div>
              <div className={`text-3xl font-extrabold ${tone.text}`}>{audit.score}%</div>
              <div className="mt-2 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                <div
                  className={`h-full ${tone.bar} rounded-full transition-all`}
                  style={{ width: `${audit.score}%` }}
                />
              </div>
              <p className="mt-2 text-[10px] text-slate-500">
                Matched lines over the {audit.linesTotal} on the sheet
              </p>
            </div>
            <div className="glass-premium p-5 rounded-2xl border border-slate-200">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">
                Counted
              </div>
              <div className="text-3xl font-extrabold text-slate-900">
                {audit.linesCounted}
                <span className="text-base font-bold text-slate-400">/{audit.linesTotal}</span>
              </div>
              <p className="mt-2 text-[10px] text-slate-500">{audit.coverage}% of the sheet</p>
            </div>
            <div className="glass-premium p-5 rounded-2xl border border-slate-200">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">
                Discrepancies
              </div>
              <div className="text-3xl font-extrabold text-slate-900">
                {audit.linesOver + audit.linesShort}
              </div>
              <p className="mt-2 text-[10px] text-slate-500">
                {audit.linesShort} short • {audit.linesOver} over
              </p>
            </div>
            <div className="glass-premium p-5 rounded-2xl border border-slate-200">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">
                Variance value
              </div>
              <div className="text-3xl font-extrabold text-slate-900">
                {formatCurrency(audit.varianceValue)}
              </div>
              <p className="mt-2 text-[10px] text-slate-500">
                {audit.varianceQuantity} units out either way
              </p>
            </div>
          </div>

          {/* Sheet header + actions */}
          <div className="glass-premium rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
            <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  {audit.stockRoomName}
                  <span
                    className={`px-2 py-0.5 rounded-md text-[10px] font-semibold ${
                      AUDIT_STATUS_BADGES[audit.status]
                    }`}
                  >
                    {audit.status}
                  </span>
                </h4>
                <p className="text-[11px] font-mono text-brand-700">{audit.auditNumber}</p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Search className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Name, code or rack"
                    className="pl-9 pr-3 py-2 w-56 rounded-xl border border-slate-200 bg-white text-xs focus:outline-none focus:ring-2 focus:ring-brand-500/30"
                  />
                </div>
                <div className="flex bg-slate-100 p-1.5 rounded-xl border border-slate-200">
                  {["All", "Uncounted", "Counted", "Variance"].map((option) => (
                    <button
                      key={option}
                      onClick={() => setFilter(option)}
                      className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-all cursor-pointer ${
                        filter === option
                          ? "bg-brand-600 text-white shadow"
                          : "text-slate-600 hover:text-slate-900"
                      }`}
                    >
                      {option}
                    </button>
                  ))}
                </div>

                {editable && (
                  <>
                    <button
                      onClick={() => setAdding(true)}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:border-brand-300 cursor-pointer"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Found item
                    </button>
                    <button
                      onClick={saveCounts}
                      disabled={saving || pending === 0}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900 text-white text-xs font-semibold shadow hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
                    >
                      {saving ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Save className="h-3.5 w-3.5" />
                      )}
                      Save {pending > 0 ? `(${pending})` : ""}
                    </button>
                    <button
                      onClick={submitCount}
                      disabled={submitting}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-brand-600 text-white text-xs font-semibold shadow hover:bg-brand-700 disabled:opacity-60 cursor-pointer"
                    >
                      {submitting ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Send className="h-3.5 w-3.5" />
                      )}
                      Submit
                    </button>
                  </>
                )}
              </div>
            </div>

            {editable && (
              <div className="px-5 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center gap-2 text-[11px] text-slate-600">
                <Lock className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                Counted blind — the system figure appears once the line is saved, so the count
                is what was on the shelf rather than what was expected.
              </div>
            )}

            {audit.status !== "In Progress" && (
              <div className="px-5 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center gap-2 text-[11px] text-slate-600">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                Submitted by {audit.submittedBy?.name || "—"}. The sheet is frozen; an Admin can
                reopen it if something needs correcting.
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-medium text-xs uppercase tracking-wider">
                    <th className="py-4 px-5">Engineering Stock</th>
                    <th className="py-4 px-5">Rack</th>
                    <th className="py-4 px-5 text-center">System</th>
                    <th className="py-4 px-5 text-center">Counted</th>
                    <th className="py-4 px-5 text-center">Variance</th>
                    <th className="py-4 px-5 text-right">Value</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-slate-700">
                  {visibleLines.map((line) => {
                    const counted =
                      line.countedQuantity !== null && line.countedQuantity !== undefined;
                    const variance = counted ? line.countedQuantity - line.systemQuantity : null;
                    const draft = drafts[line._id];

                    return (
                      <tr
                        key={line._id}
                        className={`hover:bg-slate-50 transition-colors ${
                          variance !== null && variance !== 0 ? "bg-rose-50/40" : ""
                        }`}
                      >
                        <td className="py-3 px-5">
                          <div className="font-bold text-slate-900 flex items-center gap-2">
                            {line.productName}
                            {line.addedDuringCount && (
                              <span className="px-1.5 py-0.5 rounded-md text-[10px] bg-amber-500/10 text-amber-600 border border-amber-500/20">
                                Found
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] font-mono text-brand-700">
                            {line.productCode || "—"}
                          </div>
                        </td>
                        <td className="py-3 px-5 text-xs font-mono text-slate-600">
                          {line.rackNumber || "—"}
                        </td>
                        <td className="py-3 px-5 text-center text-xs">
                          {counted ? (
                            <span className="font-semibold text-slate-900">
                              {line.systemQuantity} {line.unit}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-slate-400">
                              <Lock className="h-3 w-3" />
                              hidden
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-5 text-center">
                          {editable ? (
                            <input
                              type="number"
                              min="0"
                              step="1"
                              inputMode="numeric"
                              value={
                                draft !== undefined
                                  ? draft
                                  : counted
                                  ? String(line.countedQuantity)
                                  : ""
                              }
                              onChange={(event) => {
                                const value = event.target.value;
                                setDrafts((prev) => {
                                  const next = { ...prev };
                                  // Typing the saved figure back in is not a
                                  // change, so it stops being pending.
                                  if (
                                    value === "" ||
                                    (counted && Number(value) === line.countedQuantity)
                                  ) {
                                    delete next[line._id];
                                  } else {
                                    next[line._id] = value;
                                  }
                                  return next;
                                });
                              }}
                              placeholder="—"
                              className={`w-24 px-2 py-1.5 rounded-lg border text-center text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-brand-500/30 ${
                                draft !== undefined
                                  ? "border-brand-400 bg-brand-50"
                                  : "border-slate-200 bg-white"
                              }`}
                            />
                          ) : (
                            <span className="font-semibold text-slate-900">
                              {counted ? line.countedQuantity : "—"}
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-5 text-center text-xs font-bold">
                          {variance === null ? (
                            <span className="text-slate-400">—</span>
                          ) : variance === 0 ? (
                            <span className="inline-flex items-center gap-1 text-emerald-600">
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              Match
                            </span>
                          ) : (
                            <span
                              className={variance > 0 ? "text-indigo-600" : "text-rose-600"}
                            >
                              {variance > 0 ? `+${variance}` : variance}
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-5 text-right text-xs font-semibold text-slate-900">
                          {variance ? formatCurrency(Math.abs(variance) * line.unitCost) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {visibleLines.length === 0 && (
                <div className="p-12 text-center">
                  <AlertTriangle className="h-8 w-8 text-slate-400 mx-auto mb-2" />
                  <p className="text-xs text-slate-500">Nothing on the sheet matches that.</p>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {adding && (
        <FoundItemModal
          auditId={audit._id}
          onClose={() => setAdding(false)}
          onAdded={(updated) => {
            setAudit(updated);
            setAdding(false);
            fetchMonth();
          }}
        />
      )}
    </div>
  );
};

/**
 * Adds a line for stock found on a shelf the sheet did not list.
 *
 * The catalog runs to thousands of items, so the picker searches the API
 * rather than holding the whole thing in the page.
 */
const FoundItemModal = ({ auditId, onClose, onAdded }) => {
  const { showToast } = useNotifications();
  const [term, setTerm] = useState("");
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState(null);
  const [quantity, setQuantity] = useState("");
  const [note, setNote] = useState("");
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const needle = term.trim();
    if (needle.length < 2) {
      setResults([]);
      return undefined;
    }

    // Debounced: this fires on every keystroke otherwise.
    const timer = setTimeout(async () => {
      try {
        setSearching(true);
        const { data } = await API.get("/products", { params: { search: needle } });
        setResults(data.slice(0, 20));
      } catch (error) {
        console.error("Error searching the catalog:", error);
      } finally {
        setSearching(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [term]);

  const submit = async () => {
    if (!selected) {
      showToast("Pick the item that was found", "error");
      return;
    }
    try {
      setSaving(true);
      const { data } = await API.post(`/audits/${auditId}/lines`, {
        productId: selected._id,
        countedQuantity: Number(quantity || 0),
        note,
      });
      showToast(data.message, "success");
      onAdded(data.audit);
    } catch (error) {
      console.error("Error adding the found item:", error);
      showToast(error.response?.data?.message || "Could not add the item", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white border border-slate-200 shadow-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h4 className="text-sm font-bold text-slate-900">Stock found off the sheet</h4>
            <p className="text-[11px] text-slate-500">
              An item on the shelf the system does not have in this room
            </p>
          </div>
          <button
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 cursor-pointer"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="relative">
            <Search className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={term}
              onChange={(event) => {
                setTerm(event.target.value);
                setSelected(null);
              }}
              placeholder="Search the catalog by name, code or rack"
              className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30"
            />
            {searching && (
              <Loader2 className="h-4 w-4 text-brand-500 animate-spin absolute right-3 top-1/2 -translate-y-1/2" />
            )}
          </div>

          {selected ? (
            <div className="p-3 rounded-xl border border-brand-200 bg-brand-50/50">
              <div className="text-sm font-bold text-slate-900">{selected.name}</div>
              <div className="text-[10px] font-mono text-brand-700">
                {selected.code} • home room {selected.storeRoom}
              </div>
            </div>
          ) : (
            results.length > 0 && (
              <div className="max-h-52 overflow-y-auto divide-y divide-slate-200 rounded-xl border border-slate-200">
                {results.map((product) => (
                  <button
                    key={product._id}
                    onClick={() => setSelected(product)}
                    className="w-full text-left px-3 py-2.5 hover:bg-slate-50 cursor-pointer"
                  >
                    <div className="text-xs font-semibold text-slate-900">{product.name}</div>
                    <div className="text-[10px] font-mono text-brand-700">
                      {product.code} • {product.storeRoom}
                    </div>
                  </button>
                ))}
              </div>
            )
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                Quantity found
              </label>
              <input
                type="number"
                min="0"
                step="1"
                inputMode="numeric"
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                Note
              </label>
              <input
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Where it was found"
                className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30"
              />
            </div>
          </div>
        </div>

        <div className="px-5 py-4 border-t border-slate-200 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3.5 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={saving || !selected}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-brand-600 text-white text-xs font-semibold shadow hover:bg-brand-700 disabled:opacity-60 cursor-pointer"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            Add to the sheet
          </button>
        </div>
      </div>
    </div>
  );
};

export default StockAudit;
