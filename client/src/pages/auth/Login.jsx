import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth, homePathFor } from "../../context/AuthContext";
import { useNotifications } from "../../context/NotificationContext";
import { KeyRound, Mail } from "lucide-react";
import MannaLogo from "../../components/MannaLogo";

const Login = () => {
  const { login } = useAuth();
  const { showToast } = useNotifications();
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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
    <div className="min-h-screen bg-canvas text-slate-900 flex flex-col justify-center items-center p-4 relative overflow-hidden">
      {/* Soft teal wash behind the card */}
      <div className="absolute top-1/4 left-1/4 -translate-x-1/2 -translate-y-1/2 w-[350px] h-[350px] bg-brand-500/15 rounded-full blur-[110px] pointer-events-none"></div>
      <div className="absolute bottom-1/4 right-1/4 translate-x-1/2 translate-y-1/2 w-[350px] h-[350px] bg-brand-400/10 rounded-full blur-[110px] pointer-events-none"></div>

      <div className="w-full max-w-md z-10">
        {/* Logo and Header */}
        <div className="flex flex-col items-center mb-8">
          {/* The same lockup as the sidebar, at sign-in size: the mark, a rule,
              then the product name. The sign-in page is on a light ground, so
              the mark sits on it directly rather than on a white plate. */}
          <div className="flex items-center gap-4">
            <MannaLogo className="h-12 w-auto" />
            <div className="h-11 w-px bg-charcoal-900/15" aria-hidden="true" />
            <span className="text-3xl font-extrabold text-charcoal-900 tracking-tight leading-none">
              CMMS
            </span>
          </div>
          <p className="text-sm text-slate-600 mt-4 text-center">
            Maintenance &amp; engineering store &middot; signed in with ERPNext
          </p>
        </div>

        {/* Login Card */}
        <div className="glass-premium p-8 rounded-2xl">
          <h2 className="text-xl font-semibold text-slate-900 mb-6 text-center">Sign In to Portal</h2>

          {error && (
            <div className="mb-4 p-3 rounded-lg bg-rose-50 border border-rose-500/25 text-rose-600 text-xs font-medium">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Email */}
            <div>
              <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-2">
                ERPNext Email
              </label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-slate-500">
                  <Mail className="h-[18px] w-[18px]" />
                </span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="username"
                  autoFocus
                  className="w-full pl-11 pr-4 py-3 rounded-xl bg-white border border-slate-200 text-slate-900 placeholder-slate-400 text-sm focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/20 transition-all"
                  placeholder="you@mannarubber.com"
                  required
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-2">
                Password
              </label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-slate-500">
                  <KeyRound className="h-[18px] w-[18px]" />
                </span>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  className="w-full pl-11 pr-4 py-3 rounded-xl bg-white border border-slate-200 text-slate-900 placeholder-slate-400 text-sm focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/20 transition-all"
                  placeholder="Your ERPNext password"
                  required
                />
              </div>
              <p className="mt-2 text-[11px] text-slate-500">
                The same password you use to sign in to ERPNext.
              </p>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-gradient-to-r from-brand-600 to-brand-700 hover:from-brand-500 hover:to-brand-600 text-white text-sm font-semibold py-3 px-4 rounded-xl shadow-lg hover:shadow-brand-500/10 active:scale-98 transition-all flex items-center justify-center cursor-pointer disabled:opacity-50"
            >
              {loading ? (
                <div className="h-5 w-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
              ) : (
                "Sign In"
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default Login;
