import { createContext, useContext, useState, useEffect } from "react";
import API from "../services/api";

const AuthContext = createContext(null);

/** Where a signed-in user belongs, by role. Unknown roles go back to login. */
export const homePathFor = (role) => {
  switch (role) {
    case "Admin":
      return "/admin/dashboard";
    case "Supervisor":
      return "/supervisor/dashboard";
    case "Branch":
      return "/branch/stock";
    default:
      return "/login";
  }
};

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
          // Validate token with backend and refresh user profile
          const { data } = await API.get("/auth/me");
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

  const login = async (email, password) => {
    try {
      const { data } = await API.post("/auth/login", { email, password });
      const profile = {
        _id: data._id,
        name: data.name,
        email: data.email,
        role: data.role,
        // Branch accounts carry the one room they are allowed to see.
        stockRoom: data.stockRoom || null,
      };
      setUser(profile);
      localStorage.setItem("token", data.token);
      localStorage.setItem("user", JSON.stringify(profile));
      return data;
    } catch (error) {
      if (error.response) {
        throw error.response.data?.message || "Invalid credentials. Please try again.";
      }
      // No response at all — the API is down or unreachable. Saying "invalid
      // credentials" here sends people off checking a password that is fine.
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
