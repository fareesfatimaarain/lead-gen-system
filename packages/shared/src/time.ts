/**
 * Prospect-local time arithmetic.
 *
 * Ported and extended from the legacy MVP's `lib/schedule.js`. The original
 * `Intl.DateTimeFormat` approach was correct — including the past-midnight wrap —
 * so it carries over. What is new is that every window here is evaluated in the
 * *prospect's* timezone, not the campaign's. That is the §6 guardrail: a prospect
 * in Karachi is never called at 3am because the customer is in London.
 *
 * All stored timestamps are UTC. Nothing in the database is pre-localized.
 */

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface LocalParts {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number; // 0-23
  minute: number;
  weekday: Weekday; // 0 = Sunday
}

const WEEKDAY_INDEX: Record<string, Weekday> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/**
 * Decompose an instant into wall-clock parts in the given IANA zone.
 * Falls back to UTC on an unknown zone rather than throwing — a bad timezone
 * string from an enrichment provider must not take down the orchestrator. The
 * caller decides whether an unknown zone should block sending.
 */
export function localParts(instant: Date, timeZone: string): LocalParts {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
      hour12: false,
    }).formatToParts(instant);
  } catch {
    return localParts(instant, "UTC");
  }

  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? "0";

  // Intl renders midnight as "24" under hour12:false in some ICU versions.
  const hour = parseInt(get("hour"), 10) % 24;

  return {
    year: parseInt(get("year"), 10),
    month: parseInt(get("month"), 10),
    day: parseInt(get("day"), 10),
    hour,
    minute: parseInt(get("minute"), 10),
    weekday: WEEKDAY_INDEX[get("weekday")] ?? 0,
  };
}

export function localHour(instant: Date, timeZone: string): number {
  return localParts(instant, timeZone).hour;
}

/** `2026-08-07` in the given zone. The key for per-day caps and "same day" checks. */
export function localDateKey(instant: Date, timeZone: string): string {
  const p = localParts(instant, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

export function isWeekend(instant: Date, timeZone: string): boolean {
  const d = localParts(instant, timeZone).weekday;
  return d === 0 || d === 6;
}

/**
 * Is the instant inside [startHour, endHour) local time?
 * `start === end` means "always allowed" — carried over from the legacy
 * semantics so a 24h window stays expressible.
 */
export function isWithinHours(
  instant: Date,
  timeZone: string,
  startHour: number,
  endHour: number,
): boolean {
  if (!Number.isFinite(startHour) || !Number.isFinite(endHour)) return true;
  if (startHour === endHour) return true;

  const hour = localHour(instant, timeZone);
  if (startHour < endHour) return hour >= startHour && hour < endHour;
  return hour >= startHour || hour < endHour; // wraps past midnight, e.g. 20 -> 6
}

/** Two instants on the same local calendar day. Backs "never call and email on the same day". */
export function isSameLocalDay(a: Date, b: Date, timeZone: string): boolean {
  return localDateKey(a, timeZone) === localDateKey(b, timeZone);
}

export function addDays(instant: Date, days: number): Date {
  return new Date(instant.getTime() + days * 86_400_000);
}

export function addMinutes(instant: Date, minutes: number): Date {
  return new Date(instant.getTime() + minutes * 60_000);
}

/**
 * A random interval in [minSeconds, maxSeconds]. Sends are never on a fixed
 * cadence — a perfectly regular send pattern is one of the clearest automation
 * signals a mailbox provider can read (§6).
 *
 * `rand` is injectable so the guardrail tests are deterministic.
 */
export function jitteredDelaySeconds(
  minSeconds: number,
  maxSeconds: number,
  rand: () => number = Math.random,
): number {
  if (maxSeconds <= minSeconds) return Math.max(0, minSeconds);
  // Clamped at the end, not just on the degenerate branch: a negative delay
  // would schedule a send in the past, which the queue would run immediately —
  // defeating the pacing this function exists to provide.
  return Math.max(0, Math.round(minSeconds + rand() * (maxSeconds - minSeconds)));
}
