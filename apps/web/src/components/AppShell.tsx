"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { cx, Kbd } from "./ui";

/**
 * The application shell.
 *
 * Navigation is prefetched on hover and renders instantly — there is no route
 * transition, no fade, and no spinner between screens. Perceived instant
 * navigation is a quality bar for this build, not a nice-to-have.
 */

export interface NavItem {
  href: string;
  label: string;
  ready: boolean;
  hint?: string;
  /** Key into the counts the server passes down. Only rendered when non-zero. */
  badge?: "approvals" | "inbox";
}

/**
 * The whole product, in the order the work actually happens: define who you are
 * going after, find them, review what will be said, then handle what comes back.
 * Operations is last because on a healthy day nobody opens it.
 */
export const NAV: { section: string; items: NavItem[] }[] = [
  {
    section: "Overview",
    items: [{ href: "/", label: "Dashboard", ready: true }],
  },
  {
    section: "Audience",
    items: [
      { href: "/icp", label: "ICP", ready: true },
      { href: "/sources", label: "Sources", ready: true },
      { href: "/discovery", label: "Discovery", ready: true },
      { href: "/prospects", label: "Prospects", ready: true },
      { href: "/companies", label: "Companies", ready: true },
    ],
  },
  {
    section: "Outreach",
    items: [
      { href: "/campaigns", label: "Campaigns", ready: true },
      { href: "/sequences", label: "Sequences", ready: true },
      { href: "/approvals", label: "Approvals", ready: true, badge: "approvals" },
      { href: "/inbox", label: "Inbox", ready: true, badge: "inbox" },
      { href: "/calls", label: "Calls", ready: true },
      { href: "/calls/demo", label: "Test Call", ready: true },
    ],
  },
  {
    section: "Deliverability",
    items: [
      { href: "/mailboxes", label: "Mailboxes", ready: true },
      { href: "/health", label: "Sending health", ready: true },
      { href: "/suppressions", label: "Suppressions", ready: true },
    ],
  },
  {
    section: "Operations",
    items: [
      { href: "/jobs", label: "Jobs", ready: true },
      { href: "/agents", label: "Agent runs", ready: true },
      { href: "/spend", label: "Spend", ready: true },
      { href: "/activity", label: "Activity log", ready: true },
    ],
  },
  {
    section: "Workspace",
    items: [
      { href: "/connections", label: "Connections", ready: true },
      { href: "/settings", label: "Settings", ready: true },
    ],
  },
];

export interface NavCounts {
  approvals: number;
  inbox: number;
}

export function AppShell({
  orgName,
  userEmail,
  role,
  counts,
  children,
}: {
  orgName: string;
  userEmail: string;
  role: string;
  counts: NavCounts;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [paletteOpen, setPaletteOpen] = useState(false);

  // Cmd/Ctrl+K lives here rather than in the palette because the palette only
  // exists while it is open, and the shortcut has to work when it is not.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // `?` opens the shortcut sheet from anywhere. Keyboard-first only works if the
  // keys are discoverable without reading documentation.
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (e.key === "?") setShortcutsOpen((v) => !v);
      if (e.key === "Escape") setShortcutsOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="grid min-h-screen grid-cols-shell">
      <Sidebar
        orgName={orgName}
        userEmail={userEmail}
        role={role}
        counts={counts}
        pathname={pathname}
        onOpenPalette={() => setPaletteOpen(true)}
      />
      <main className="min-w-0 border-l border-border bg-bg">{children}</main>
      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} />}
      <ShortcutSheet open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </div>
  );
}

