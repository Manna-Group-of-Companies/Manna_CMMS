import { useState } from "react";

import API from "../../services/api";

/**
 * A machine's condition, changed where it is read.
 *
 * The condition could only be set through the full machine form: open the
 * register, open the machine, press Edit, find the field among forty others,
 * save. That is four screens to answer "is it running", which is the one thing
 * about a machine that changes weekly and the one somebody wants to correct the
 * moment they notice it is wrong.
 *
 * So it is a control rather than a badge, in the list and on the machine's own
 * page, and it saves on change. Anyone who may not edit sees the badge exactly
 * as before - this adds a way in for the people who already had permission, it
 * does not widen who has it. The server is the real guard either way: PUT
 * /api/assets/:id is Manager and Maintenance Manager only.
 *
 * There is no confirmation step. The field is a four-way choice with no
 * destructive option, the previous value is restored if the save fails, and a
 * dialog on every change would make the quick path slower than the form it
 * replaces.
 */

export const CONDITIONS = ["Running", "Under Repair", "Stopped", "Retired"];

export const CONDITION_STYLE = {
  Running: "badge-emerald",
  "Under Repair": "badge-amber",
  Stopped: "badge-rose",
  Retired: "badge-slate",
};

/** The colours as select styling, so the control reads like the badge did. */
const FIELD_TONE = {
  Running: "border-emerald-500/40 bg-emerald-50 text-emerald-800",
  "Under Repair": "border-amber-500/40 bg-amber-50 text-amber-800",
  Stopped: "border-rose-500/40 bg-rose-50 text-rose-800",
  Retired: "border-slate-300 bg-slate-50 text-slate-700",
};

const ConditionSelect = ({ asset, canEdit, onChanged, onError }) => {
  const [value, setValue] = useState(asset.status);
  const [saving, setSaving] = useState(false);

  if (!canEdit) {
    return (
      <span className={`badge ${CONDITION_STYLE[asset.status] || "badge-slate"}`}>
        {asset.status}
      </span>
    );
  }

  const change = async (next) => {
    const previous = value;
    if (next === previous) return;

    // Shown immediately, put back if the save fails. A control that waits for
    // the round trip before moving reads as broken on a slow connection.
    setValue(next);
    setSaving(true);
    try {
      const { data } = await API.put(`/assets/${asset.code}`, { status: next });
      onChanged?.(data);
    } catch (error) {
      setValue(previous);
      onError?.(
        error.response?.data?.message || `Could not set the condition: ${error.message}`
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <select
      value={value}
      disabled={saving}
      onChange={(e) => change(e.target.value)}
      aria-label={`Condition of ${asset.name || asset.code}`}
      className={`rounded-lg border px-2 py-1 text-xs font-semibold cursor-pointer
        disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-brand-500/20
        ${FIELD_TONE[value] || FIELD_TONE.Retired}`}
    >
      {CONDITIONS.map((c) => (
        <option key={c} value={c}>
          {c}
        </option>
      ))}
    </select>
  );
};

export default ConditionSelect;
