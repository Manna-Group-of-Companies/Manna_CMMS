import { createContext, useContext, useState, useEffect, useRef } from "react";
import { AlertTriangle, CircleCheck, CircleX, Info, X } from "lucide-react";
import API from "../services/api";
import { useAuth } from "./AuthContext";

const NotificationContext = createContext(null);

export const NotificationProvider = ({ children }) => {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [toasts, setToasts] = useState([]);

  // Toast Handler. Each toast closes itself (see Toast below); at most four
  // stay on screen, the oldest giving way.
  const showToast = (message, type = "info") => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, message: String(message ?? ""), type }].slice(-4));
  };

  const removeToast = (id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  const usesNotifications = !!user;

  // Fetch notifications from DB
  const fetchNotifications = async () => {
    if (!usesNotifications) return;
    try {
      const { data } = await API.get("/notifications");
      setNotifications(data);
      setUnreadCount(data.filter((n) => !n.read).length);
    } catch (error) {
      console.error("Error fetching notifications:", error);
    }
  };

  // Mark single notification as read
  const markAsRead = async (id) => {
    try {
      await API.put(`/notifications/${id}/read`);
      setNotifications((prev) =>
        prev.map((n) => (n._id === id ? { ...n, read: true } : n))
      );
      setUnreadCount((c) => Math.max(0, c - 1));
    } catch (error) {
      console.error("Error marking notification read:", error);
    }
  };

  // Mark all notifications as read
  const markAllAsRead = async () => {
    try {
      await API.put("/notifications/read-all");
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      setUnreadCount(0);
      showToast("All notifications marked as read", "success");
    } catch (error) {
      console.error("Error marking all read:", error);
    }
  };

  useEffect(() => {
    if (usesNotifications) {
      fetchNotifications();
      // Poll notifications every 30 seconds for active users
      const interval = setInterval(fetchNotifications, 30000);
      return () => clearInterval(interval);
    } else {
      setNotifications([]);
      setUnreadCount(0);
    }
  }, [usesNotifications]);

  return (
    <NotificationContext.Provider
      value={{
        notifications,
        unreadCount,
        toasts,
        showToast,
        removeToast,
        fetchNotifications,
        markAsRead,
        markAllAsRead,
      }}
    >
      {children}
      
      {/* Toasts: bottom right on a desk, across the bottom on a phone, and
          above any open dialog so a save's result is never hidden behind it. */}
      <div
        className="pointer-events-none fixed inset-x-4 bottom-4 z-[70] flex flex-col items-stretch gap-2.5 sm:inset-x-auto sm:bottom-5 sm:right-5 sm:w-[380px]"
        aria-live="polite"
      >
        {toasts.map((toast) => (
          <Toast key={toast.id} toast={toast} onClose={() => removeToast(toast.id)} />
        ))}
      </div>
    </NotificationContext.Provider>
  );
};

const TOAST_STYLE = {
  success: { icon: CircleCheck, title: "Done", tile: "bg-emerald-50 text-emerald-600", bar: "bg-emerald-500" },
  error: { icon: CircleX, title: "Something went wrong", tile: "bg-rose-50 text-rose-600", bar: "bg-rose-500" },
  warning: { icon: AlertTriangle, title: "Heads up", tile: "bg-amber-50 text-amber-600", bar: "bg-amber-500" },
  info: { icon: Info, title: "Notice", tile: "bg-sky-50 text-sky-600", bar: "bg-sky-500" },
};

/**
 * One toast. Closes itself after a while - longer for an error, which usually
 * has to be read - and holds still while the pointer is on it, so a message
 * being read does not vanish mid-sentence.
 */
const Toast = ({ toast, onClose }) => {
  const style = TOAST_STYLE[toast.type] || TOAST_STYLE.info;
  const Icon = style.icon;
  const duration = toast.type === "error" ? 7000 : 4500;
  const [paused, setPaused] = useState(false);
  const left = useRef(duration);
  const startedAt = useRef(0);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (paused) return undefined;
    startedAt.current = Date.now();
    const timer = setTimeout(() => closeRef.current(), left.current);
    return () => {
      clearTimeout(timer);
      left.current -= Date.now() - startedAt.current;
    };
  }, [paused]);

  return (
    <div
      role={toast.type === "error" ? "alert" : "status"}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      className="pointer-events-auto relative flex items-start gap-3 overflow-hidden rounded-xl border border-slate-200 bg-white py-3.5 pl-3.5 pr-2.5 shadow-[0_12px_32px_-8px_rgba(16,24,40,0.22)] animate-toast-in"
    >
      <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${style.tile}`}>
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1 pt-0.5">
        <p className="text-[14px] font-semibold leading-tight text-slate-900">{style.title}</p>
        <p className="mt-1 break-words text-[13px] leading-snug text-slate-600">{toast.message}</p>
      </div>
      <button
        type="button"
        onClick={onClose}
        className="grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
        aria-label="Dismiss"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
      {/* Time left before it closes; stops with the timer while hovered. */}
      <span
        className={`absolute inset-x-0 bottom-0 h-[3px] origin-left ${style.bar}`}
        style={{
          animation: `toast-timer ${duration}ms linear forwards`,
          animationPlayState: paused ? "paused" : "running",
        }}
        aria-hidden="true"
      />
    </div>
  );
};

export const useNotifications = () => {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error("useNotifications must be used within a NotificationProvider");
  }
  return context;
};
