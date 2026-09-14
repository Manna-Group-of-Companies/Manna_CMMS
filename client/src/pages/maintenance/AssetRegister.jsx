import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Factory,
  Loader2,
  Paperclip,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
} from "lucide-react";

import API from "../../services/api";
import { useAuth, MANAGER, MAINTENANCE_MANAGER, PRODUCTION_MANAGER } from "../../context/AuthContext";
import { useNotifications } from "../../context/NotificationContext";
import AssetDetail from "./AssetDetail";
import AssetFormModal from "./AssetFormModal";
import ConditionSelect from "./ConditionSelect";

/**
 * The asset register.
 *
 * Every machine, what is known about it, and the drawings and manuals that came
 * with it. Built on the same `CMMS Machine` records Module 2 raises breakdowns
 * against — a machine that breaks down and a machine on the register are the
 * same object, and keeping two would guarantee they disagreed about which press
 * is which.
 */

const CRITICALITY_STYLE = {
  "A - Critical": "badge-rose",
  "B - Important": "badge-amber",
  "C - Ordinary": "badge-slate",
};

const AssetRegister = () => {
  const { user } = useAuth();
  const { showToast } = useNotifications();
  // The machine's own figures are maintenance's. Attaching a file is looser —
  // a production manager holding the manual for their press should be able to
  // put it on the record themselves.
  const canEdit = user?.role === MAINTENANCE_MANAGER || user?.role === MANAGER;
  const canAttach = canEdit || user?.role === PRODUCTION_MANAGER;

  const [rows, setRows] = useState([]);
  const [plants, setPlants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [search, setSearch] = useState("");
  const [plant, setPlant] = useState("");
  const [status, setStatus] = useState("");

  const [opened, setOpened] = useState("");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const { data } = await API.get("/assets", { params: { search, plant, status } });
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
    [search, plant, status]
  );

  useEffect(() => {
    // Debounced: the search box re-queries on every keystroke.
    const t = setTimeout(() => load(), 250);
    return () => clearTimeout(t);
  }, [load]);

  useEffect(() => {
    API.get("/assets/plants").then(({ data }) => setPlants(data)).catch(() => setPlants([]));
  }, []);

  const stats = useMemo(
    () => ({
      total: rows.length,
      critical: rows.filter((a) => a.criticality === "A - Critical").length,
      down: rows.filter((a) => a.status !== "Running" && a.status !== "Retired").length,
      // The number that matters most at the start: how much of the register is
      // still an empty shell.
      undocumented: rows.filter((a) => a.fileCount === 0).length,
    }),
    [rows]
  );

  return (
    <div className="space-y-5">
      <div className="panel">
        <div className="flex items-center gap-3">
          <span className="panel-icon">
            <Factory className="h-5 w-5" />
          </span>
          <div>
            <h2 className="panel-title">Machine register</h2>
            <p className="panel-sub">
              Every machine, and everything that came with it — drawings, manuals, spec sheets.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn btn-sm btn-neutral" onClick={() => load()} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
          {canEdit && (
            <button className="btn btn-sm btn-primary" onClick={() => setAdding(true)}>
              <Plus className="h-4 w-4" />
              Add a machine
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

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Machines" value={stats.total} />
        <Stat label="Critical" value={stats.critical} tone={stats.critical ? "rose" : ""} />
        <Stat label="Not running" value={stats.down} tone={stats.down ? "amber" : ""} />
        <Stat
          label="Nothing attached"
          value={stats.undocumented}
          tone={stats.undocumented ? "amber" : ""}
        />
      </div>

      <div className="card p-3">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
              <Search className="h-4 w-4" />
            </span>
            <input
              className="field field-search"
              placeholder="Code, name, make, model, serial…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search the register"
            />
          </div>
          <select
            className="field field-sm cursor-pointer"
            value={plant}
            onChange={(e) => setPlant(e.target.value)}
            aria-label="Filter by plant"
          >
            <option value="">All plants</option>
            {plants.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
              </option>
            ))}
          </select>
          <select
            className="field field-sm cursor-pointer"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            aria-label="Filter by status"
          >
            <option value="">Any status</option>
            {["Running", "Under Repair", "Stopped", "Retired"].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </div>

      {loading ? (
        <div className="h-40 grid place-items-center">
          <Loader2 className="h-6 w-6 animate-spin text-brand-500" />
        </div>
      ) : rows.length === 0 ? (
        <div className="table-card">
          <div className="empty">
            <Factory className="h-8 w-8 text-slate-300 mb-2" />
            <p className="empty-title">No machines</p>
            <p className="empty-sub">
              {search || plant || status
                ? "Nothing matches those filters."
                : "Add the first machine to start the register."}
            </p>
          </div>
        </div>
      ) : (
        <div className="table-card">
          <div className="table-scroll">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Machine</th>
                  <th>Plant</th>
                  <th>Make &amp; model</th>
                  <th>Criticality</th>
                  <th>Status</th>
                  <th>Files</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => (
                  <tr
                    key={a.id}
                    className="cursor-pointer hover:bg-slate-50"
                    onClick={() => setOpened(a.id)}
                  >
                    <td>
                      <span className="cell-title">{a.name}</span>
                      <div className="mono text-slate-500">{a.code}</div>
                    </td>
                    <td className="text-slate-600">
                      {a.plant}
                      {a.area && <div className="text-xs text-slate-400">{a.area}</div>}
                    </td>
                    <td className="text-slate-600">
                      {a.make || a.model ? (
                        <>
                          {a.make} {a.model}
                          {a.serialNo && (
                            <div className="mono text-xs text-slate-400">{a.serialNo}</div>
                          )}
                        </>
                      ) : (
                        <span className="text-slate-400">not recorded</span>
                      )}
                    </td>
                    <td>
                      <span className={`badge ${CRITICALITY_STYLE[a.criticality] || "badge-slate"}`}>
                        {a.criticality?.replace(/^[ABC] - /, "")}
                      </span>
                    </td>
                    <td>
                      {/* Settable in the list. Walking the register and marking
                          three machines stopped should not mean opening three
                          machines and a form each time. */}
                      <ConditionSelect
                        asset={a}
                        canEdit={canEdit}
                        onChanged={(updated) =>
                          setRows((current) =>
                            current.map((r) =>
                              r.code === updated.code ? { ...r, ...updated } : r
                            )
                          )
                        }
                        onError={(message) => showToast(message, "error")}
                      />
                    </td>
                    <td>
                      {a.fileCount > 0 ? (
                        <span className="inline-flex items-center gap-1 text-slate-600">
                          <Paperclip className="h-3.5 w-3.5" />
                          {a.fileCount}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-amber-600 text-xs">
                          <ShieldAlert className="h-3.5 w-3.5" />
                          nothing
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {opened && (
        <AssetDetail
          id={opened}
          canEdit={canEdit}
          canAttach={canAttach}
          onClose={() => setOpened("")}
          onChanged={() => load(true)}
          onEdit={(asset) => setEditing(asset)}
        />
      )}

      {adding && (
        <AssetFormModal
          plants={plants}
          onClose={() => setAdding(false)}
          onSaved={(created) => {
            setAdding(false);
            showToast(`${created.code} added to the register`, "success");
            load(true);
            setOpened(created.id);
          }}
        />
      )}

      {editing && (
        <AssetFormModal
          plants={plants}
          asset={editing}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            setEditing(null);
            showToast(`${saved.code} saved`, "success");
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

export default AssetRegister;
