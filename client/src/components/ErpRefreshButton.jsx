import { useState } from "react";
import { Loader2, RotateCw } from "lucide-react";
import { refreshFromErp, useHasErpRefresh } from "../hooks/useErpRefresh";

/**
 * Re-reads ERPNext for the screen underneath. Shown only on a screen that has
 * registered a reload (useErpRefresh), so it never sits on a page it cannot
 * refresh. A different icon from the SAP sync beside it: that one asks SAP to
 * run, this one only reads again what ERPNext already holds.
 */
const ErpRefreshButton = () => {
  const available = useHasErpRefresh();
  const [busy, setBusy] = useState(false);

  if (!available) return null;

  const refresh = async () => {
    setBusy(true);
    try {
      await refreshFromErp();
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      onClick={refresh}
      disabled={busy}
      className="btn btn-sm btn-neutral shrink-0"
      title="Refresh from ERPNext"
      aria-label="Refresh from ERPNext"
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCw className="h-4 w-4" />}
      <span className="hidden sm:inline">Refresh</span>
    </button>
  );
};

export default ErpRefreshButton;
