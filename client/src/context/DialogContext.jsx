import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { AlertTriangle, CircleHelp, PenLine, Trash2 } from "lucide-react";

/**
 * In-app replacements for window.confirm and window.prompt.
 *
 * The browser's own boxes cannot be styled - they arrive as grey system
 * dialogs headed "localhost:5175 says" - so every confirmation in the console
 * goes through here instead, drawn like the rest of the app.
 *
 *   const { confirm, prompt } = useDialog();
 *   if (!(await confirm({ title: "Sign out?", confirmLabel: "Sign out" }))) return;
 *   const typed = await prompt({ title: "Correct HSN", defaultValue: "8483" }); // null if cancelled
 *
 * `tone`: "danger" for something destructive (red button, and Cancel takes
 * the focus so a stray Enter does not delete), "warning" for something that
 * loses work, anything else for a plain question.
 */
const DialogContext = createContext(null);

const TONE = {
  danger: { icon: Trash2, tile: "bg-rose-50 text-rose-600 ring-rose-100", button: "btn-danger" },
  warning: { icon: AlertTriangle, tile: "bg-amber-50 text-amber-600 ring-amber-100", button: "btn-primary" },
  default: { icon: CircleHelp, tile: "bg-brand-50 text-brand-600 ring-brand-100", button: "btn-primary" },
  prompt: { icon: PenLine, tile: "bg-brand-50 text-brand-600 ring-brand-100", button: "btn-primary" },
};

export const DialogProvider = ({ children }) => {
  // { id, kind: "confirm" | "prompt", options, resolve }
  const [dialog, setDialog] = useState(null);
  const nextId = useRef(0);

  const open = useCallback(
    (kind, options) =>
      new Promise((resolve) => {
        const id = ++nextId.current;
        setDialog((previous) => {
          // A second question while one is showing replaces it; the first
          // is answered "cancel" rather than left hanging.
          previous?.resolve(previous.kind === "prompt" ? null : false);
          return { id, kind, options: typeof options === "string" ? { message: options } : options || {}, resolve };
        });
      }),
    []
  );

  const confirm = useCallback((options) => open("confirm", options), [open]);
  const prompt = useCallback((options) => open("prompt", options), [open]);

  const answer = (value) => {
    dialog?.resolve(value);
    setDialog(null);
  };

  return (
    <DialogContext.Provider value={{ confirm, prompt }}>
      {children}
      {dialog && (
        <Dialog
          key={dialog.id}
          kind={dialog.kind}
          options={dialog.options}
          onAnswer={answer}
        />
      )}
    </DialogContext.Provider>
  );
};

const Dialog = ({ kind, options, onAnswer }) => {
  const {
    title = kind === "prompt" ? "Enter a value" : "Are you sure?",
    message = "",
    confirmLabel = kind === "prompt" ? "Save" : "Confirm",
    cancelLabel = "Cancel",
    tone = kind === "prompt" ? "prompt" : "default",
    defaultValue = "",
    placeholder = "",
  } = options;
  const style = TONE[tone] || TONE.default;
  const Icon = style.icon;
  const isPrompt = kind === "prompt";

  const [value, setValue] = useState(String(defaultValue ?? ""));
  const cancelRef = useRef(null);
  const confirmRef = useRef(null);
  const inputRef = useRef(null);
  const latest = useRef(onAnswer);
  latest.current = onAnswer;

  const cancel = () => onAnswer(isPrompt ? null : false);
  const accept = () => onAnswer(isPrompt ? value : true);

  // Focus goes in on open and back where it was on close. Escape cancels.
  useEffect(() => {
    const opener = document.activeElement;
    if (isPrompt) {
      inputRef.current?.focus();
      inputRef.current?.select();
    } else if (tone === "danger") {
      cancelRef.current?.focus();
    } else {
      confirmRef.current?.focus();
    }
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        latest.current(isPrompt ? null : false);
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      opener?.focus?.();
    };
  }, [isPrompt, tone]);

  return (
    <div className="modal-backdrop z-[60]" onMouseDown={(e) => e.target === e.currentTarget && cancel()}>
      <form
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        aria-describedby={message ? "dialog-message" : undefined}
        className="modal max-w-md max-sm:mx-4 max-sm:max-h-[90vh] max-sm:rounded-xl"
        onSubmit={(e) => {
          e.preventDefault();
          accept();
        }}
      >
        <div className="flex gap-4 px-5 pb-2 pt-6 sm:px-6">
          <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-full ring-4 ${style.tile}`}>
            <Icon className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1 pt-0.5">
            <h2 id="dialog-title" className="text-[17px] font-semibold tracking-tight text-slate-900">
              {title}
            </h2>
            {message && (
              <p id="dialog-message" className="mt-1.5 whitespace-pre-line text-[14px] leading-relaxed text-slate-600">
                {message}
              </p>
            )}
            {isPrompt && (
              <input
                ref={inputRef}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={placeholder}
                className="field mt-3"
                aria-labelledby="dialog-title"
              />
            )}
          </div>
        </div>
        <div className="flex flex-col-reverse gap-2 px-5 pb-5 pt-4 sm:flex-row sm:justify-end sm:px-6">
          <button ref={cancelRef} type="button" className="btn btn-neutral" onClick={cancel}>
            {cancelLabel}
          </button>
          <button ref={confirmRef} type="submit" className={`btn ${style.button}`}>
            {confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
};

export const useDialog = () => {
  const context = useContext(DialogContext);
  if (!context) {
    throw new Error("useDialog must be used within a DialogProvider");
  }
  return context;
};
