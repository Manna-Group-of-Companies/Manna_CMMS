import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth, homePathFor } from "../../context/AuthContext";
import { useNotifications } from "../../context/NotificationContext";
import {
  AlertCircle,
  ArrowRight,
  Box,
  ChartColumn,
  Cog,
  Eye,
  EyeOff,
  FileCog,
  LockKeyhole,
  Mail,
  Wrench,
} from "lucide-react";
import MannaLogo from "../../components/MannaLogo";

/**
 * Sign-in (redesign, 23 Oct 2026): a dark brand panel on the left that says
 * what the system is for, and the form on a quiet card on the right.
 *
 * The brand panel is drawn to sit over a photograph of the shop floor. Drop
 * one in as `public/login-hero.jpg` and it shows through the ink gradient;
 * without it the panel is the gradient alone, which reads finished on its own.
 */
const HERO_BACKGROUND = [
  "linear-gradient(90deg, rgba(18,20,24,0.97) 0%, rgba(18,20,24,0.88) 45%, rgba(18,20,24,0.6) 100%)",
  "radial-gradient(ellipse at 85% 35%, rgba(242,103,34,0.32), transparent 55%)",
  "url('/login-hero.jpg')",
].join(", ");

const FEATURES = [
  { icon: Wrench, label: ["Track", "Breakdowns"] },
  { icon: FileCog, label: ["Manage", "Maintenance"] },
  { icon: Box, label: ["Control", "Engineering Store"] },
  { icon: ChartColumn, label: ["Improve", "Uptime"] },
];

// Neither page exists yet - point these at the published documents.
const TERMS_URL = "#";
const PRIVACY_URL = "#";

// "Remember me" keeps the email address on this browser, nothing more - the
// session itself already survives a closed tab. Storage can be blocked
// (private windows), so every touch is guarded.
const REMEMBER_KEY = "login.email";
const readRemembered = () => {
  try {
    return localStorage.getItem(REMEMBER_KEY) || "";
  } catch {
    return "";
  }
};
const writeRemembered = (value) => {
  try {
    if (value) localStorage.setItem(REMEMBER_KEY, value);
    else localStorage.removeItem(REMEMBER_KEY);
  } catch {
    /* storage unavailable: nothing to remember with */
  }
};

