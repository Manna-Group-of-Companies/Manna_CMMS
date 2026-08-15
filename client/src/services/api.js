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

// Interceptor to handle authorization errors globally
API.interceptors.response.use(
  (response) => response,
  (error) => {
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
