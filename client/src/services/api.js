import axios from "axios";

const API = axios.create({
  // Falls back to the hosted API so a build made without VITE_API_URL set
  // still reaches a real server instead of a dev machine that isn't there.
  baseURL: import.meta.env.VITE_API_URL || "https://manna-cmms.onrender.com/api",
  headers: {
    "Content-Type": "application/json",
  },
});

// Interceptor to inject JWT token in every request
API.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem("token");
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

/**
 * Whether the server answered the last request at all. A request that fails
 * with no response (connection dropped, server down) flips it off; the next
 * answer of any kind flips it back. components/NetworkStatus.jsx listens for
 * the change and tells the person, so a failed save is not a mystery.
 */
let serverReachable = true;
const setReachable = (reachable) => {
  if (reachable === serverReachable) return;
  serverReachable = reachable;
  window.dispatchEvent(new CustomEvent("api:reachability", { detail: { reachable } }));
};

// Interceptor to handle authorization errors globally
API.interceptors.response.use(
  (response) => {
    setReachable(true);
    return response;
  },
  (error) => {
    if (error.response) setReachable(true);
    else if (!axios.isCancel(error)) setReachable(false);

    if (error.response && error.response.status === 401) {
      // Token expired or invalid, clear localStorage and redirect to login if not already there
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      if (!window.location.pathname.includes("/login")) {
        window.location.href = "/login";
      }
    }
    return Promise.reject(error);
  }
);

export default API;
