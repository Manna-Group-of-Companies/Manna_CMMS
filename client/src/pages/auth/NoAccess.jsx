import { LogOut, Lock } from "lucide-react";

import MannaLogo from "../../components/MannaLogo";
import { useAuth } from "../../context/AuthContext";

/**
 * Where somebody lands when their role has no screens.
 *
 * `homePathFor` used to send them to "/login", which made a correct sign-in
 * look like a failed one: the password was accepted, they were sent to the
 * login page, and the login page sent them back to it. The account was fine and
 * the screen said otherwise.
 *
 * An empty menu is not an error - it is what holding screens back for a release
 * does to a role that had none of the released ones. So this says which account
 * is signed in, that the account works, and who to ask. Naming the role matters:
 * it is the one fact an administrator needs to put it right.
 */
const NoAccess = () => {
  const { user, logout } = useAuth();

  return (
    <div className="min-h-screen bg-canvas text-slate-900 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md text-center">
        <MannaLogo className="h-12 w-auto mx-auto" />

        <div className="glass-premium mt-8 rounded-2xl p-8">
          <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-brand-500/10">
            <Lock className="h-5 w-5 text-brand-600" />
          </div>

          <h1 className="mt-4 text-lg font-bold tracking-tight">No screens for this role yet</h1>

          <p className="mt-2 text-sm text-slate-600">
            You are signed in and your password is correct. This release covers breakdowns and
            maintenance requests, and the <strong>{user?.role}</strong> role is not on either of
            them yet.
          </p>

          {user?.email && (
            <p className="mt-4 text-xs text-slate-500">
              Signed in as <span className="font-medium text-slate-700">{user.email}</span>
            </p>
          )}

          <p className="mt-4 text-xs text-slate-500">
            Ask the administrator to add your role, and it will appear the next time you sign in.
          </p>

          <button className="btn btn-neutral mt-6 w-full" onClick={logout}>
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
};

export default NoAccess;
