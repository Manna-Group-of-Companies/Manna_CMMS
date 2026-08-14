import {
  Check,
  X,
  Clock,
  ShieldCheck,
  UserCheck,
  Send,
  PackageCheck,
  Ban,
} from "lucide-react";

/**
 * One vocabulary for the branch request workflow, shared by all three portals
 * so a request reads the same wherever it is shown.
 *
 *   Pending Admin  →  Pending Supervisor  →  Approved
 *          ↘ Rejected            ↘ Rejected
 */
export const STATUS_META = {
  "Pending Admin": {
    label: "Pending — Admin Review",
    short: "Pending Admin",
    step: 1,
    badge: "bg-amber-500/10 text-amber-600 border border-amber-500/20",
    dot: "bg-amber-500",
  },
  "Pending Supervisor": {
    label: "Admin Approved — Awaiting Supervisor",
    short: "Supervisor Pending",
    step: 2,
    badge: "bg-indigo-500/10 text-indigo-600 border border-indigo-500/20",
    dot: "bg-indigo-500",
  },
  Approved: {
    label: "Approved — Completed",
    short: "Approved",
    step: 3,
    badge: "bg-emerald-500/10 text-emerald-600 border border-emerald-500/20",
    dot: "bg-emerald-500",
  },
  Rejected: {
    label: "Rejected",
    short: "Rejected",
    step: 0,
    badge: "bg-rose-500/10 text-rose-600 border border-rose-500/20",
    dot: "bg-rose-500",
  },
  Cancelled: {
    label: "Withdrawn by branch",
    short: "Withdrawn",
    step: 0,
    badge: "bg-slate-500/10 text-slate-600 border border-slate-300",
    dot: "bg-slate-400",
  },
};

export const metaFor = (status) => STATUS_META[status] || STATUS_META.Cancelled;

/** The current status, worded the same everywhere. */
export const RequestStatusBadge = ({ status, compact = false }) => {
  const meta = metaFor(status);
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider whitespace-nowrap ${meta.badge}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`}></span>
      {compact ? meta.short : meta.label}
    </span>
  );
};

/** "14 Aug 2026, 09:25" — short enough to sit under a stage chip. */
export const formatActorStamp = (value) => {
  if (!value) return "";
  const date = new Date(value);
  return `${date.toLocaleDateString([], {
    day: "numeric",
    month: "short",
    year: "numeric",
  })}, ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
};

/**
 * Where the request stands in the two-approval chain.
 *
 * Each decided stage names who decided it and when, so a second supervisor
 * reading the queue sees that a colleague already signed a request off without
 * having to open the history.
 */
