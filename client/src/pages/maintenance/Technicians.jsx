import { useCallback, useEffect, useState } from "react";
import API from "../../services/api";
import { useNotifications } from "../../context/NotificationContext";
import { useDialog } from "../../context/DialogContext";
import { HardHat, Loader2, Plus, RotateCcw, UserMinus, Users } from "lucide-react";
import { useErpRefresh } from "../../hooks/useErpRefresh";

/**
 * The maintenance team: who may be named on a repair.
 *
 * "Repaired by" used to suggest every enabled ERPNext user - the whole company,
 * and still not the fitters, who have no login - so the list never answered the
 * question it existed for and the name was typed by hand instead. This register
 * is what those rows offer now, and it is kept here rather than in ERPNext so
 * the Maintenance Manager can keep it without a desk account.
 *
 * Somebody who leaves is marked as having left, never deleted: a breakdown from
 * last March names whoever repaired it, and that has to go on reading correctly
 * afterwards. They stop being offered on new repairs and stay on the old ones.
 */

const TRADES = ["Fitter", "Electrician", "Helper", "Supervisor", "Contractor"];

const Technicians = () => {
  const { showToast } = useNotifications();
  const { confirm } = useDialog();

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [name, setName] = useState("");
  const [trade, setTrade] = useState("Fitter");
  const [adding, setAdding] = useState(false);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const { data } = await API.get("/technicians");
      setRows(Array.isArray(data) ? data : []);
    } catch (error) {
      showToast(error.response?.data?.message || "Could not load the maintenance team", "error");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    load();
  }, [load]);

  // The top bar's Refresh: read ERPNext again without leaving the screen.
  useErpRefresh(() => load({ silent: true }));

  const add = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setAdding(true);
    try {
      await API.post("/technicians", { name: name.trim(), trade });
      showToast(`${name.trim()} added to the maintenance team`, "success");
      setName("");
      setTrade("Fitter");
      load({ silent: true });
    } catch (error) {
      showToast(error.response?.data?.message || "Could not add them", "error");
    } finally {
      setAdding(false);
    }
  };

  const setActive = async (row, active) => {
    if (
      !active &&
      !(await confirm({
        title: `Record that ${row.name} has left?`,
        message: "They stay on every repair they already worked, and stop being offered on new ones.",
        confirmLabel: "Record as left",
        tone: "warning",
      }))
    ) {
      return;
    }
    setBusy(row.id);
    try {
      await API.post(`/technicians/${encodeURIComponent(row.id)}/${active ? "reinstate" : "resign"}`);
      showToast(active ? `${row.name} is back on the team` : `${row.name} marked as having left`, "success");
      load({ silent: true });
    } catch (error) {
      showToast(error.response?.data?.message || "That did not save", "error");
    } finally {
      setBusy("");
    }
  };

  const changeTrade = async (row, next) => {
    setBusy(row.id);
    try {
      await API.put(`/technicians/${encodeURIComponent(row.id)}`, { trade: next });
      load({ silent: true });
    } catch (error) {
      showToast(error.response?.data?.message || "Could not save the trade", "error");
    } finally {
      setBusy("");
    }
  };

  const here = rows.filter((r) => r.active);
  const gone = rows.filter((r) => !r.active);

  return (
    <div className="space-y-5">
      <div className="panel">
        <div className="flex items-center gap-3">
          <span className="panel-icon">
            <Users className="h-5 w-5" />
          </span>
          <div>
            <h2 className="panel-title">Maintenance team</h2>
          </div>
        </div>
      </div>

      {/* Adding somebody */}
      <form onSubmit={add} className="card p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label className="field-label" htmlFor="tech-name">
              Name
            </label>
            <input
              id="tech-name"
              className="field"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={140}
            />
          </div>
          <div className="sm:w-56">
            <label className="field-label" htmlFor="tech-trade">
              Trade
            </label>
            <select
              id="tech-trade"
              className="field cursor-pointer"
              value={trade}
              onChange={(e) => setTrade(e.target.value)}
            >
              {TRADES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className="btn btn-primary" disabled={adding || !name.trim()}>
            {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Add to the team
          </button>
        </div>
      </form>

      {loading ? (
        <div className="h-[30vh] flex items-center justify-center">
          <Loader2 className="h-7 w-7 text-brand-500 animate-spin" />
        </div>
      ) : (
        <>
          <TeamTable
            title="On the team"
            rows={here}
            busy={busy}
            empty="Nobody on the team yet. Add the first person above."
            onTrade={changeTrade}
            action={{
              label: "Mark as left",
              icon: UserMinus,
              className: "btn btn-sm btn-neutral",
              onClick: (row) => setActive(row, false),
            }}
          />

          {gone.length > 0 && (
            <TeamTable
              title="No longer here"
              rows={gone}
              busy={busy}
              muted
              onTrade={changeTrade}
              action={{
                label: "Bring back",
                icon: RotateCcw,
                className: "btn btn-sm btn-neutral",
                onClick: (row) => setActive(row, true),
              }}
            />
          )}
        </>
      )}
    </div>
  );
};

const TeamTable = ({ title, rows, busy, empty = "", muted = false, onTrade, action }) => (
  <div className="table-card">
    <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
      <HardHat className={`h-4 w-4 ${muted ? "text-slate-400" : "text-brand-700"}`} />
      <h3 className="text-[13px] font-semibold text-slate-900">{title}</h3>
      <span className="badge badge-slate badge-soft">{rows.length}</span>
    </div>

    {rows.length === 0 ? (
      <p className="px-4 py-6 text-center text-[13px] text-slate-500">{empty}</p>
    ) : (
      <div className="table-scroll">
        <table className="tbl">
          <thead>
            <tr>
              <th>Name</th>
              <th>Trade</th>
              <th>Left on</th>
              <th className="text-right">&nbsp;</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const Icon = action.icon;
              return (
                <tr key={row.id} className={muted ? "text-slate-500" : ""}>
                  <td className="cell-title">{row.name}</td>
                  <td>
                    <select
                      className="field field-sm w-40 cursor-pointer"
                      value={row.trade || ""}
                      disabled={busy === row.id}
                      onChange={(e) => onTrade(row, e.target.value)}
                      aria-label={`Trade for ${row.name}`}
                    >
                      <option value="">Not set</option>
                      {TRADES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="text-slate-500">{row.resignedOn || "—"}</td>
                  <td className="text-right">
                    <button
                      className={action.className}
                      disabled={busy === row.id}
                      onClick={() => action.onClick(row)}
                    >
                      {busy === row.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Icon className="h-3.5 w-3.5" />
                      )}
                      {action.label}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    )}
  </div>
);

export default Technicians;
