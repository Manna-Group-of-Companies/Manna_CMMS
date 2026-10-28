import { useState, useRef, useEffect } from "react";
import { useNotifications } from "../context/NotificationContext";
import { useAuth } from "../context/AuthContext";
import { Bell, Check, CheckSquare, Menu } from "lucide-react";
import SapSyncButton from "./SapSyncButton";
import ErpRefreshButton from "./ErpRefreshButton";

const initials = (name = "") =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("") || "?";

/**
 * VITE_SAP_SYNC_BUTTON=off hides the SAP sync button (26 Oct 2026): on a PC with a local ERPNext copy nothing
 * runs the sync, so the button would wait forever. Shown unless switched off, so the deployed build keeps it.
 */
const SAP_SYNC_BUTTON = import.meta.env.VITE_SAP_SYNC_BUTTON !== "off";

const Navbar = ({ title, subtitle, onMenuClick, sapSync = false }) => {
  const { user } = useAuth();
  const { notifications, unreadCount, markAsRead, markAllAsRead } = useNotifications();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);
  const bellRef = useRef(null);

  // Close dropdown when clicking outside, or on Escape - which also hands
  // focus back to the bell rather than dropping it on the page.
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setDropdownOpen(false);
      }
    };
    const handleKey = (event) => {
      if (event.key === "Escape" && dropdownRef.current?.contains(document.activeElement)) {
        setDropdownOpen(false);
        bellRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKey);
    };
  }, []);

  // A bare time is ambiguous once the list holds yesterday's notices, so
  // anything not from today carries "Yesterday" or its date as well.
  const formatTime = (dateString) => {
    const date = new Date(dateString);
    const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    if (date.toDateString() === today.toDateString()) return time;
    if (date.toDateString() === yesterday.toDateString()) return `Yesterday, ${time}`;
    return `${date.toLocaleDateString([], { day: "numeric", month: "short" })}, ${time}`;
  };

  // "REQUEST_APPROVED" -> "Request approved": a chip, not a shout.
  const typeLabel = (type = "") => {
    const words = type.toLowerCase().replace(/_/g, " ");
    return words.charAt(0).toUpperCase() + words.slice(1);
  };

  const getNotificationColors = (type) => {
    switch (type) {
      case "REQUEST_APPROVED":
        return "badge-emerald";
      case "REQUEST_REJECTED":
        return "badge-rose";
      case "LOW_STOCK":
        return "badge-amber";
      default:
        return "badge-slate";
    }
  };

  return (
    <header className="h-16 shrink-0 flex items-center justify-between gap-3 px-4 sm:px-6 border-b border-slate-200 bg-white sticky top-0 z-30
      lg:mx-3 lg:mt-3 lg:rounded-2xl lg:border lg:border-slate-200/60 lg:shadow-[0_8px_24px_-12px_rgba(16,24,40,0.12)]">
      <div className="flex items-center gap-2.5 min-w-0">
        {/* The sidebar is a drawer below lg, so it needs a way in. */}
        <button
          onClick={onMenuClick}
          className="icon-btn h-10 w-10 -ml-1.5 lg:hidden"
          aria-label="Open menu"
        >
          <Menu className="h-5 w-5" aria-hidden="true" />
        </button>
        <div className="min-w-0">
          <h2 className="text-base sm:text-lg font-bold text-slate-900 tracking-tight leading-tight truncate">
            {title}
          </h2>
          {/* Below sm the title alone has to carry it — two lines would push
              the bar past its 64px. */}
          {subtitle && (
            <p className="hidden sm:block text-[12px] text-slate-500 leading-tight truncate mt-0.5">
              {subtitle}
            </p>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 shrink-0">
        {/* Only where SAP is actually behind the screen. One run serves the
            whole system, so this is the same job wherever it is pressed - on a
            screen SAP has nothing to do with, it would run and change nothing
            in sight. */}
        {sapSync && SAP_SYNC_BUTTON && <SapSyncButton />}

        {/* Re-reads ERPNext, on any screen whose list comes from it. */}
        <ErpRefreshButton />

        {/* Who is signed in - the same chip as the sidebar's, for a wide screen. */}
        {user && (
          <div className="hidden xl:flex items-center gap-2.5 rounded-xl border border-slate-200 py-1 pl-1 pr-3" title={user.email || ""}>
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-50 text-[12px] font-bold text-brand-700">
              {initials(user.name)}
            </span>
            <span className="leading-tight">
              <span className="block max-w-[160px] truncate text-[13px] font-semibold text-slate-900">{user.name}</span>
              <span className="block max-w-[160px] truncate text-[11px] text-slate-500">{user.role}</span>
            </span>
          </div>
        )}

        {/* Notification Bell */}
        <div className="relative" ref={dropdownRef}>
          <button
            ref={bellRef}
            onClick={() => setDropdownOpen(!dropdownOpen)}
            className="icon-btn h-10 w-10 relative border border-slate-200 hover:border-slate-300"
            aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ""}`}
            aria-expanded={dropdownOpen}
            aria-controls="notifications-panel"
          >
            <Bell className="h-5 w-5" aria-hidden="true" />
            {/* rose-600: white on rose-500 is 3.7:1, too faint at this size. */}
            {unreadCount > 0 && (
              <span
                aria-hidden="true"
                className="absolute top-1 right-1 min-w-4 h-4 px-1 bg-rose-600 text-[10px] font-bold text-white rounded-full flex items-center justify-center ring-2 ring-white"
              >
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </button>
          {/* A new notice is announced once, politely, without moving focus. */}
          <span className="sr-only" role="status" aria-live="polite">
            {unreadCount > 0
              ? `${unreadCount} unread notification${unreadCount === 1 ? "" : "s"}`
              : ""}
          </span>

          {/* Dropdown Card — never wider than the viewport on a phone. */}
          {dropdownOpen && (
            <div
              id="notifications-panel"
              role="region"
              aria-label="Notifications"
              className="card absolute right-0 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden shadow-xl z-50 animate-fade-in"
            >
              <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-3">
                <span className="text-[13px] font-semibold text-slate-900">Notifications</span>
                {unreadCount > 0 && (
                  <button
                    onClick={markAllAsRead}
                    className="text-[11px] font-semibold text-brand-700 hover:text-brand-600 flex items-center gap-1 cursor-pointer"
                  >
                    <CheckSquare className="h-3.5 w-3.5" />
                    Mark all read
                  </button>
                )}
              </div>

              <div className="max-h-[22rem] overflow-y-auto divide-y divide-slate-100">
                {notifications.length === 0 ? (
                  <div className="px-4 py-10 text-center text-xs text-slate-500">
                    No notifications yet.
                  </div>
                ) : (
                  notifications.map((n) => (
                    <div
                      key={n._id}
                      className={`px-4 py-3 flex flex-col gap-2 transition-colors ${
                        !n.read ? "bg-brand-50/70" : ""
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-[12px] text-slate-800 leading-relaxed">
                          {n.message}
                        </span>
                        {!n.read && (
                          <button
                            onClick={() => markAsRead(n._id)}
                            className="icon-btn h-8 w-8 shrink-0"
                            title="Mark as read"
                            aria-label="Mark as read"
                          >
                            <Check className="h-4 w-4" aria-hidden="true" />
                          </button>
                        )}
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className={`badge ${getNotificationColors(n.type)}`}>
                          {typeLabel(n.type)}
                        </span>
                        <time dateTime={n.createdAt} className="text-[11px] text-slate-500 tabular-nums">
                          {formatTime(n.createdAt)}
                        </time>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};

export default Navbar;
