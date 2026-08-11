"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { Button, cx, Kbd } from "./ui";
import type { Tone } from "./ui";

/**
 * The interactive half of the kit.
 *
 * Split from `ui.tsx` so that a server component rendering a table does not drag
 * a dialog implementation into the client bundle. Everything here obeys the same
 * motion budget: 120ms on hover and press, ≤150ms on overlay enter, nothing else.
 */

// ---------------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------------

/**
 * A submit button that knows its own form is in flight.
 *
 * The pending state is the label changing and the control disabling — not a
 * spinner. A double-submitted form here means a duplicate outbound action, so
 * disabling is a correctness measure, not a polish one.
 */
export function SubmitButton({
  children,
  pendingLabel,
  variant = "primary",
  size = "md",
  className,
}: {
  children: React.ReactNode;
  pendingLabel?: string;
  variant?: "primary" | "default" | "ghost" | "danger";
  size?: "sm" | "md";
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} size={size} disabled={pending} className={className}>
      {pending ? (pendingLabel ?? children) : children}
    </Button>
  );
}

/**
 * Destructive submit with an inline confirm.
 *
 * The confirmation replaces the button in place rather than opening a modal —
 * a modal for "are you sure" is a dialog nobody reads. Anything that removes a
 * suppression or deletes a credential goes through this.
 */
export function ConfirmSubmit({
  children,
  confirmLabel = "Confirm",
  className,
}: {
  children: React.ReactNode;
  confirmLabel?: string;
  className?: string;
}) {
  const [armed, setArmed] = useState(false);
  const { pending } = useFormStatus();

  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);

  if (!armed) {
    return (
      <Button type="button" variant="ghost" size="sm" className={className} onClick={() => setArmed(true)}>
        {children}
      </Button>
    );
  }
  return (
    <Button type="submit" variant="danger" size="sm" disabled={pending} className={className}>
      {pending ? "Working…" : confirmLabel}
    </Button>
  );
}

/**
 * A list of free-text values as removable chips.
 *
 * ICP fields are almost all string arrays — industries, titles, excluded
 * domains. They post as repeated `name` entries so the server action reads them
 * with `formData.getAll(name)` and never has to parse a delimiter out of a value
 * that might legitimately contain one.
 */
export function TagInput({
  name,
  defaultValue = [],
  placeholder,
  transform,
}: {
  name: string;
  defaultValue?: string[];
  placeholder?: string;
  /** e.g. lowercasing a domain before it is stored. */
  transform?: (value: string) => string;
}) {
  const [values, setValues] = useState<string[]>(defaultValue);
  const [draft, setDraft] = useState("");

  const add = (raw: string) => {
    const cleaned = (transform ? transform(raw) : raw).trim();
    if (!cleaned) return;
    setValues((v) => (v.includes(cleaned) ? v : [...v, cleaned]));
    setDraft("");
  };

  return (
    <div className="motion-ok flex flex-wrap items-center gap-1 rounded border border-border-strong bg-surface p-1 focus-within:border-accent">
      {values.map((v) => (
        <span
          key={v}
          className="inline-flex items-center gap-1 rounded-sm bg-surface-hover px-1.5 py-0.5 text-sm text-fg"
        >
          {v}
          <input type="hidden" name={name} value={v} />
          <button
            type="button"
            aria-label={`Remove ${v}`}
            onClick={() => setValues((all) => all.filter((x) => x !== v))}
            className="motion-ok text-fg-subtle hover:text-danger"
          >
            ×
          </button>
        </span>
      ))}
      <input
        value={draft}
        placeholder={values.length === 0 ? placeholder : ""}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => add(draft)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            add(draft);
          } else if (e.key === "Backspace" && draft === "") {
            setValues((v) => v.slice(0, -1));
          }
        }}
        className="h-5 min-w-24 flex-1 bg-transparent px-1 text-base text-fg outline-none placeholder:text-fg-subtle"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

/**
 * Filters that live in the URL.
 *
 * State goes in the query string rather than component state so a filtered list
 * is linkable and survives a refresh — "the 12 prospects that failed
 * verification" has to be something you can paste to a colleague.
 */
function useQueryUpdater() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const update = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params?.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined || value === "") next.delete(key);
      else next.set(key, value);
    }
    // Any filter change invalidates the offset — page 4 of a different result set
    // is a different, meaningless page.
    if (!("page" in patch)) next.delete("page");
    const qs = next.toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  };

  return { update, pending, params };
}

