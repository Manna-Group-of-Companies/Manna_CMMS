import { Ban, Loader2 } from "lucide-react";

/**
 * Cancelling a purchase request, quotation or PO from the CMMS (27 Oct 2026).
 *
 * Pressing Cancel asks why (utils/cancel.js); the server checks it may be cancelled and queues it, and the SAP sync
 * cancels it in SAP within seconds. Once done, the document's own status says so (Closed, Cancelled) and its note
 * gives the reason; this shows the steps before that - with the sync, or refused by SAP and open to asking again.
 */

/** The Cancel button: shown only where the server would take it, and to whoever may press it. */
export const CancelButton = ({ cancel, allowed, busy, onCancel }) =>
  allowed && cancel && !cancel.refusal ? (
    <button className="btn btn-sm btn-neutral text-rose-700 hover:border-rose-400" disabled={busy} onClick={onCancel}>
      <Ban className="h-4 w-4" />
      {cancel.status === "Failed" ? "Cancel again" : "Cancel"}
    </button>
  ) : null;

/** A cancellation with the sync, or refused by SAP. Nothing once done - the status and note say it then. */
const CancelNote = ({ cancel, error }) => {
  if (cancel?.status === "Queued") {
    return (
      <div className="note note-amber text-[13px]">
        <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
        <span>
          Being cancelled in SAP{cancel.by ? ` - asked by ${cancel.by}` : ""}: “{cancel.reason}”
        </span>
      </div>
    );
  }
  if (cancel?.status === "Failed") {
    return (
      <div className="note note-rose text-[13px]">
        <Ban className="h-4 w-4 shrink-0" />
        <span>
          SAP did not cancel it{error ? `: ${String(error).replace(/^Not cancelled:\s*/, "")}` : "."} It can be cancelled again.
        </span>
      </div>
    );
  }
  return null;
};

export default CancelNote;
