import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  ClipboardList,
  Loader2,
  Package,
  RefreshCw,
  Send,
  Undo2,
  X,
} from "lucide-react";

import API from "../../services/api";
import { useAuth, MANAGER, MAINTENANCE_MANAGER, VP_OPERATIONS } from "../../context/AuthContext";
import { useNotifications } from "../../context/NotificationContext";

/**
 * New engineering items, on their way into SAP.
 *
 * The Maintenance Manager fills in the SAP item master fields and sends the
 * item for approval; the VP Operations approves or rejects it. Approving queues
 * it for the SAP server, which creates it in SAP with the company's next item
 * code and adds it to the catalog - the request then reads "In SAP" with the
 * code. A failed creation says why, and the Maintenance Manager can send it
 * again. (Decided 25 Sep 2026.)
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
  // Mirrors the server: the VP Operations approves or rejects; the Maintenance
  // Manager raises, re-raises a rejected request and re-sends a failed one.
  const canDecide = user?.role === VP_OPERATIONS;
  const isMaintenance = user?.role === MAINTENANCE_MANAGER;

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
          ? `Approved. The SAP server will create ${data.proposedName} in SAP.`
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

  const retry = async (id) => {
    setBusy(id);
    try {
      await API.post(`/naming-requests/${id}/retry`);
      showToast(`${id} sent to SAP again`, "success");
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
      failed: rows.filter((r) => r.state === "Approved" && r.sapStatus === "Failed").length,
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
            <h2 className="panel-title">New items for SAP</h2>
            <p className="panel-sub">
              {canDecide
                ? "Approving an item creates it in SAP, with the company's next item code."
                : "Items you have sent for approval, and where they have got to."}
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
        <Stat label="Waiting for approval" value={stats.waiting} tone={stats.waiting ? "amber" : ""} />
        <Stat label="Approved, not yet in SAP" value={stats.approved} tone={stats.failed ? "rose" : ""} />
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
              isMaintenance={isMaintenance}
              onRetry={() => retry(r.id)}
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

const RequestCard = ({ request: r, canDecide, isMaintenance, busy, onDecide, onRetry }) => (
  <div className="card p-5">
    <div className="flex flex-wrap items-start gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="mono text-xs text-slate-500">{r.id}</span>
          <span className={`badge ${STATE_STYLE[r.state] || "badge-slate"}`}>{r.state}</span>
          {!r.nameCompliant && (
            <span className="badge badge-rose badge-soft">Off the naming convention</span>
          )}
          {r.sapItemCode && (
            <span className="badge badge-violet badge-soft">SAP {r.sapItemCode}</span>
          )}
          {r.state === "Approved" && r.sapStatus === "Queued" && (
            <span className="badge badge-brand badge-soft">Waiting for the SAP server</span>
          )}
          {r.sapStatus === "Failed" && <span className="badge badge-rose">SAP creation failed</span>}
          {!r.hasSapFields && r.state !== "In SAP" && (
            <span className="badge badge-amber badge-soft">Raised without SAP fields</span>
          )}
        </div>

        <h3 className="mt-1.5 text-base font-bold tracking-tight text-slate-900 text-balance">
          {r.proposedName}
        </h3>

        <div className="mt-2 grid sm:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-2">
          {/* Which site wanted it. The queue used to say who raised a name but
              not which company it was for, so a list of pending names read the
              same whether they all came from one plant or from four. */}
          <KV label="SAP company" value={r.companyName || r.plant || "not recorded"} />
          <KV label="Item group › A › B" value={[r.category, r.subCategory, r.subCategoryB].filter(Boolean).join(" › ")} />
          <KV label="Unit" value={r.unit} />
          <KV label="HSN · Tax" value={[r.hsnCode, r.taxRate].filter(Boolean).join(" · ")} />
          <KV label="Foreign name" value={r.foreignName} />
          <KV label="Minimum stock" value={r.minStock || "—"} />
          <KV label="Brand" value={r.brand} />
          <KV label="Raised by" value={`${r.raisedBy} · ${when(r.raisedAt)}`} />
          {r.decidedBy && <KV label="Decided by" value={`${r.decidedBy} · ${when(r.decidedAt)}`} />}
        </div>

        {r.decisionNote && (
          <p className="mt-2 text-xs text-slate-600 italic">“{r.decisionNote}”</p>
        )}

        {r.sapError && (
          <p className="mt-2 text-xs text-rose-700">SAP said: {r.sapError}</p>
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

        {isMaintenance && r.state === "Rejected" && (
          <button className="btn btn-sm btn-neutral" disabled={busy} onClick={() => onDecide("Reopen")}>
            <Undo2 className="h-4 w-4" />
            Raise again
          </button>
        )}

        {isMaintenance && r.state === "Approved" && r.sapStatus === "Failed" && (
          <button className="btn btn-sm btn-primary" disabled={busy} onClick={onRetry}>
            <Send className="h-4 w-4" />
            Send to SAP again
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
          <h3 className="modal-title">{rejecting ? "Reject this item" : "Approve and create in SAP"}</h3>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="modal-body space-y-4">
          <div>
            <p className="kv-label">Description (SAP item name)</p>
            <p className="text-base font-bold text-slate-900 text-balance">{r.proposedName}</p>
            <p className="mt-0.5 text-xs text-slate-500">
              {r.companyName} · {[r.category, r.subCategory, r.subCategoryB].filter(Boolean).join(" › ")} · {r.unit}
              {r.hsnCode ? ` · HSN ${r.hsnCode}` : ""}
              {r.taxRate ? ` · ${r.taxRate}` : ""}
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

          {!rejecting && !r.hasSapFields && (
            <div className="note note-rose">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>
                This request was raised before items were made in SAP, so it has no SAP company or item
                group and cannot be approved. Reject it and have it raised again from the form.
              </span>
            </div>
          )}

          {!rejecting && r.hasSapFields && (
            <div className="note note-brand">
              <Package className="h-4 w-4 shrink-0" />
              <span>
                Approving sends it to the SAP server, which creates it in {r.companyName}'s SAP with the next
                item code and then adds it to the catalog, with no stock. What physically arrived is received
                separately.
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
            disabled={busy || (rejecting && !note.trim()) || (!rejecting && !r.hasSapFields)}
            onClick={() => onConfirm(note)}
          >
            {busy ? "…" : rejecting ? "Reject" : "Approve and create in SAP"}
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
