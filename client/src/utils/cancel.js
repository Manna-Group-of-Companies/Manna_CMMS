/**
 * Cancelling a purchase request, quotation or PO from the CMMS (27 Oct 2026) - asking why.
 * The components that show and offer it are in components/CancelNote.jsx.
 */

/** SAP's Comments take the reason with who cancelled; the server holds it to this. */
export const CANCEL_REASON_MAX = 140;

/** Asks why, through the app's prompt dialog. The reason, or null when the dialog was dismissed or left empty. */
export const askCancelReason = async (prompt, showToast, what) => {
  const reason = await prompt({
    title: `Cancel ${what}?`,
    message: "It is cancelled in SAP too, within seconds. Say why - the reason goes to SAP with your name.",
    placeholder: "Vendor cannot supply, ordered twice, no longer needed...",
    confirmLabel: "Cancel it",
  });
  if (reason === null) return null;
  const trimmed = reason.trim();
  if (!trimmed) {
    showToast("Say why it is being cancelled", "error");
    return null;
  }
  if (trimmed.length > CANCEL_REASON_MAX) {
    showToast(`Keep the reason to ${CANCEL_REASON_MAX} characters`, "error");
    return null;
  }
  return trimmed;
};
