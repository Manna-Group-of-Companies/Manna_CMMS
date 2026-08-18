import { useEffect, useState } from "react";
import API from "../../services/api";
import { useNotifications } from "../../context/NotificationContext";
import {
  Loader2,
  Contact,
  Building2,
  Factory,
  Plus,
  Pencil,
  Trash2,
  X,
  AlertCircle,
} from "lucide-react";

/** The two groups, in the order the issue form shows them. */
const TYPES = ["Our Company", "Outside Company"];

const TYPE_ICON = {
  "Our Company": Building2,
  "Outside Company": Factory,
};

const EMPTY = { name: "", type: TYPES[0], description: "" };

/**
 * Who stock can be issued to.
 *
 * The recipient used to be typed into the issue form by hand, so the same firm
 * arrived spelled three ways and the issue history could not be grouped by who
 * took the stock. The names live here now and the issue form offers them.
 *
 * A retired recipient is kept rather than deleted once it is on an issue: the
 * name is already written onto that issue, and this list is where anyone would
 * look to find out why it stopped being offered.
 */
const Recipients = () => {
  const { showToast } = useNotifications();
  const [recipients, setRecipients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // null | "new" | the recipient being edited
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [form, setForm] = useState(EMPTY);

  const fetchRecipients = async () => {
    try {
      setLoading(true);
      // Retired ones included: this is the list that says who is offered and
      // who is not, so hiding them would hide half the answer.
      const { data } = await API.get("/recipients", { params: { all: true } });
      setRecipients(data);
    } catch (error) {
      console.error("Error loading recipients:", error);
      showToast("Could not load the recipients", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRecipients();
  }, []);

  const closeModal = () => {
    setEditing(null);
    setForm(EMPTY);
  };

  const openNew = () => {
    setForm(EMPTY);
    setEditing("new");
  };

  const openEdit = (recipient) => {
    setForm({
      name: recipient.name,
      type: recipient.type,
      description: recipient.description || "",
    });
    setEditing(recipient);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) {
      showToast("A recipient name is required", "error");
      return;
    }

    try {
      setSubmitting(true);
      const { data } =
        editing === "new"
          ? await API.post("/recipients", form)
          : await API.put(`/recipients/${editing._id}`, form);

      showToast(data.message || "Saved", "success");
      closeModal();
      fetchRecipients();
    } catch (error) {
      showToast(error.response?.data?.message || "Could not save the recipient", "error");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    try {
      setSubmitting(true);
      const { data } = await API.delete(`/recipients/${deleting._id}`);
      showToast(data.message || "Removed", "success");
      setDeleting(null);
      fetchRecipients();
    } catch (error) {
      showToast(error.response?.data?.message || "Could not remove the recipient", "error");
    } finally {
      setSubmitting(false);
    }
  };

  const restore = async (recipient) => {
    try {
      const { data } = await API.put(`/recipients/${recipient._id}`, { isActive: true });
      showToast(data.message || "Back on the list", "success");
      fetchRecipients();
    } catch (error) {
      showToast(error.response?.data?.message || "Could not restore it", "error");
    }
  };

  const offered = recipients.filter((one) => one.isActive).length;

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="panel">
        <div className="flex items-center gap-3 min-w-0">
          <span className="panel-icon">
            <Contact className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h3 className="panel-title">Recipients</h3>
            <p className="panel-sub">
              {offered} offered when issuing stock
              {recipients.length > offered && ` • ${recipients.length - offered} retired`}
            </p>
          </div>
        </div>

        <button onClick={openNew} className="btn btn-primary w-full sm:w-auto">
          <Plus className="h-4 w-4" />
          Add Recipient
        </button>
      </div>

      {loading ? (
        <div className="h-[40vh] flex items-center justify-center">
          <Loader2 className="h-7 w-7 text-brand-500 animate-spin" />
        </div>
      ) : recipients.length === 0 ? (
        <div className="card p-10 text-center">
          <Contact className="h-8 w-8 text-slate-300 mx-auto mb-3" />
          <p className="text-sm font-semibold text-slate-700">No recipients yet</p>
          <p className="text-[13px] text-slate-500 mt-1">
            Add the departments and outside companies stock is issued to. Until one exists,
            the issue form has nothing to offer.
          </p>
        </div>
      ) : (
        TYPES.map((type) => {
          const group = recipients.filter((one) => one.type === type);
          if (group.length === 0) return null;
          const Icon = TYPE_ICON[type];

          return (
            <div key={type} className="space-y-2">
              <h4 className="eyebrow flex items-center gap-1.5">
                <Icon className="h-3.5 w-3.5" /> {type} ({group.length})
              </h4>

              <div className="card overflow-hidden divide-y divide-slate-100">
                {group.map((recipient) => (
                  <div
                    key={recipient._id}
                    className="px-4 sm:px-5 py-3.5 flex flex-wrap items-center gap-3 hover:bg-slate-50 transition-colors"
                  >
                    <div className="bg-brand-500/10 h-10 w-10 rounded-full flex items-center justify-center border border-brand-500/20 shrink-0">
                      <Icon className="h-[18px] w-[18px] text-brand-700" />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="cell-title text-[14px] truncate">{recipient.name}</div>
                      {recipient.description && (
                        <div className="text-[12px] text-slate-500 truncate">
                          {recipient.description}
                        </div>
                      )}
                    </div>

                    <div className="w-full sm:w-auto flex items-center justify-end gap-2">
                      {!recipient.isActive && (
                        <span className="badge badge-pill badge-soft badge-slate">
                          Retired — not offered
                        </span>
                      )}

                      {recipient.isActive ? (
                        <>
                          <button
                            onClick={() => openEdit(recipient)}
                            className="btn btn-sm btn-neutral text-brand-700 hover:text-brand-700 hover:bg-brand-50"
                          >
                            <Pencil className="h-3.5 w-3.5" /> Edit
                          </button>
                          <button
                            onClick={() => setDeleting(recipient)}
                            className="btn btn-sm btn-neutral text-rose-600 hover:text-rose-600 hover:bg-rose-50"
                          >
                            <Trash2 className="h-3.5 w-3.5" /> Remove
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => restore(recipient)}
                          className="btn btn-sm btn-neutral text-emerald-600 hover:text-emerald-600 hover:bg-emerald-50"
                        >
                          Put back on the list
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })
      )}

      {/* Add / edit */}
      {editing && (
        <div className="modal-backdrop">
          <div className="modal max-w-md">
            <div className="modal-head">
              <div className="min-w-0">
                <h3 className="modal-title truncate">
                  {editing === "new" ? "Add Recipient" : `Edit ${editing.name}`}
                </h3>
                <p className="modal-sub">
                  {editing === "new"
                    ? "It appears in the issue form as soon as it is saved."
                    : "Renaming it here does not rename it on issues already raised."}
                </p>
              </div>
              <button onClick={closeModal} className="modal-close" aria-label="Close">
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="contents">
              <div className="modal-body space-y-4">
                <div>
                  <label className="field-label">Name *</label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    required
                    placeholder="e.g. Maintenance Dept, ABC Traders"
                    className="field"
                  />
                </div>

                <div>
                  <label className="field-label">Group *</label>
                  <select
                    value={form.type}
                    onChange={(e) => setForm({ ...form, type: e.target.value })}
                    className="field cursor-pointer"
                  >
                    {TYPES.map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </select>
                  <span className="text-[11px] text-slate-500 mt-1 block">
                    Which heading it sits under when a supervisor picks a recipient.
                  </span>
                </div>

                <div>
                  <label className="field-label">Note (optional)</label>
                  <input
                    type="text"
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    placeholder="e.g. contact person, site"
                    className="field"
                  />
                </div>
              </div>

              <div className="modal-foot">
                <button type="button" onClick={closeModal} className="btn btn-neutral">
                  Cancel
                </button>
                <button type="submit" disabled={submitting} className="btn btn-primary">
                  {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                  {editing === "new" ? "Add Recipient" : "Save"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Remove confirmation */}
      {deleting && (
        <div className="modal-backdrop">
          <div className="modal max-w-sm">
            <div className="modal-body space-y-3 text-center">
              <span className="panel-icon bg-rose-50 border-rose-500/15 text-rose-600 mx-auto">
                <AlertCircle className="h-5 w-5" />
              </span>
              <h3 className="modal-title justify-center">Remove {deleting.name}?</h3>
              <p className="text-[13px] text-slate-600">
                It stops being offered when issuing stock. If it is already on an issue it is
                kept as retired, so that history still reads.
              </p>
            </div>
            <div className="modal-foot">
              <button type="button" onClick={() => setDeleting(null)} className="btn btn-neutral">
                Cancel
              </button>
              <button onClick={handleDelete} disabled={submitting} className="btn btn-danger">
                {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                Remove
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Recipients;