export function SearchInput({ placeholder = "Search…", paramName = "q" }: { placeholder?: string; paramName?: string }) {
  const { update, params } = useQueryUpdater();
  const [value, setValue] = useState(params?.get(paramName) ?? "");
  const ref = useRef<HTMLInputElement>(null);

  // Debounced, because each keystroke is a server round trip and a database query.
  useEffect(() => {
    const current = params?.get(paramName) ?? "";
    if (value === current) return;
    const t = setTimeout(() => update({ [paramName]: value || undefined }), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // `/` focuses search from anywhere on the page, unless the user is already typing.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const typing = target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
      if (e.key === "/" && !typing) {
        e.preventDefault();
        ref.current?.focus();
      }
      if (e.key === "Escape" && document.activeElement === ref.current) ref.current?.blur();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="relative flex items-center">
      <input
        ref={ref}
        value={value}
        placeholder={placeholder}
        onChange={(e) => setValue(e.target.value)}
        className="motion-ok h-7 w-56 rounded border border-border-strong bg-surface pl-2 pr-8 text-base text-fg outline-none placeholder:text-fg-subtle hover:border-fg-subtle focus:border-accent"
      />
      <span className="pointer-events-none absolute right-1.5">
        <Kbd>/</Kbd>
      </span>
    </div>
  );
}

export function FilterSelect({
  paramName,
  label,
  options,
}: {
  paramName: string;
  label: string;
  options: { value: string; label: string }[];
}) {
  const { update, params } = useQueryUpdater();
  const current = params?.get(paramName) ?? "";
  return (
    <select
      value={current}
      onChange={(e) => update({ [paramName]: e.target.value || undefined })}
      className={cx(
        "motion-ok h-7 cursor-pointer rounded border bg-surface px-2 text-base outline-none hover:border-fg-subtle",
        current ? "border-accent text-fg" : "border-border-strong text-fg-muted",
      )}
    >
      <option value="">{label}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** Shows only when a filter is set, so the user always has a way back to everything. */
export function ClearFilters({ keys }: { keys: string[] }) {
  const { update, params } = useQueryUpdater();
  const active = keys.filter((k) => params?.get(k));
  if (active.length === 0) return null;
  return (
    <button
      type="button"
      onClick={() => update(Object.fromEntries(keys.map((k) => [k, undefined])))}
      className="motion-ok text-sm text-fg-subtle hover:text-fg"
    >
      Clear {active.length === 1 ? "filter" : "filters"}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

/** Tabs as links, so each pane is its own URL and the back button works. */
export function TabLinks({ tabs, current }: { tabs: { href: string; label: string; count?: number }[]; current: string }) {
  return (
    <div className="flex items-center gap-1 border-b border-border px-6">
      {tabs.map((t) => {
        const active = t.href === current;
        return (
          <Link
            key={t.href}
            href={t.href}
            prefetch
            className={cx(
              "motion-ok -mb-px flex h-8 items-center gap-1.5 border-b-2 px-2 text-base",
              active
                ? "border-fg font-medium text-fg"
                : "border-transparent text-fg-muted hover:text-fg",
            )}
          >
            {t.label}
            {t.count !== undefined ? (
              <span className="tabular text-xs text-fg-subtle">{t.count}</span>
            ) : null}
          </Link>
        );
      })}
    </div>
  );
}

/**
 * Client-side tabs, for panes that are cheap enough to render together and
 * would otherwise cost a round trip — a transcript beside its raw payload.
 */
export function Tabs({ tabs }: { tabs: { id: string; label: string; content: React.ReactNode }[] }) {
  const [active, setActive] = useState(tabs[0]?.id);
  return (
    <div>
      <div className="flex items-center gap-1 border-b border-border px-4">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setActive(t.id)}
            className={cx(
              "motion-ok -mb-px flex h-8 items-center border-b-2 px-2 text-base",
              t.id === active ? "border-fg font-medium text-fg" : "border-transparent text-fg-muted hover:text-fg",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div>{tabs.find((t) => t.id === active)?.content}</div>
    </div>
  );
}

/**
 * j/k row navigation with Enter to open.
 *
 * The inbox and the approval queue are triage surfaces: they have to be workable
 * without a mouse or the reviewing never happens, and the approval habit is what
 * the auto-send gate is counting.
 */
export function ListKeyboardNav({ hrefs }: { hrefs: string[] }) {
  const router = useRouter();
  const [cursor, setCursor] = useState(-1);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (hrefs.length === 0) return;

      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        setCursor((c) => Math.min(c + 1, hrefs.length - 1));
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        setCursor((c) => Math.max(c - 1, 0));
      } else if (e.key === "Enter" && cursor >= 0) {
        const href = hrefs[cursor];
        if (href) router.push(href);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hrefs, cursor, router]);

  // Highlighting is done by the effect below rather than by re-rendering the
  // table: the rows are server-rendered, and re-rendering them on every keypress
  // would mean shipping the whole list to the client for a background colour.
  useEffect(() => {
    const rows = document.querySelectorAll<HTMLElement>("[data-row-index]");
    rows.forEach((row) => {
      const isActive = Number(row.dataset.rowIndex) === cursor;
      row.classList.toggle("bg-surface-hover", isActive);
      if (isActive) row.scrollIntoView({ block: "nearest" });
    });
  }, [cursor]);

  return null;
}

// ---------------------------------------------------------------------------
// Overlays and feedback
// ---------------------------------------------------------------------------

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/25 p-4 pt-[10vh]"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-lg border border-border bg-surface-raised shadow-overlay"
      >
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-md font-medium text-fg">{title}</h2>
          {description ? <p className="mt-0.5 text-sm text-fg-muted">{description}</p> : null}
        </div>
        <div className="px-4 py-3">{children}</div>
        {footer ? (
          <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-2.5">{footer}</div>
        ) : null}
      </div>
    </div>
  );
}

export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // Clipboard access denied. Silent — the value is selectable on screen.
        }
      }}
      className="motion-ok text-sm text-fg-subtle hover:text-fg"
    >
      {copied ? "Copied" : label}
    </button>
  );
}

/**
 * Inline result of a server action.
 *
 * Not a toast that floats away: the outcome of "test this connection" or "save
 * these thresholds" stays on screen next to the thing it describes until the
 * user does something else.
 */
export function ActionResult({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  const styles: Record<Tone, string> = {
    neutral: "text-fg-muted",
    ok: "text-ok",
    warn: "text-warn",
    danger: "text-danger",
    accent: "text-accent",
  };
  if (!children) return null;
  return <p className={cx("text-sm", styles[tone])}>{children}</p>;
}
