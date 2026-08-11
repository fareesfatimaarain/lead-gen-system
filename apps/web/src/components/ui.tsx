import Link from "next/link";
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------

type ButtonVariant = "primary" | "default" | "ghost" | "danger";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-fg hover:opacity-90 active:opacity-80 border-transparent",
  default: "bg-surface text-fg border-border-strong hover:bg-surface-hover",
  ghost: "bg-transparent text-fg-muted border-transparent hover:bg-surface-hover hover:text-fg",
  danger: "bg-transparent text-danger border-border-strong hover:bg-danger-muted",
};

export function Button({
  variant = "default",
  size = "md",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: "sm" | "md" }) {
  return (
    <button
      {...props}
      className={cx(
        "motion-ok inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded border font-medium",
        "disabled:pointer-events-none disabled:opacity-45",
        size === "sm" ? "h-6 px-2 text-xs" : "h-7 px-2.5 text-sm",
        BUTTON_VARIANTS[variant],
        className,
      )}
    />
  );
}

// ---------------------------------------------------------------------------
// Form fields
// ---------------------------------------------------------------------------

export function Field({
  label,
  help,
  error,
  required,
  children,
}: {
  label: string;
  help?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-fg-muted">
        {label}
        {required ? <span className="ml-0.5 text-fg-subtle">*</span> : null}
      </span>
      {children}
      {error ? (
        <span className="text-xs text-danger">{error}</span>
      ) : help ? (
        <span className="text-xs text-fg-subtle">{help}</span>
      ) : null}
    </label>
  );
}

const CONTROL =
  "motion-ok h-7 w-full rounded border border-border-strong bg-surface px-2 text-base text-fg " +
  "hover:border-fg-subtle focus:border-accent focus:outline-none";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(CONTROL, className)} />;
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} className={cx(CONTROL, "cursor-pointer", className)}>
      {children}
    </select>
  );
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={cx(
        "motion-ok w-full rounded border border-border-strong bg-surface px-2 py-1.5 text-base leading-5 text-fg",
        "hover:border-fg-subtle focus:border-accent focus:outline-none",
        className,
      )}
    />
  );
}

export function Checkbox({ label, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-base text-fg">
      <input
        {...props}
        type="checkbox"
        className="size-3.5 cursor-pointer rounded-sm border-border-strong accent-[rgb(var(--accent))]"
      />
      {label}
    </label>
  );
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export type Tone = "neutral" | "ok" | "warn" | "danger" | "accent";

const TONES: Record<Tone, string> = {
  neutral: "bg-surface-hover text-fg-muted",
  ok: "bg-ok-muted text-ok",
  warn: "bg-warn-muted text-warn",
  danger: "bg-danger-muted text-danger",
  accent: "bg-accent-muted text-accent",
};

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={cx(
        "inline-flex h-4.5 items-center rounded-sm px-1.5 text-2xs font-medium uppercase tracking-wide",
        TONES[tone],
      )}
      style={{ height: "18px" }}
    >
      {children}
    </span>
  );
}

