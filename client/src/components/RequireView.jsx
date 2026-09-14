import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { homePathFor, maySee } from "../config/access";

/**
 * A route only its audience may open.
 *
 * The sidebar already hides what a role may not see, but a menu is not a
 * permission: a bookmark, a pasted link or a back button all reach a route
 * without going through it. This is the second half — the server's guard being
 * the one that actually matters, and this one being what keeps somebody from
 * landing on a screen that would only fill with 403s.
 *
 * Sends them to their own home rather than the login screen. Being refused one
 * page is not being signed out, and treating it as though it were is how a
 * legitimate user ends up typing their password again to no effect.
 */
const RequireView = ({ view, children }) => {
  const { user } = useAuth();

  if (!user) return <Navigate to="/login" replace />;
  if (!maySee(user.role, view)) return <Navigate to={homePathFor(user.role)} replace />;

  return children;
};

export default RequireView;