const Login = () => {
  const { login } = useAuth();
  const { showToast } = useNotifications();
  const navigate = useNavigate();

  const [remembered] = useState(readRemembered);
  const [email, setEmail] = useState(remembered);
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(Boolean(remembered));
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email || !password) {
      setError("Please fill in all fields");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const data = await login(email.trim(), password);
      writeRemembered(remember ? email.trim() : "");
      showToast(`Welcome back, ${data.name}!`, "success");

      // Redirect based on role
      navigate(homePathFor(data.role));
    } catch (err) {
      setError(err);
      showToast(err, "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    // One screen, no scrolling: from lg the two panels are pinned to the window
    // height and the `short:` steps tighten the spacing on laptop-height
    // windows. A phone keeps natural scrolling for when the keyboard is up.
    <div className="flex min-h-dvh flex-col bg-white text-slate-900 lg:grid lg:h-dvh lg:grid-cols-[minmax(0,46%)_minmax(0,1fr)] lg:overflow-hidden">
      {/* ---------------------------------------------------------------- Brand */}
      <aside
        className="relative isolate overflow-hidden bg-ink-950 bg-cover bg-center px-5 py-5 text-slate-300 sm:px-10 sm:py-8 lg:flex lg:h-dvh lg:flex-col lg:px-14 lg:py-12 lg:short:py-8 xl:px-[88px]"
        style={{ backgroundImage: HERO_BACKGROUND }}
      >
        <div className="flex items-center gap-4 sm:gap-5">
          <MannaLogo onDark className="h-10 w-auto sm:h-12" />
          <div className="h-10 w-px bg-white/25 sm:h-14" aria-hidden="true" />
          <span className="text-3xl font-bold tracking-tight text-white sm:text-4xl">CMMS</span>
        </div>
        <p className="mt-3 text-sm font-medium text-slate-200 sm:text-[15px]">
          Maintenance &amp; Engineering Store System
        </p>

        {/* On a phone the logo band alone introduces the form, so the whole
            sign-in fits one screen. */}
        <div className="mt-8 hidden sm:block lg:my-auto lg:py-10 lg:short:py-4">
          <h1 className="text-4xl font-bold leading-[1.15] tracking-tight text-white xl:text-[44px] xl:short:text-[38px]">
            Smarter Maintenance.
            <span className="block text-brand-500">Stronger Production.</span>
          </h1>

          {/* The rest of the story is for a desk screen; on a phone the
              headline introduces the form and gets out of its way. */}
          <p className="mt-6 short:mt-4 hidden max-w-md text-[17px] leading-relaxed text-slate-300 lg:block">
            Manna CMMS helps you manage breakdowns, maintenance, and store operations across all our
            plants — safely, efficiently and together.
          </p>

          <ul className="mt-10 short:mt-6 hidden max-w-xl grid-cols-4 gap-4 lg:grid">
            {FEATURES.map(({ icon: Icon, label }) => (
              <li key={label[1]} className="text-[14px] leading-snug text-slate-200">
                <span className="mb-3 grid h-14 w-14 place-items-center short:mb-2 short:h-12 short:w-12 rounded-xl border border-brand-500/70 bg-ink-950/40">
                  <Icon className="h-6 w-6 text-white" aria-hidden="true" />
                </span>
                {label[0]}
                <br />
                {label[1]}
              </li>
            ))}
          </ul>
        </div>
      </aside>

      {/* ----------------------------------------------------------------- Form */}
      <main className="relative isolate flex flex-1 flex-col overflow-hidden bg-gradient-to-b from-white to-slate-50 px-5 py-5 sm:px-8 sm:py-8 lg:h-dvh lg:overflow-y-auto lg:px-12 lg:short:py-5">
        {/* Decoration only: the gear watermark and the warm wave behind the
            footer. Kept faint so the card stays the only thing with weight. */}
        <Cog
          className="pointer-events-none absolute bottom-20 left-6 -z-10 hidden h-28 w-28 text-brand-500/10 2xl:block"
          strokeWidth={1.5}
          aria-hidden="true"
        />
        <svg
          className="pointer-events-none absolute bottom-0 right-0 -z-10 h-[45%] w-[70%] text-brand-500/[0.07]"
          viewBox="0 0 400 300"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path d="M400 0 C 330 70, 300 160, 190 210 C 110 245, 50 270, 0 300 L 400 300 Z" fill="currentColor" />
        </svg>

        <div className="flex flex-1 items-start justify-center lg:items-center">
          <form
            onSubmit={handleSubmit}
            noValidate
            // On a phone the form sits flat on the page - a card inside a
            // 390px screen is a border eating the width and a fold of height.
            className="w-full max-w-[520px] sm:rounded-2xl sm:border sm:border-slate-200/80 sm:bg-white sm:px-12 sm:py-10 sm:shadow-[0_12px_40px_-12px_rgba(16,24,40,0.12)] sm:short:py-7"
          >
            <div className="h-1 w-12 rounded-full bg-gradient-to-r from-brand-600 to-brand-400" aria-hidden="true" />
            <h2 className="mt-4 text-[26px] font-bold tracking-tight text-slate-900 sm:mt-5 sm:text-[30px] short:mt-3">
              Sign In
            </h2>
            <p className="mt-1.5 text-[15px] text-slate-600">Welcome back! Please login to your account.</p>

            {error && (
              <div role="alert" className="note note-rose mt-5 short:mt-4">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{String(error)}</span>
              </div>
            )}

            <div className="mt-6 short:mt-5">
              <label htmlFor="login-email" className="mb-2 block text-sm font-semibold text-slate-800">
                Email Address
              </label>
              <div className="relative">
                <Mail
                  className="pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-slate-500"
                  aria-hidden="true"
                />
                <input
                  id="login-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="username"
                  autoFocus={!remembered}
                  className="field h-12 pl-12 text-[15px] max-sm:h-12"
                 
                  required
                />
              </div>
            </div>

            <div className="mt-4 short:mt-3.5">
              <label htmlFor="login-password" className="mb-2 block text-sm font-semibold text-slate-800">
                Password
              </label>
              <div className="relative">
                <LockKeyhole
                  className="pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-slate-500"
                  aria-hidden="true"
                />
                <input
                  id="login-password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  // A returning user's email is already filled in.
                  autoFocus={Boolean(remembered)}
                  className="field h-12 pl-12 pr-12 text-[15px] max-sm:h-12"
                  placeholder="Your ERPNext password"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-1 top-1/2 grid h-10 w-10 -translate-y-1/2 cursor-pointer place-items-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-pressed={showPassword}
                >
                  {showPassword ? (
                    <EyeOff className="h-[18px] w-[18px]" aria-hidden="true" />
                  ) : (
                    <Eye className="h-[18px] w-[18px]" aria-hidden="true" />
                  )}
                </button>
              </div>
            </div>

            <div className="mt-4 flex items-center short:mt-3">
              <label className="inline-flex min-h-10 cursor-pointer select-none items-center gap-2.5 text-[14px] text-slate-700">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                  className="h-[18px] w-[18px] cursor-pointer rounded accent-brand-600"
                />
                Remember me
              </label>
            </div>

            <button
              type="submit"
              disabled={loading}
              aria-busy={loading}
              className="btn btn-primary mt-5 short:mt-4 h-12 w-full text-[15px] max-sm:h-12"
            >
              {loading ? (
                <>
                  <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" aria-hidden="true" />
                  Signing in…
                </>
              ) : (
                <>
                  <ArrowRight className="h-[18px] w-[18px]" aria-hidden="true" />
                  Sign In
                </>
              )}
            </button>
          </form>
        </div>

        <footer className="mt-6 text-[13px] short:mt-4">
          {/* Repeats the brand, so it goes where height is scarce: on a phone
              (the band above already says it) and on a short window. */}
          <div className="hidden text-right lg:block short:hidden">
            <p className="font-semibold text-brand-700">Manna CMMS</p>
            <p className="mt-0.5 text-slate-600">Built for Operations. Trusted by Teams.</p>
          </div>
          <div className="flex flex-col items-center gap-2 border-t border-slate-200/80 pt-4 text-slate-500 sm:flex-row sm:justify-between lg:mt-4 short:mt-0 short:pt-3">
            <p>© {new Date().getFullYear()} Manna Group. All rights reserved.</p>
            <nav aria-label="Legal" className="flex items-center gap-3">
              <a href={TERMS_URL} className="inline-flex min-h-6 items-center hover:text-slate-900 hover:underline">
                Terms &amp; Conditions
              </a>
              <span aria-hidden="true">·</span>
              <a href={PRIVACY_URL} className="inline-flex min-h-6 items-center hover:text-slate-900 hover:underline">
                Privacy Policy
              </a>
            </nav>
          </div>
        </footer>
      </main>
    </div>
  );
};

export default Login;