export const ApprovalStages = ({ request }) => {
  const meta = metaFor(request.status);
  const closed = request.status === "Rejected" || request.status === "Cancelled";
  // Which stage turned it down, so the chain shows where it stopped.
  const failedAt =
    request.status === "Rejected" ? (request.supervisorDecidedAt ? 2 : 1) : null;

  // The last thing that happened at a given stage. `history` snapshots the
  // name and role at decision time, so a renamed or deleted account still
  // reads correctly here — the populated ref would be null for those.
  const decisionAt = (stage) =>
    [...(request.history || [])].reverse().find((entry) => entry.stage === stage);

  // Who owns each stage, and when they acted. The completion chip carries no
  // caption of its own — it is the supervisor's approval by another name.
  const actorFor = (index) => {
    const [live, stage] = [
      [{ name: request.branch?.name, at: request.createdAt }, "Submitted"],
      [{ name: request.admin?.name, at: request.adminDecidedAt }, "Admin"],
      [{ name: request.supervisor?.name, at: request.supervisorDecidedAt }, "Supervisor"],
      [{ name: null, at: null }, null],
    ][index];

    if (!stage) return null;

    const logged = decisionAt(stage);
    const name = live.name || logged?.byName;
    const at = live.at || logged?.at;

    if (!name || !at) return null;
    return { name, stamp: formatActorStamp(at) };
  };

  const stages = [
    { name: "Submitted", icon: Send, index: 0 },
    { name: "Admin Approval", icon: ShieldCheck, index: 1 },
    { name: "Supervisor Approval", icon: UserCheck, index: 2 },
    { name: "Completed", icon: PackageCheck, index: 3 },
  ];

  return (
    <div className="flex items-start gap-1 flex-wrap">
      {stages.map((stage, i) => {
        const Icon = stage.icon;
        // A completed request fills the last chip too, not just the ones
        // before it.
        const done = !closed && (meta.step > stage.index || meta.step === 3);
        const current = !closed && meta.step === stage.index + 1 && meta.step < 3;
        const failed = failedAt !== null && stage.index === failedAt;
        const reached = failedAt !== null ? stage.index <= failedAt : done || current;

        let tone = "bg-slate-100 text-slate-400 border-slate-200";
        if (failed) tone = "bg-rose-500/10 text-rose-600 border-rose-500/20";
        else if (current) tone = "bg-amber-500/10 text-amber-600 border-amber-500/30";
        else if (done || (reached && stage.index === 0)) {
          tone = "bg-emerald-500/10 text-emerald-600 border-emerald-500/20";
        }
        if (request.status === "Cancelled" && stage.index > 0) {
          tone = "bg-slate-100 text-slate-400 border-slate-200";
        }

        const actor = actorFor(stage.index);

        return (
          <div key={stage.name} className="flex items-start gap-1">
            <div className="flex flex-col items-start gap-0.5">
              <div
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[10px] font-semibold ${tone}`}
                title={
                  actor ? `${stage.name} — ${actor.name} on ${actor.stamp}` : stage.name
                }
              >
                {failed ? (
                  <X className="h-3 w-3" />
                ) : done || (stage.index === 0 && request.status !== "Cancelled") ? (
                  <Check className="h-3 w-3" />
                ) : current ? (
                  <Clock className="h-3 w-3" />
                ) : request.status === "Cancelled" && stage.index > 0 ? (
                  <Ban className="h-3 w-3" />
                ) : (
                  <Icon className="h-3 w-3" />
                )}
                <span className="hidden sm:inline">{stage.name}</span>
              </div>

              {/* Who signed this stage off, and when. */}
              {actor && (
                <span className="text-[9px] leading-tight text-slate-500 max-w-[130px]">
                  <span className="font-semibold text-slate-700">{actor.name}</span>
                  <span className="block">{actor.stamp}</span>
                </span>
              )}
            </div>
            {i < stages.length - 1 && (
              <span className="text-slate-300 text-xs leading-6">→</span>
            )}
          </div>
        );
      })}
    </div>
  );
};

const formatStamp = (value) => {
  if (!value) return "";
  const date = new Date(value);
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
};

/** The full decision trail, kept visible at every stage of the workflow. */
export const RequestHistory = ({ history = [] }) => {
  if (history.length === 0) {
    return <p className="text-xs text-slate-500">No history recorded yet.</p>;
  }

  const toneFor = (action) => {
    if (action === "Approved") return { ring: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600", Icon: Check };
    if (action === "Rejected") return { ring: "border-rose-500/30 bg-rose-500/10 text-rose-600", Icon: X };
    if (action === "Cancelled") return { ring: "border-slate-300 bg-slate-100 text-slate-500", Icon: Ban };
    return { ring: "border-brand-500/30 bg-brand-500/10 text-brand-700", Icon: Send };
  };

  return (
    <ol className="space-y-3">
      {history.map((entry, index) => {
        const { ring, Icon } = toneFor(entry.action);
        return (
          <li key={index} className="flex gap-3">
            <div className={`h-7 w-7 shrink-0 rounded-full border flex items-center justify-center ${ring}`}>
              <Icon className="h-3.5 w-3.5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-xs font-semibold text-slate-900">
                  {entry.stage === "Submitted" ? "Request submitted" : `${entry.stage} ${entry.action.toLowerCase()}`}
                </span>
                <span className="text-[11px] text-slate-500">
                  {entry.byName}
                  {entry.byRole ? ` · ${entry.byRole}` : ""}
                </span>
                {entry.quantity ? (
                  <span className="text-[11px] font-semibold text-slate-700">
                    Qty {entry.quantity}
                  </span>
                ) : null}
              </div>
              {entry.comment ? (
                <p className="text-xs text-slate-600 mt-0.5 break-words">"{entry.comment}"</p>
              ) : null}
              <span className="text-[10px] text-slate-400">{formatStamp(entry.at)}</span>
            </div>
          </li>
        );
      })}
    </ol>
  );
};

export default RequestStatusBadge;
