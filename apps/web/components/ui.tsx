"use client";

import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Icons, type IconName } from "./icons";

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
  icon?: IconName;
  loading?: boolean;
};

export function Button({ variant = "secondary", size = "md", icon, loading, children, className = "", disabled, ...props }: ButtonProps) {
  const IconCmp = icon ? Icons[icon] : null;
  return (
    <button className={`btn btn-${variant} btn-${size} ${className}`} disabled={disabled || loading} {...props}>
      {loading ? <Spinner size={14} /> : IconCmp ? <IconCmp size={size === "sm" ? 14 : 16} /> : null}
      {children && <span>{children}</span>}
    </button>
  );
}

export function Spinner({ size = 16 }: { size?: number }) {
  return <span className="spinner" style={{ width: size, height: size }} role="status" aria-label="Loading" />;
}

// ---------------------------------------------------------------------------
// Badges and status
// ---------------------------------------------------------------------------

export type Tone = "neutral" | "accent" | "success" | "warning" | "danger" | "info";

export function Badge({ tone = "neutral", children, dot }: { tone?: Tone; children: ReactNode; dot?: boolean }) {
  return (
    <span className={`badge badge-${tone}`}>
      {dot && <span className="badge-dot" />}
      {children}
    </span>
  );
}

const STATUS_MAP: Record<string, { label: string; tone: Tone; pulse?: boolean }> = {
  draft: { label: "Draft", tone: "neutral" },
  processing: { label: "Analyzing", tone: "info", pulse: true },
  qualification: { label: "Qualifying", tone: "info", pulse: true },
  research: { label: "Retrieving evidence", tone: "info", pulse: true },
  generation: { label: "Writing", tone: "info", pulse: true },
  validation: { label: "Validating", tone: "info", pulse: true },
  human_review: { label: "Needs review", tone: "warning" },
  completed: { label: "Approved", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
  queued: { label: "Queued", tone: "info", pulse: true },
  running: { label: "Running", tone: "info", pulse: true },
  waiting_review: { label: "Ready for review", tone: "warning" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  in_review: { label: "In review", tone: "warning" },
  approved: { label: "Approved", tone: "success" },
  rejected: { label: "Rejected", tone: "danger" },
  addressed: { label: "Addressed", tone: "success" },
  partially_addressed: { label: "Partial", tone: "warning" },
  unaddressed: { label: "Gap", tone: "danger" },
  needs_clarification: { label: "Clarify", tone: "warning" },
  not_applicable: { label: "N/A", tone: "neutral" },
  supported: { label: "Supported", tone: "success" },
  unsupported: { label: "Unsupported", tone: "danger" },
  needs_confirmation: { label: "Confirm", tone: "warning" },
  conflicting: { label: "Conflicting", tone: "danger" },
  stale: { label: "Stale", tone: "warning" },
  needs_revision: { label: "Needs revision", tone: "warning" },
  validated: { label: "Validated", tone: "success" },
  met: { label: "Met", tone: "success" },
  unknown: { label: "Unconfirmed", tone: "warning" },
  not_met: { label: "Not met", tone: "danger" },
  go: { label: "Go", tone: "success" },
  conditional: { label: "Conditional", tone: "warning" },
  no_go: { label: "No-go", tone: "danger" },
  parsed: { label: "Ready", tone: "success" },
  pending_approval: { label: "Awaiting approval", tone: "warning" },
  archived: { label: "Archived", tone: "neutral" }
};

export function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_MAP[status] ?? { label: status.replace(/_/g, " "), tone: "neutral" as Tone };
  return (
    <span className={`badge badge-${meta.tone} ${meta.pulse ? "badge-pulse" : ""}`}>
      <span className="badge-dot" />
      {meta.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Layout primitives
// ---------------------------------------------------------------------------

export function Card({ title, actions, children, className = "", padded = true }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; padded?: boolean }) {
  return (
    <section className={`card ${padded ? "card-padded" : ""} ${className}`}>
      {(title || actions) && (
        <header className="card-header">
          {title && <h2 className="card-title">{title}</h2>}
          {actions && <div className="card-actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function EmptyState({ icon = "sparkles", title, children, action }: { icon?: IconName; title: string; children?: ReactNode; action?: ReactNode }) {
  const IconCmp = Icons[icon];
  return (
    <div className="empty">
      <div className="empty-icon"><IconCmp size={22} /></div>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action && <div className="empty-action">{action}</div>}
    </div>
  );
}

export function Skeleton({ height = 16, width = "100%", style }: { height?: number; width?: number | string; style?: React.CSSProperties }) {
  return <span className="skeleton" style={{ height, width, ...style }} />;
}

export function PageSkeleton() {
  return (
    <div className="page">
      <Skeleton height={34} width={280} />
      <div style={{ height: 24 }} />
      <div className="grid-3">
        {[0, 1, 2].map((i) => <Skeleton key={i} height={110} />)}
      </div>
      <div style={{ height: 20 }} />
      <Skeleton height={260} />
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="error-state">
      <Icons.alert size={20} />
      <div>
        <strong>Something went wrong</strong>
        <p>{message}</p>
      </div>
      {onRetry && <Button size="sm" icon="refresh" onClick={onRetry}>Try again</Button>}
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string; count?: number | string; alert?: boolean }[]; value: T; onChange: (id: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((tab) => (
        <button key={tab.id} role="tab" aria-selected={tab.id === value} className={`tab ${tab.id === value ? "tab-active" : ""}`} onClick={() => onChange(tab.id)}>
          {tab.label}
          {tab.count !== undefined && <span className={`tab-count ${tab.alert ? "tab-count-alert" : ""}`}>{tab.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Progress({ value, tone = "accent" }: { value: number; tone?: Tone }) {
  return (
    <div className="progress" role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div className={`progress-fill progress-${tone}`} style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
    </div>
  );
}

export function Ring({ value, size = 72, label }: { value: number; size?: number; label?: string }) {
  const r = size / 2 - 6;
  const c = 2 * Math.PI * r;
  const tone = value >= 0.9 ? "var(--success)" : value >= 0.7 ? "var(--warning)" : "var(--danger)";
  return (
    <div className="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--line)" strokeWidth={6} fill="none" />
        <circle cx={size / 2} cy={size / 2} r={r} stroke={tone} strokeWidth={6} fill="none" strokeDasharray={c} strokeDashoffset={c * (1 - value)} strokeLinecap="round" transform={`rotate(-90 ${size / 2} ${size / 2})`} style={{ transition: "stroke-dashoffset .6s ease" }} />
      </svg>
      <span className="ring-label">{label ?? `${Math.round(value * 100)}%`}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------------

export function Field({ label, hint, error, children }: { label: string; hint?: ReactNode; error?: string | null; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children(id)}
      {error ? <span className="field-error">{error}</span> : hint ? <span className="field-hint">{hint}</span> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overlays
// ---------------------------------------------------------------------------

export function Modal({ open, onClose, title, description, children, footer, width = 520 }: { open: boolean; onClose: () => void; title: string; description?: ReactNode; children: ReactNode; footer?: ReactNode; width?: number }) {
  useEscape(open, onClose);
  if (!open) return null;
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} style={{ maxWidth: width }}>
        <header className="modal-header">
          <div>
            <h2>{title}</h2>
            {description && <p>{description}</p>}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><Icons.x /></button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-footer">{footer}</footer>}
      </div>
    </div>
  );
}

export function Drawer({ open, onClose, title, subtitle, children }: { open: boolean; onClose: () => void; title: string; subtitle?: ReactNode; children: ReactNode }) {
  useEscape(open, onClose);
  if (!open) return null;
  return (
    <div className="overlay overlay-drawer" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={title}>
        <header className="drawer-header">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><Icons.x /></button>
        </header>
        <div className="drawer-body">{children}</div>
      </aside>
    </div>
  );
}

function useEscape(open: boolean, onClose: () => void) {
  const ref = useRef(onClose);
  ref.current = onClose;
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => e.key === "Escape" && ref.current();
    window.addEventListener("keydown", handler);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", handler);
      document.body.style.overflow = previous;
    };
  }, [open]);
}

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------

type Toast = { id: number; tone: "success" | "error" | "info"; message: string };
const ToastContext = createContext<(tone: Toast["tone"], message: string) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((tone: Toast["tone"], message: string) => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current.slice(-3), { id, tone, message }]);
    setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), tone === "error" ? 7000 : 4000);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((toast) => {
          const IconCmp = toast.tone === "success" ? Icons.checkCircle : toast.tone === "error" ? Icons.alert : Icons.sparkles;
          return (
            <div key={toast.id} className={`toast toast-${toast.tone}`}>
              <IconCmp size={16} />
              <span>{toast.message}</span>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const push = useContext(ToastContext);
  return {
    success: (message: string) => push("success", message),
    error: (message: string | unknown) => push("error", typeof message === "string" ? message : message instanceof Error ? message.message : "Something went wrong"),
    info: (message: string) => push("info", message)
  };
}