function Sidebar({
  orgName,
  userEmail,
  role,
  counts,
  pathname,
  onOpenPalette,
}: {
  orgName: string;
  userEmail: string;
  role: string;
  counts: NavCounts;
  pathname: string;
  onOpenPalette: () => void;
}) {
  return (
    <aside className="sticky top-0 flex h-screen flex-col bg-surface">
      <div className="flex h-11 items-center gap-2 px-3">
        <span className="grid size-5 place-items-center rounded-sm bg-fg text-2xs font-bold text-bg">O</span>
        <span className="truncate text-base font-medium text-fg">{orgName}</span>
      </div>

      <button
        type="button"
        onClick={onOpenPalette}
        className="motion-ok mx-3 mb-3 flex h-7 items-center justify-between rounded border border-border-strong px-2 text-sm text-fg-subtle hover:bg-surface-hover hover:text-fg-muted"
      >
        <span>Search</span>
        <Kbd>⌘K</Kbd>
      </button>

      <nav className="flex-1 overflow-y-auto px-2 pb-4">
        {NAV.map((group) => (
          <div key={group.section} className="mb-4">
            <p className="px-2 pb-1 text-2xs font-medium uppercase tracking-wider text-fg-subtle">
              {group.section}
            </p>
            {group.items.map((item) => {
              if (!item.ready) {
                return (
                  <span
                    key={item.href}
                    title={`Not built yet — ${item.hint}`}
                    className="flex items-center justify-between rounded px-2 text-base text-fg-subtle"
                    style={{ height: "26px" }}
                  >
                    {item.label}
                    <span className="text-2xs uppercase tracking-wider">{item.hint}</span>
                  </span>
                );
              }

              // Exact match for the dashboard, prefix for everything else, so a
              // detail page keeps its section highlighted.
              const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
              const badge = item.badge ? counts[item.badge] : 0;

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  prefetch
                  className={cx(
                    "motion-ok flex items-center justify-between gap-2 rounded px-2 text-base",
                    active
                      ? "bg-surface-hover font-medium text-fg"
                      : "text-fg-muted hover:bg-surface-hover hover:text-fg",
                  )}
                  style={{ height: "26px" }}
                >
                  <span className="truncate">{item.label}</span>
                  {badge > 0 ? (
                    <span className="tabular rounded-sm bg-accent-muted px-1 text-2xs font-medium text-accent">
                      {badge}
                    </span>
                  ) : null}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="border-t border-border p-3">
        <p className="truncate text-sm text-fg-muted">{userEmail}</p>
        <div className="mt-1 flex items-center justify-between">
          <span className="text-xs capitalize text-fg-subtle">{role}</span>
          <form action="/api/auth/sign-out" method="post">
            <button type="submit" className="motion-ok text-xs text-fg-subtle hover:text-fg">
              Sign out
            </button>
          </form>
        </div>
      </div>
    </aside>
  );
}

const SHORTCUTS: [string, string][] = [
  ["⌘K", "Command palette"],
  ["/", "Focus search on a list"],
  ["j / k", "Move down / up a list"],
  ["Enter", "Open the highlighted row"],
  ["?", "This sheet"],
  ["Esc", "Close anything open"],
];

function ShortcutSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xs overflow-hidden rounded-lg border border-border bg-surface-raised shadow-overlay"
      >
        <div className="border-b border-border px-4 py-2.5">
          <h2 className="text-sm font-medium text-fg">Keyboard shortcuts</h2>
        </div>
        <dl className="p-2">
          {SHORTCUTS.map(([key, label]) => (
            <div key={key} className="flex items-center justify-between gap-4 px-2 py-1">
              <dt className="text-base text-fg-muted">{label}</dt>
              <dd>
                <Kbd>{key}</Kbd>
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

/**
 * Command palette.
 *
 * Navigation only. Entity search would need a server round trip per keystroke,
 * and every list screen already has a `/`-focused search that queries the right
 * table with the right filters — a palette that returns a worse version of that
 * would be a second, wrong way to find a prospect.
 */
function CommandPalette({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);

  const commands = NAV.flatMap((g) => g.items)
    .filter((i) => i.ready)
    .filter((i) => i.label.toLowerCase().includes(query.toLowerCase()));

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const go = (href: string) => {
    onClose();
    router.push(href);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/25 pt-[12vh]"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-lg bg-surface-raised shadow-overlay"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          autoFocus
          value={query}
          placeholder="Go to…"
          onChange={(e) => {
            setQuery(e.target.value);
            setCursor(0);
          }}
          onKeyDown={(e) => {
            // j/k as well as arrows — the inbox has to be triageable without a mouse.
            if (e.key === "ArrowDown" || (e.ctrlKey && e.key === "j")) {
              e.preventDefault();
              setCursor((c) => Math.min(c + 1, commands.length - 1));
            } else if (e.key === "ArrowUp" || (e.ctrlKey && e.key === "k")) {
              e.preventDefault();
              setCursor((c) => Math.max(c - 1, 0));
            } else if (e.key === "Enter") {
              const target = commands[cursor];
              if (target) go(target.href);
            }
          }}
          className="h-10 w-full border-b border-border bg-transparent px-3 text-md text-fg outline-none"
        />
        <div className="max-h-72 overflow-y-auto p-1">
          {commands.length === 0 ? (
            <p className="px-2 py-3 text-sm text-fg-subtle">No matches.</p>
          ) : (
            commands.map((c, i) => (
              <button
                key={c.href}
                type="button"
                onMouseEnter={() => setCursor(i)}
                onClick={() => go(c.href)}
                className={cx(
                  "flex h-7 w-full items-center rounded px-2 text-left text-base",
                  i === cursor ? "bg-surface-hover text-fg" : "text-fg-muted",
                )}
              >
                {c.label}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