/** A 6px dot. Colour is the only signal, so it always ships with a text label beside it. */
export function StatusDot({ tone }: { tone: Tone }) {
  const colors: Record<Tone, string> = {
    neutral: "bg-fg-subtle",
    ok: "bg-ok",
    warn: "bg-warn",
    danger: "bg-danger",
    accent: "bg-accent",
  };
  return <span className={cx("inline-block size-1.5 shrink-0 rounded-full", colors[tone])} />;
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cx("rounded-md border border-border bg-surface", className)}>{children}</div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="flex items-start justify-between gap-4 border-b border-border px-6 py-4">
      <div className="min-w-0">
        <h1 className="text-lg font-semibold tracking-tight text-fg">{title}</h1>
        {description ? <p className="mt-0.5 text-sm text-fg-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/**
 * Empty state.
 *
 * `action` is not optional by convention: an empty state that does not tell the
 * user what to do next is a dead end.
 */
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
      <p className="text-md font-medium text-fg">{title}</p>
      <p className="max-w-sm text-sm text-fg-muted">{description}</p>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

/**
 * The only loading affordance in the system. A 2px indeterminate bar, used for
 * genuinely async work — never a spinner on navigation, never a skeleton.
 */
export function ProgressBar({ active }: { active: boolean }) {
  if (!active) return <div className="h-0.5" />;
  return (
    <div className="h-0.5 w-full overflow-hidden bg-border" role="progressbar" aria-label="Working">
      <div className="h-full w-full animate-indeterminate bg-accent" />
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded-sm border border-border bg-surface-hover px-1 text-2xs text-fg-subtle">
      {children}
    </kbd>
  );
}

export function InlineError({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <div className="rounded border border-danger/30 bg-danger-muted px-2.5 py-1.5 text-sm text-danger">
      {children}
    </div>
  );
}

/**
 * A note the user should read but that is not an error.
 *
 * Used for the honest disclosures this product depends on — "this consumes a
 * credit", "nothing enforces this yet", "this adapter is unproven".
 */
export function Notice({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  const styles: Record<Tone, string> = {
    neutral: "border-border bg-surface-hover text-fg-muted",
    ok: "border-ok/30 bg-ok-muted text-ok",
    warn: "border-warn/30 bg-warn-muted text-warn",
    danger: "border-danger/30 bg-danger-muted text-danger",
    accent: "border-accent/30 bg-accent-muted text-accent",
  };
  return (
    <div className={cx("rounded border px-2.5 py-1.5 text-sm", styles[tone])}>{children}</div>
  );
}

// ---------------------------------------------------------------------------
// Tables
//
// Plain semantic tables rather than a virtualizing grid. At the volumes this
// product is designed to produce — deliberately low — a paginated table is
// faster to render, keyboard-navigable for free, and selectable/copyable, which
// a canvas grid is not.
// ---------------------------------------------------------------------------

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={cx("w-full border-collapse text-base", className)}>{children}</table>
    </div>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return (
    <thead className="sticky top-0 z-10 bg-bg">
      <tr className="border-b border-border">{children}</tr>
    </thead>
  );
}

export function TH({
  children,
  align = "left",
  width,
}: {
  children?: ReactNode;
  align?: "left" | "right" | "center";
  width?: string;
}) {
  return (
    <th
      scope="col"
      style={width ? { width } : undefined}
      className={cx(
        "whitespace-nowrap px-3 py-1.5 text-xs font-medium text-fg-subtle",
        align === "right" && "text-right",
        align === "center" && "text-center",
        align === "left" && "text-left",
      )}
    >
      {children}
    </th>
  );
}

export function TR({
  children,
  href,
  className,
}: {
  children: ReactNode;
  /** When set the whole row is a link; the anchor lives in the first cell. */
  href?: string;
  className?: string;
}) {
  return (
    <tr
      className={cx(
        "motion-ok border-b border-border last:border-b-0",
        href && "hover:bg-surface-hover",
        className,
      )}
    >
      {children}
    </tr>
  );
}

export function TD({
  children,
  align = "left",
  className,
  mono,
}: {
  children?: ReactNode;
  align?: "left" | "right" | "center";
  className?: string;
  mono?: boolean;
}) {
  return (
    <td
      className={cx(
        "px-3 py-1.5 align-middle text-fg",
        align === "right" && "text-right tabular",
        align === "center" && "text-center",
        mono && "mono text-sm",
        className,
      )}
    >
      {children}
    </td>
  );
}

/** The clickable label inside a row's first cell. Keeps the row keyboard-reachable. */
export function RowLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="motion-ok font-medium text-fg hover:text-accent">
      {children}
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Data display
// ---------------------------------------------------------------------------

export function Toolbar({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border px-6 py-2">
      {children}
    </div>
  );
}

export function SectionHeading({
  title,
  note,
  actions,
}: {
  title: string;
  note?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border px-4 py-2.5">
      <div className="min-w-0">
        <h2 className="text-sm font-medium text-fg">{title}</h2>
        {note ? <p className="mt-0.5 text-xs text-fg-subtle">{note}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
    </div>
  );
}

/** Label/value rows. The dense alternative to a form for read-only detail. */
export function DescriptionList({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl>
      {rows.map(([label, value], i) => (
        <div
          key={`${label}-${i}`}
          className="flex items-baseline justify-between gap-4 border-b border-border px-4 py-1.5 last:border-b-0"
        >
          <dt className="shrink-0 text-sm text-fg-muted">{label}</dt>
          <dd className="min-w-0 text-right text-base text-fg tabular">{value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * A headline number.
 *
 * `hint` is not decoration: a number with no denominator invites the wrong
 * conclusion, and on this product's dashboard the wrong conclusion is usually
 * "send more".
 */
export function Stat({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: Tone;
}) {
  const toneClass: Record<Tone, string> = {
    neutral: "text-fg",
    ok: "text-ok",
    warn: "text-warn",
    danger: "text-danger",
    accent: "text-accent",
  };
  return (
    <div className="min-w-0 px-4 py-3">
      <p className="truncate text-xs text-fg-muted">{label}</p>
      <p className={cx("mt-0.5 text-xl font-semibold tabular", toneClass[tone])}>{value}</p>
      {hint ? <p className="mt-0.5 truncate text-xs text-fg-subtle">{hint}</p> : null}
    </div>
  );
}

export function StatRow({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-2 divide-x divide-y divide-border border-b border-border sm:grid-cols-3 lg:grid-cols-5 lg:divide-y-0">
      {children}
    </div>
  );
}

/**
 * A 0-100 bar.
 *
 * Rendered as a meter with an explicit numeric label — the bar is a glance aid,
 * not the value. A score the user might dispute has to be readable exactly.
 */
export function ScoreBar({ value, tone = "accent" }: { value: number; tone?: Tone }) {
  const fill: Record<Tone, string> = {
    neutral: "bg-fg-subtle",
    ok: "bg-ok",
    warn: "bg-warn",
    danger: "bg-danger",
    accent: "bg-accent",
  };
  const clamped = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        role="meter"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
        className="inline-block h-1 w-10 overflow-hidden rounded-full bg-border"
      >
        <span className={cx("block h-full rounded-full", fill[tone])} style={{ width: `${clamped}%` }} />
      </span>
      <span className="tabular text-sm text-fg-muted">{clamped}</span>
    </span>
  );
}

export function Tag({ children, onRemove }: { children: ReactNode; onRemove?: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-sm border border-border bg-surface-hover px-1.5 py-px text-sm text-fg-muted">
      {children}
      {onRemove}
    </span>
  );
}

/**
 * The unified timeline.
 *
 * Every channel renders through this component, which is the point: one
 * chronological story per prospect rather than an email log beside a call log.
 */
export function Timeline({ children }: { children: ReactNode }) {
  return <ol className="relative">{children}</ol>;
}

export function TimelineItem({
  tone = "neutral",
  title,
  meta,
  children,
  last,
}: {
  tone?: Tone;
  title: ReactNode;
  meta?: ReactNode;
  children?: ReactNode;
  last?: boolean;
}) {
  return (
    <li className="relative flex gap-3 px-4">
      <div className="flex flex-col items-center pt-2">
        <StatusDot tone={tone} />
        {!last ? <span className="mt-1 w-px flex-1 bg-border" /> : null}
      </div>
      <div className={cx("min-w-0 flex-1 pt-1.5", last ? "pb-3" : "pb-4")}>
        <div className="flex items-baseline justify-between gap-3">
          <p className="min-w-0 text-base text-fg">{title}</p>
          {meta ? <span className="shrink-0 text-xs text-fg-subtle tabular">{meta}</span> : null}
        </div>
        {children ? <div className="mt-1 text-sm text-fg-muted">{children}</div> : null}
      </div>
    </li>
  );
}

/**
 * Pagination.
 *
 * Offset links rather than infinite scroll: a list you cannot get back to the
 * same place in is not a work surface.
 */
export function Pager({
  basePath,
  page,
  pageSize,
  total,
  query,
}: {
  basePath: string;
  page: number;
  pageSize: number;
  total: number;
  query?: Record<string, string | undefined>;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;

  const href = (p: number) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query ?? {})) if (v) params.set(k, v);
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };

  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <div className="flex items-center justify-between gap-4 border-t border-border px-6 py-2">
      <p className="text-sm text-fg-subtle tabular">
        {from}–{to} of {total}
      </p>
      <div className="flex items-center gap-1">
        {page > 1 ? (
          <Link
            href={href(page - 1)}
            className="motion-ok rounded border border-border-strong px-2 py-0.5 text-sm text-fg-muted hover:bg-surface-hover hover:text-fg"
          >
            Previous
          </Link>
        ) : (
          <span className="rounded border border-border px-2 py-0.5 text-sm text-fg-subtle">
            Previous
          </span>
        )}
        {page < pages ? (
          <Link
            href={href(page + 1)}
            className="motion-ok rounded border border-border-strong px-2 py-0.5 text-sm text-fg-muted hover:bg-surface-hover hover:text-fg"
          >
            Next
          </Link>
        ) : (
          <span className="rounded border border-border px-2 py-0.5 text-sm text-fg-subtle">Next</span>
        )}
      </div>
    </div>
  );
}

/**
 * A screen whose backend has not shipped yet.
 *
 * Deliberately explicit rather than a plausible-looking empty table. Showing a
 * dashboard of zeroes for a feature that does not exist is indistinguishable
 * from a feature that exists and is idle, and the difference matters.
 */
export function NotBuiltYet({ what, phase }: { what: string; phase: string }) {
  return (
    <div className="px-6 py-8">
      <div className="max-w-lg rounded-md border border-border bg-surface px-4 py-3">
        <p className="text-base font-medium text-fg">{what} is not wired up yet.</p>
        <p className="mt-1 text-sm text-fg-muted">
          This screen is real and reads live data — there is simply nothing behind it to read.
          It arrives in {phase}. Nothing here is placeholder content, and no number on this page is
          invented.
        </p>
      </div>
    </div>
  );
}
