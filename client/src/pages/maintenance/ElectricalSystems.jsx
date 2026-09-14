import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Loader2, Plug, RefreshCw, Zap } from "lucide-react";

import API from "../../services/api";
import { useAuth, MANAGER, MAINTENANCE_MANAGER, PRODUCTION_MANAGER } from "../../context/AuthContext";
import ElectricalSystemDetail from "./ElectricalSystemDetail";

/**
 * The electrical portfolio, one system per plant.
 *
 * A tab of Asset Management, alongside the machines — the same job of recording
 * what the company owns.
 *
 * The panels and their contents are described in an attached document rather
 * than typed into a form. Keeping one document current is a job the maintenance
 * team will actually do; keeping a document *and* a three-level form current is
 * two jobs, and the second always loses.
 */

const ElectricalSystems = () => {
  const { user } = useAuth();
  // The supply figures are maintenance's; attaching a drawing is looser.
  const canEdit = user?.role === MAINTENANCE_MANAGER || user?.role === MANAGER;
  const canAttach = canEdit || user?.role === PRODUCTION_MANAGER;

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [opened, setOpened] = useState("");

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const { data } = await API.get("/electrical");
      setRows(data);
      setError("");
    } catch (err) {
      setError(err.response?.data?.message || `Cannot reach the server at ${API.defaults.baseURL}.`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-5">
      <div className="panel">
        <div className="flex items-center gap-3">
          <span className="panel-icon">
            <Zap className="h-5 w-5" />
          </span>
          <div>
            <h2 className="panel-title">Electrical register</h2>
            <p className="panel-sub">
              The supply at each plant, and the document describing the installation.
            </p>
          </div>
        </div>
        <button className="btn btn-sm btn-neutral" onClick={() => load()} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
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
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {rows.map((s) => (
            <button
              key={s.id}
              onClick={() => setOpened(s.id)}
              className="card p-5 text-left hover:border-brand-500/40 transition-colors cursor-pointer"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="eyebrow">{s.plant}</p>
                  <h3 className="mt-0.5 text-base font-bold tracking-tight text-slate-900 text-balance">
                    {s.name}
                  </h3>
                </div>
                {s.fileCount > 0 && (
                  <span className="badge badge-slate badge-soft shrink-0">
                    {s.fileCount} file{s.fileCount === 1 ? "" : "s"}
                  </span>
                )}
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
                {s.supplyType ? (
                  <span className="inline-flex items-center gap-1">
                    <Plug className="h-3.5 w-3.5 text-slate-400" />
                    {s.supplyType} {s.supplyVoltage}
                  </span>
                ) : (
                  <span className="text-amber-600">Supply not recorded</span>
                )}
                {s.contractDemandKva > 0 && <span>{s.contractDemandKva} kVA contract demand</span>}
                {s.hasDgBackup && <span>DG {s.dgCapacityKva || "?"} kVA</span>}
              </div>

              <p className="mt-2 text-xs text-slate-500">
                {s.fileCount === 0
                  ? "No documents yet — the installation document goes here."
                  : "Documents and drawings attached."}
              </p>
            </button>
          ))}
        </div>
      )}

      {opened && (
        <ElectricalSystemDetail
          id={opened}
          canEdit={canEdit}
          canAttach={canAttach}
          onClose={() => setOpened("")}
          onChanged={() => load(true)}
        />
      )}
    </div>
  );
};

export default ElectricalSystems;
