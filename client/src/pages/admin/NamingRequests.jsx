import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  ClipboardList,
  Loader2,
  Package,
  RefreshCw,
  Tag,
  Undo2,
  X,
} from "lucide-react";

import API from "../../services/api";
import { useAuth, MANAGER, VP_OPERATIONS } from "../../context/AuthContext";
import { useNotifications } from "../../context/NotificationContext";

/**
 * Item naming requests — the one request flow the store still has.
 *
 * Something arrives that nobody has a name for. The Maintenance Manager
 * proposes one against the naming convention; the Manager approves it; only
 * then does it become a catalog item, and only after that does it go to SAP.
 *
 * Approving is what creates the item, so this screen is the only way a name
 * enters the catalog. That is the point: the name is what every issue slip,
 * every audit and eventually SAP refers to the thing by.
 */

const STATE_STYLE = {
  "Awaiting Approval": "badge-amber",
  Approved: "badge-indigo",
  "In SAP": "badge-emerald",
  Rejected: "badge-rose",
};

const when = (value) => {
  if (!value) return "—";
  const d = new Date(String(value).replace(" ", "T"));
  return Number.isNaN(d.getTime())
    ? String(value)
    : d.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
};

const NamingRequests = () => {
  const { user } = useAuth();
  const { showToast } = useNotifications();
  const isManager = user?.role === MANAGER;
  /**
   * Who may approve or reject a name.
   *
   * The VP Operations, plus the Admin so a queue is not stuck when the VP is
   * away. The plant heads used to be here, which meant every name went to four
   * of them at once; naming is raised by maintenance and agreed by operations.
   *
   * Still wider than `isManager`, which gates recording the SAP code — that is
   * a claim the item exists in SAP, not a decision about what it is called.
   */
  const canDecide = isManager || user?.role === VP_OPERATIONS;

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showOpen, setShowOpen] = useState(true);
  const [busy, setBusy] = useState("");
  const [deciding, setDeciding] = useState(null);
  const [sapFor, setSapFor] = useState(null);

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const { data } = await API.get("/naming-requests", { params: { open: showOpen } });
        setRows(data);
        setError("");
      } catch (err) {
        setError(
          err.response?.data?.message || `Cannot reach the server at ${API.defaults.baseURL}.`
        );
      } finally {
        setLoading(false);
      }
    },
    [showOpen]
  );

  useEffect(() => {
    load();
  }, [load]);

  const decide = async (id, action, note = "") => {
    setBusy(id);
    try {
      const { data } = await API.post(`/naming-requests/${id}/decide`, { action, note });
      showToast(
        action === "Approve"
          ? `Approved. ${data.itemCode} is now in the catalog.`
          : `${id} is now ${data.state}`,
        "success"
      );
      setDeciding(null);
      load(true);
    } catch (err) {
      showToast(err.response?.data?.message || "That step was refused", "error");
    } finally {
      setBusy("");
    }
  };

  const stats = useMemo(
    () => ({
      waiting: rows.filter((r) => r.state === "Awaiting Approval").length,
      approved: rows.filter((r) => r.state === "Approved").length,
      offName: rows.filter((r) => r.state === "Awaiting Approval" && !r.nameCompliant).length,
    }),
    [rows]
  );

  return (
    <div className="space-y-5">
      <div className="panel">
        <div className="flex items-center gap-3">
          <span className="panel-icon">
            <ClipboardList className="h-5 w-5" />
          </span>
          <div>
            <h2 className="panel-title">Item naming requests</h2>
            <p className="panel-sub">
              {canDecide
                ? "Approving a name is what puts the item into the catalog."
                : "Names you have proposed, and where they have got to."}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn btn-sm btn-neutral" onClick={() => setShowOpen((v) => !v)}>
            {showOpen ? "Showing open" : "Showing all"}
          </button>
          <button className="btn btn-sm btn-neutral" onClick={() => load()} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="note note-rose">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="grid grid-cols-3 gap-3">
        <Stat label="Waiting on you" value={stats.waiting} tone={stats.waiting ? "amber" : ""} />
        <Stat label="Approved, not in SAP" value={stats.approved} />
        <Stat
          label="Off the naming convention"
          value={stats.offName}
          tone={stats.offName ? "rose" : ""}
        />
      </div>

      {loading ? (
        <div className="h-40 grid place-items-center">
          <Loader2 className="h-6 w-6 animate-spin text-brand-500" />
        </div>
      ) : rows.length === 0 ? (
        <div className="table-card">
          <div className="empty">
            <Package className="h-8 w-8 text-slate-300 mb-2" />
            <p className="empty-title">Nothing waiting</p>
            <p className="empty-sub">
              {showOpen
                ? "No names are waiting on a decision."
                : "No item naming requests have been raised yet."}
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <RequestCard
              key={r.id}
              request={r}
              isManager={isManager}
              canDecide={canDecide}
              busy={busy === r.id}
              onDecide={(action) =>
                action === "Approve" || action === "Reject"
                  ? setDeciding({ request: r, action })
                  : decide(r.id, action)
              }
              onRecordSap={() => setSapFor(r)}
            />
          ))}
        </div>
      )}

      {deciding && (
        <DecideModal
          request={deciding.request}
          action={deciding.action}
          onClose={() => setDeciding(null)}
          onConfirm={(note) => decide(deciding.request.id, deciding.action, note)}
          busy={busy === deciding.request.id}
        />
      )}

      {sapFor && (
        <SapModal
          request={sapFor}
          onClose={() => setSapFor(null)}
          onDone={() => {
            setSapFor(null);
            load(true);
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
      className={`mt-1 text-2xl font-bold tracking-tight ${
        tone === "rose" ? "text-rose-600" : tone === "amber" ? "text-amber-600" : "text-slate-900"
      }`}
    >
      {value}
    </p>
  </div>
);

const RequestCard = ({ request: r, isManager, canDecide, busy, onDecide, onRecordSap }) => (
  <div className="card p-5">
    <div className="flex flex-wrap items-start gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="mono text-xs text-slate-500">{r.id}</span>
          <span className={`badge ${STATE_STYLE[r.state] || "badge-slate"}`}>{r.state}</span>
          {!r.nameCompliant && (
            <span className="badge badge-rose badge-soft">Off the naming convention</span>
          )}
          {r.itemCode && <span className="badge badge-emerald badge-soft">{r.itemCode}</span>}
          {r.sapItemCode && (
            <span className="badge badge-violet badge-soft">SAP {r.sapItemCode}</span>
          )}
        </div>

        <h3 className="mt-1.5 text-base font-bold tracking-tight text-slate-900 text-balance">
          {r.proposedName}
        </h3>

        <div className="mt-2 grid sm:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-2">
          {/* Which site wanted it. The queue used to say who raised a name but
              not which company it was for, so a list of pending names read the
              same whether they all came from one plant or from four. */}
          <KV label="Plant" value={r.plant || "not recorded"} />
          <KV label="Category" value={[r.category, r.subCategory].filter(Boolean).join(" › ")} />
          <KV label="Unit" value={r.unit} />
          <KV label="Brand" value={r.brand} />
          <KV label="Rack" value={r.rackLocation} />
          <KV label="Minimum stock" value={r.minStock || "—"} />
          <KV label="Why" value={r.reason} />
          <KV label="Raised by" value={`${r.raisedBy} · ${when(r.raisedAt)}`} />
          {r.decidedBy && <KV label="Decided by" value={`${r.decidedBy} · ${when(r.decidedAt)}`} />}
        </div>

        {r.decisionNote && (
          <p className="mt-2 text-xs text-slate-600 italic">“{r.decisionNote}”</p>
        )}

        {r.waitingOn && (
          <p className="mt-2 text-xs text-slate-500">Waiting on: {r.waitingOn}</p>
        )}
      </div>

      <div className="flex shrink-0 flex-wrap gap-2">
        {canDecide && r.state === "Awaiting Approval" && (
          <>
            <button
              className="btn btn-sm btn-neutral"
              disabled={busy}
              onClick={() => onDecide("Reject")}
            >
              <X className="h-4 w-4" />
              Reject
            </button>
            <button
              className="btn btn-sm btn-primary"
              disabled={busy}
              onClick={() => onDecide("Approve")}
            >
              <Check className="h-4 w-4" />
              {busy ? "…" : "Approve"}
            </button>
          </>
        )}

        {!isManager && r.state === "Rejected" && (
          <button className="btn btn-sm btn-neutral" disabled={busy} onClick={() => onDecide("Reopen")}>
            <Undo2 className="h-4 w-4" />
            Raise again
          </button>
        )}

        {isManager && r.state === "Approved" && (
          <button className="btn btn-sm btn-primary" onClick={onRecordSap}>
            <Tag className="h-4 w-4" />
            Record SAP code
          </button>
        )}
      </div>
    </div>
  </div>
);

const KV = ({ label, value }) =>
  value ? (
    <div>
      <p className="kv-label">{label}</p>
      <p className="kv-value">{value}</p>
    </div>
  ) : null;

/**
 * Approving is not a yes/no click.
 *
 * It creates the catalog item, which is the moment the name becomes the thing
 * everything else refers to — so the name is shown once more, large, with
 * whatever the convention had to say about it, before anybody agrees.
 */
const DecideModal = ({ request: r, action, onClose, onConfirm, busy }) => {
  const [note, setNote] = useState("");
  const rejecting = action === "Reject";

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal max-w-lg" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3 className="modal-title">{rejecting ? "Reject this name" : "Approve this name"}</h3>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="modal-body space-y-4">
          <div>
            <p className="kv-label">Proposed name</p>
            <p className="text-base font-bold text-slate-900 text-balance">{r.proposedName}</p>
            <p className="mt-0.5 text-xs text-slate-500">
              {[r.category, r.subCategory].filter(Boolean).join(" › ")} · {r.unit}
              {r.brand ? ` · ${r.brand}` : ""}
            </p>
          </div>

          {!r.nameCompliant && (
            <div className="note note-amber">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>
                This name does not follow the SOI/SOP convention. It can still be approved — the
                convention cannot express everything — but it is worth a look first.
              </span>
            </div>
          )}

          {!rejecting && (
            <div className="note note-brand">
              <Package className="h-4 w-4 shrink-0" />
              <span>
                Approving creates the catalog item straight away, with no stock against it. What
                physically arrived is received separately.
              </span>
            </div>
          )}

          <div>
            <label className="field-label">
              {rejecting ? "Why it is being rejected" : "Note (optional)"}
            </label>
            <textarea
              className="field field-area"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={
                rejecting ? "What needs to change before it is raised again." : ""
              }
            />
          </div>
        </div>

        <div className="modal-foot">
          <button className="btn btn-neutral" onClick={onClose}>
            Cancel
          </button>
          <button
            className={`btn ${rejecting ? "btn-danger" : "btn-primary"}`}
            disabled={busy || (rejecting && !note.trim())}
            onClick={() => onConfirm(note)}
          >
            {busy ? "…" : rejecting ? "Reject" : "Approve and create the item"}
          </button>
        </div>
      </div>
    </div>
  );
};

/**
 * The SAP code, typed in.
 *
 * Nothing here writes to SAP yet — the Service Layer has not been proven to
 * accept a write, and a push that quietly did nothing would be worse than one
 * that refuses. This records the code somebody created by hand, which is what
 * the store is doing today anyway, and keeps the record honest in the meantime.
 */
const SapModal = ({ request: r, onClose, onDone }) => {
  const { showToast } = useNotifications();
  const [code, setCode] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await API.post(`/naming-requests/${r.id}/sap`, { sapItemCode: code });
      showToast(`${r.itemCode} carries SAP code ${code}`, "success");
      onDone();
    } catch (err) {
      showToast(err.response?.data?.message || "Could not record it", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal max-w-md" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="modal-head">
          <h3 className="modal-title">Record the SAP code</h3>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="modal-body space-y-4">
          <div>
            <p className="kv-label">Catalog item</p>
            <p className="kv-value">
              {r.itemCode} · {r.proposedName}
            </p>
          </div>

          <div>
            <label className="field-label">SAP item code</label>
            <input
              className="field mono"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="As it was created in SAP"
              required
            />
            <p className="mt-1 text-xs text-slate-500">
              Typed in for now. Writing to SAP directly waits on the Service Layer being proven.
            </p>
          </div>
        </div>

        <div className="modal-foot">
          <button type="button" className="btn btn-neutral" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving || !code.trim()}>
            {saving ? "Saving…" : "Record it"}
          </button>
        </div>
      </form>
    </div>
  );
};

export default NamingRequests;
