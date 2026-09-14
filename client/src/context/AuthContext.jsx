import { createContext, useContext, useState, useEffect } from "react";
import API from "../services/api";
import { ROLES, SUPERVISOR } from "../config/access.js";

const AuthContext = createContext(null);

/**
 * The roles and the screen matrix live in `config/access.js`.
 *
 * Re-exported here because every page already reaches for them through this
 * module, and one import path is worth more than a tidy diff. The definitions
 * moved so that the navigation, the route guards and the role list are one
 * table instead of three that drifted — which is exactly how a Manager once
 * came to sign in successfully and be sent straight back to the login screen.
 */
export {
  MANAGER,
  MAINTENANCE_MANAGER,
  SUPERVISOR,
  PRODUCTION_MANAGER,
  HIGHER_MANAGEMENT,
  VP_OPERATIONS,
  ROLES,
  VIEWS,
  maySee,
  navFor,
  consoleFor,
  homePathFor,
} from "../config/access.js";

/** True when this role works in the shared console at /admin. */
export const canSeeAdminConsole = (role) => ROLES.includes(role) && role !== SUPERVISOR;

/** True when this role works in the store console at /supervisor. */
export const canSeeSupervisorConsole = (role) => role === SUPERVISOR;

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const initializeAuth = async () => {
      const storedToken = localStorage.getItem("token");
      const storedUser = localStorage.getItem("user");

      if (storedToken && storedUser) {
        try {
          setUser(JSON.parse(storedUser));
          // Validate token with backend and refresh user profile. Re-read
          // rather than trusted from storage, so a role changed in ERPNext
          // takes effect on the next load rather than at the next sign-in.
          const { data } = await API.get("/session/me");
          setUser(data);
          localStorage.setItem("user", JSON.stringify(data));
        } catch (error) {
          console.error("Session verification failed:", error);
          logout();
        }
      }
      setLoading(false);
    };

    initializeAuth();
  }, []);

  /**
   * Signs in against ERPNext with an email and password.
   *
   * The PIN is gone: Frappe has no such concept, and the point of moving onto
   * ERPNext is one list of people rather than two that drift apart.
   */
  const login = async (email, password) => {
    try {
      const { data } = await API.post("/session/login", { email, password });
      const profile = {
        name: data.name,
        email: data.email,
        role: data.role,
        erpRoles: data.erpRoles || [],
      };
      setUser(profile);
      localStorage.setItem("token", data.token);
      localStorage.setItem("user", JSON.stringify(profile));
      return data;
    } catch (error) {
      if (error.response) {
        // 426 is this server telling an out-of-date client to update. Passing
        // the message straight through says what to do; a generic "invalid
        // credentials" would send somebody hunting for a password that is fine.
        throw error.response.data?.message || "Wrong email or password.";
      }
      // No response at all — the API is down or unreachable.
      throw `Cannot reach the server at ${API.defaults.baseURL}. Check that the backend is running.`;
    }
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem("token");
    localStorage.removeItem("user");
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, isAuthenticated: !!user }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
