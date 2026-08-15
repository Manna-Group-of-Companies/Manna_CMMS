import { useEffect, useState } from "react";
import API from "../../services/api";
import { useAuth } from "../../context/AuthContext";
import { useNotifications } from "../../context/NotificationContext";
import {
  Loader2,
  Users as UsersIcon,
  KeyRound,
  ShieldCheck,
  Warehouse,
  User as UserIcon,
  UserPlus,
  Trash2,
  X,
  AlertCircle,
} from "lucide-react";

const PIN_LENGTH = 4;

const ROLE_ICON = {
  Admin: ShieldCheck,
  Branch: Warehouse,
  Supervisor: UserIcon,
};

const onlyDigits = (value) => value.replace(/\D/g, "").slice(0, PIN_LENGTH);

/**
 * Accounts and their PINs.
 *
 * Everyone signs in with their name and a 4-digit PIN, and the PINs are issued
 * here — a new account cannot sign in at all until it has one.
 */
const Users = () => {
  const { user: signedIn } = useAuth();
  const { showToast } = useNotifications();
  const [users, setUsers] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // The account whose PIN is being set, or "new" for the create form.
  const [editing, setEditing] = useState(null);
  // The account queued for deletion, held until it is confirmed.
  const [deleting, setDeleting] = useState(null);
  const [pin, setPin] = useState("");
  const [form, setForm] = useState({ name: "", email: "", role: "Supervisor", stockRoom: "" });

  const fetchUsers = async () => {
    try {
      setLoading(true);
      const { data } = await API.get("/auth/users");
      setUsers(data);
    } catch (error) {
      console.error("Error loading users:", error);
      showToast(error.response?.data?.message || "Could not retrieve users", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
    // Branch accounts are pinned to a room, so the create form needs the list.
    API.get("/stock-rooms")
      .then(({ data }) => setRooms(Array.isArray(data) ? data : []))
      .catch(() => setRooms([]));
  }, []);

  const closeModal = () => {
    setEditing(null);
    setPin("");
    setForm({ name: "", email: "", role: "Supervisor", stockRoom: "" });
  };

  const handleSetPin = async (e) => {
    e.preventDefault();
    if (pin.length !== PIN_LENGTH) {
      return showToast(`The PIN must be ${PIN_LENGTH} digits`, "error");
    }

    try {
      setSubmitting(true);
      const { data } = await API.put(`/auth/users/${editing._id}/pin`, { pin });
      showToast(data.message, "success");
      closeModal();
      fetchUsers();
    } catch (error) {
      console.error("Error setting PIN:", error);
      showToast(error.response?.data?.message || "Failed to set the PIN", "error");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    try {
      setSubmitting(true);
      const { data } = await API.delete(`/auth/users/${deleting._id}`);
      showToast(data.message, "success");
      setDeleting(null);
      fetchUsers();
    } catch (error) {
      console.error("Error deleting user:", error);
      showToast(error.response?.data?.message || "Failed to delete the user", "error");
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return showToast("Name is required", "error");
    if (pin && pin.length !== PIN_LENGTH) {
      return showToast(`The PIN must be ${PIN_LENGTH} digits`, "error");
    }
    if (form.role === "Branch" && !form.stockRoom) {
      return showToast("A Branch account needs a stock room", "error");
    }

    try {
      setSubmitting(true);
      await API.post("/auth/register", {
        name: form.name.trim(),
        email: form.email.trim(),
        role: form.role,
        stockRoom: form.role === "Branch" ? form.stockRoom : null,
        pin: pin || null,
      });
      showToast(`${form.name.trim()} added`, "success");
      closeModal();
      fetchUsers();
    } catch (error) {
      console.error("Error creating user:", error);
      showToast(error.response?.data?.message || "Failed to add the user", "error");
    } finally {
      setSubmitting(false);
    }
  };

  const waiting = users.filter((user) => !user.hasPin).length;

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="panel">
        <div className="flex items-center gap-3 min-w-0">
          <span className="panel-icon">
            <UsersIcon className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h3 className="panel-title">Users &amp; PINs</h3>
            <p className="panel-sub">
              {users.length} account(s)
              {waiting > 0 && (
                <>
                  {" • "}
                  <span className="text-amber-600 font-semibold">
                    {waiting} waiting for a PIN
                  </span>
                </>
              )}
            </p>
          </div>
        </div>

        <button onClick={() => setEditing("new")} className="btn btn-primary w-full sm:w-auto">
          <UserPlus className="h-4 w-4" />
          Add User
        </button>
      </div>

      {loading ? (
        <div className="h-[40vh] flex items-center justify-center">
          <Loader2 className="h-7 w-7 text-brand-500 animate-spin" />
        </div>
      ) : (
        <div className="card overflow-hidden divide-y divide-slate-100">
          {users.map((user) => {
            const Icon = ROLE_ICON[user.role] || UserIcon;
            return (
              <div
                key={user._id}
                // Wraps on a phone: identity on the first line, the PIN status
                // and actions on the second, so neither squeezes the name.
                className="px-4 sm:px-5 py-3.5 flex flex-wrap items-center gap-3 hover:bg-slate-50 transition-colors"
              >
                <div className="bg-brand-500/10 h-10 w-10 rounded-full flex items-center justify-center border border-brand-500/20 shrink-0">
                  <Icon className="h-[18px] w-[18px] text-brand-700" />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="cell-title text-[14px] truncate">{user.name}</div>
                  <div className="text-[12px] text-slate-500 truncate">
                    {user.role}
                    {user.stockRoom?.name && ` • ${user.stockRoom.name}`}
                    {user.email && ` • ${user.email}`}
                  </div>
                </div>

                <div className="w-full sm:w-auto flex items-center justify-end gap-2">
                  <span
                    className={`badge badge-pill badge-soft ${
                      user.hasPin ? "badge-emerald" : "badge-amber"
                    }`}
                  >
                    {user.hasPin ? "PIN set" : "No PIN — cannot sign in"}
                  </span>

                  <button
                    onClick={() => {
                      setEditing(user);
                      setPin("");
                    }}
                    className="btn btn-sm btn-neutral text-brand-700 hover:text-brand-700 hover:bg-brand-50"
                  >
                    <KeyRound className="h-3.5 w-3.5" />
                    {user.hasPin ? "Change PIN" : "Set PIN"}
                  </button>

                  {/* Deleting your own account would end the session, and the
                      server refuses it — so it is not offered here either. */}
                  <button
                    onClick={() => setDeleting(user)}
                    disabled={user._id === signedIn?._id}
                    title={
                      user._id === signedIn?._id
                        ? "You cannot delete your own account"
                        : `Delete ${user.name}`
                    }
                    className="icon-btn icon-btn-danger"
                    aria-label={`Delete ${user.name}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Delete confirmation */}
      {deleting && (
        <div className="modal-backdrop">
          <div className="modal max-w-md">
            <div className="modal-head">
              <div className="min-w-0">
                <h3 className="modal-title">Delete Account</h3>
                <p className="modal-sub truncate">
                  {deleting.name} • {deleting.role}
                  {deleting.stockRoom?.name && ` • ${deleting.stockRoom.name}`}
                </p>
              </div>
              <button onClick={() => setDeleting(null)} className="modal-close" aria-label="Close">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="modal-body space-y-4">
              <p className="text-sm text-slate-700 leading-relaxed">
                <strong>{deleting.name}</strong> will no longer be able to sign in, on the
                web console or the phone app.
              </p>
              <div className="note note-rose">
                <AlertCircle className="h-4 w-4 shrink-0 mt-px" />
                <span>
                  This cannot be undone. Requests and issues raised by this account stay in
                  the history, but stop showing their name.
                </span>
              </div>
            </div>

            <div className="modal-foot">
              <button type="button" onClick={() => setDeleting(null)} className="btn btn-neutral">
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={submitting}
                className="btn btn-danger"
              >
                {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                Delete Account
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Set PIN / add user modal */}
      {editing && (
        <div className="modal-backdrop">
          <div className="modal max-w-md">
            <div className="modal-head">
              <div className="min-w-0">
                <h3 className="modal-title truncate">
                  {editing === "new" ? "Add User" : `PIN for ${editing.name}`}
                </h3>
                <p className="modal-sub">
                  {editing === "new"
                    ? "The account signs in with this name and PIN."
                    : `${editing.role}${
                        editing.stockRoom?.name ? ` • ${editing.stockRoom.name}` : ""
                      }`}
                </p>
              </div>
              <button onClick={closeModal} className="modal-close" aria-label="Close">
                <X className="h-5 w-5" />
              </button>
            </div>

            <form
              onSubmit={editing === "new" ? handleCreate : handleSetPin}
              className="contents"
            >
              <div className="modal-body space-y-4">
              {editing === "new" && (
                <>
                  <div>
                    <label className="field-label">
                      Name * <span className="font-normal normal-case tracking-normal">(used to sign in)</span>
                    </label>
                    <input
                      type="text"
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      required
                      placeholder="e.g. Night Shift Supervisor"
                      className="field"
                    />
                  </div>
                  <div>
                    <label className="field-label">Role *</label>
                    <select
                      value={form.role}
                      onChange={(e) => setForm({ ...form, role: e.target.value })}
                      className="field cursor-pointer"
                    >
                      <option value="Supervisor">Supervisor</option>
                      <option value="Branch">Branch</option>
                      <option value="Admin">Admin</option>
                    </select>
                  </div>
                  {form.role === "Branch" && (
                    <div>
                      <label className="field-label">Stock Room *</label>
                      <select
                        value={form.stockRoom}
                        onChange={(e) => setForm({ ...form, stockRoom: e.target.value })}
                        required
                        className="field cursor-pointer"
                      >
                        <option value="">Select a room…</option>
                        {rooms.map((room) => (
                          <option key={room._id} value={room._id}>
                            {room.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  <div>
                    <label className="field-label">
                      Email <span className="font-normal normal-case tracking-normal">(optional, contact only)</span>
                    </label>
                    <input
                      type="email"
                      value={form.email}
                      onChange={(e) => setForm({ ...form, email: e.target.value })}
                      placeholder="name@company.com"
                      className="field"
                    />
                  </div>
                </>
              )}

              <div>
                <label className="field-label">
                  {PIN_LENGTH}-Digit PIN {editing === "new" ? "" : "*"}
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={pin}
                  onChange={(e) => setPin(onlyDigits(e.target.value))}
                  maxLength={PIN_LENGTH}
                  required={editing !== "new"}
                  placeholder="0000"
                  // Wider and monospaced: a PIN is read back digit by digit.
                  className="field h-12 text-center text-lg font-mono tracking-[0.6em] indent-[0.6em] placeholder-slate-300"
                />
              </div>

              <div className="note note-amber">
                <AlertCircle className="h-4 w-4 shrink-0 mt-px" />
                <span>
                  {editing === "new"
                    ? "Leave the PIN blank to add the account now and issue its PIN later — it cannot sign in until then."
                    : "The PIN is stored hashed, so it cannot be read back. Pass it to the account holder directly."}
                </span>
              </div>
              </div>

              <div className="modal-foot">
                <button type="button" onClick={closeModal} className="btn btn-neutral">
                  Cancel
                </button>
                <button type="submit" disabled={submitting} className="btn btn-primary">
                  {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                  {editing === "new" ? "Add User" : "Save PIN"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Users;
