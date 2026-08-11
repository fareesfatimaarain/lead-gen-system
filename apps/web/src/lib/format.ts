/**
 * Display formatting.
 *
 * Everything here is deterministic given its input. Nothing reads the clock at
 * render time except `since()`, which takes the reference instant as an
 * argument — a component that formats "3 minutes ago" from `Date.now()` renders
 * differently on the server than on the client and produces a hydration
 * mismatch on every page that shows a timestamp.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** `7 Aug` for this year, `7 Aug 2024` otherwise. */
export function formatDate(value: Date | string | null | undefined, now = new Date()): string {
  const d = toDate(value);
  if (!d) return "—";
  const sameYear = d.getFullYear() === now.getFullYear();
  const base = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return sameYear ? base : `${base} ${d.getFullYear()}`;
}

/** `7 Aug, 14:32`. Used wherever the time of day carries meaning. */
export function formatDateTime(value: Date | string | null | undefined, now = new Date()): string {
  const d = toDate(value);
  if (!d) return "—";
  return `${formatDate(d, now)}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Compact elapsed time: `4m`, `3h`, `2d`, `5w`. */
export function since(value: Date | string | null | undefined, now: Date | number = Date.now()): string {
  const d = toDate(value);
  if (!d) return "—";
  const seconds = Math.floor((Number(now) - d.getTime()) / 1000);
  if (seconds < 0) return "in " + since(new Date(Number(now) * 2 - d.getTime()), now);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days}d`;
  const weeks = Math.floor(days / 7);
  if (weeks < 9) return `${weeks}w`;
  const months = Math.floor(days / 30);
  if (months < 24) return `${months}mo`;
  return `${Math.floor(days / 365)}y`;
}

/** Seconds as `1:04`. Call durations, nothing else. */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "—";
  const m = Math.floor(seconds / 60);
  return `${m}:${pad(Math.floor(seconds % 60))}`;
}

/**
 * Money.
 *
 * Costs in this system are frequently fractions of a cent, and rounding them to
 * `$0.00` makes per-run cost unreadable. Small values keep four decimals.
 */
export function formatUsd(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return "—";
  if (n === 0) return "$0";
  if (Math.abs(n) < 0.01) return `$${n.toFixed(4)}`;
  if (Math.abs(n) < 1000) return `$${n.toFixed(2)}`;
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

export function formatNumber(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US");
}

export function formatPercent(value: number | string | null | undefined, digits = 1): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return "—";
  return `${n.toFixed(digits)}%`;
}

/** `needs_review` -> `Needs review`. Enum values are shown to users constantly. */
export function humanize(value: string | null | undefined): string {
  if (!value) return "—";
  const spaced = value.replace(/[_-]+/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function initials(name: string | null | undefined, fallback = "?"): string {
  if (!name?.trim()) return fallback;
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || fallback;
}

/** Trim to a word boundary rather than mid-word. */
export function truncate(text: string | null | undefined, max: number): string {
  if (!text) return "";
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut}…`;
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}
