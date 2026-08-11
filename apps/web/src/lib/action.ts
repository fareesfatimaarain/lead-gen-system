import "server-only";
import { errorMessage, forbidden, isAppError } from "@outreach/shared";
import type { Capability } from "@outreach/shared";
import { can } from "@outreach/shared";
import { getSession } from "./session";
import type { SessionContext } from "./session";
import type { ActionState } from "./action-state";

/**
 * Server action plumbing.
 *
 * Actions return a result object rather than throwing, because a thrown error in
 * a form submission blows away the page and the user's typing with it. The one
 * thing that never becomes a friendly message is an unexpected exception: those
 * are logged server-side and reported generically, so a stack trace or a
 * provider response can never reach the browser.
 */

export { IDLE } from "./action-state";
export type { ActionState } from "./action-state";

/**
 * Wrap an action body with authentication, a capability check, and error
 * translation. The capability is checked here rather than in the UI: a hidden
 * button is not an authorization control.
 */
export async function action(
  capability: Capability,
  fn: (session: SessionContext) => Promise<ActionState | void>,
): Promise<ActionState> {
  try {
    const session = await getSession();
    if (!session) return { error: "Your session expired. Sign in again." };
    if (!can(session.role, capability)) {
      throw forbidden(
        `This action needs a role above ${session.role}. Ask an owner of ${session.orgName} to make the change.`,
      );
    }
    return (await fn(session)) ?? { ok: true };
  } catch (err) {
    if (isAppError(err)) return { error: errorMessage(err) };
    console.error("Server action failed:", err);
    return { error: "Something failed on the server. The error has been logged." };
  }
}

// ---------------------------------------------------------------------------
// FormData readers
// ---------------------------------------------------------------------------

export function str(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export function optionalStr(form: FormData, key: string): string | null {
  return str(form, key) || null;
}

/** Repeated form entries, deduplicated and emptied out. Used by every TagInput. */
export function list(form: FormData, key: string): string[] {
  const seen = new Set<string>();
  for (const raw of form.getAll(key)) {
    if (typeof raw !== "string") continue;
    const value = raw.trim();
    if (value) seen.add(value);
  }
  return [...seen];
}

export function bool(form: FormData, key: string): boolean {
  return form.get(key) === "on" || form.get(key) === "true";
}

/**
 * A bounded integer.
 *
 * Bounds are mandatory rather than optional: every numeric field on the settings
 * screen is a guardrail threshold, and an unbounded one submitted as 100000 is
 * the same as no guardrail at all.
 */
export function int(form: FormData, key: string, min: number, max: number, fallback: number): number {
  const raw = Number(str(form, key));
  if (!Number.isFinite(raw)) return fallback;
  return Math.min(Math.max(Math.round(raw), min), max);
}

export function decimal(form: FormData, key: string, min: number, max: number, fallback: string): string {
  const raw = Number(str(form, key));
  if (!Number.isFinite(raw)) return fallback;
  return String(Math.min(Math.max(raw, min), max));
}
