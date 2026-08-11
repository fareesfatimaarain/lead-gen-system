import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "./client";

/**
 * Fixed-window rate limiting for pre-authentication endpoints.
 *
 * Sign-in and sign-up are the two routes an unauthenticated caller can reach in
 * a loop, which makes them where password guessing and account-creation floods
 * land. Everything past them is behind a session and covered by per-org
 * guardrails instead.
 *
 * A fixed window, not a token bucket: the failure mode of a fixed window is
 * allowing up to twice the limit across a window boundary, which for "stop
 * credential stuffing" is an acceptable margin, and it costs one statement
 * rather than the read-modify-write a bucket needs.
 */

export interface RateLimitResult {
  allowed: boolean;
  /** Attempts recorded in the current window, including this one. */
  attempts: number;
  /** Seconds until the window resets. Zero when allowed. */
  retryAfterSeconds: number;
}

export interface RateLimitOptions {
  /** Identifies the caller — an address, an email, or both. Hashed before storage. */
  key: string;
  /** Attempts permitted per window. */
  limit: number;
  windowSeconds: number;
}

/**
 * Hashed so the table holds no email addresses or IP addresses in the clear.
 * Callers namespace their own keys, which keeps two limiters from colliding on
 * the same subject.
 */
function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/**
 * Record an attempt and report whether it is permitted.
 *
 * The read-modify-write happens inside a single INSERT ... ON CONFLICT so two
 * concurrent requests cannot both observe "1 attempt" and both proceed. Rolling
 * the window is part of the same statement for the same reason.
 */
export async function consumeRateLimit(options: RateLimitOptions): Promise<RateLimitResult> {
  const { limit, windowSeconds } = options;
  const key = hashKey(options.key);
  // make_interval rather than string-built SQL: the window is a parameter, not
  // something spliced into the statement text.
  const window = sql`make_interval(secs => ${windowSeconds})`;

  const result = await db().execute(sql`
    INSERT INTO rate_limits (key, attempts, window_start)
    VALUES (${key}, 1, now())
    ON CONFLICT (key) DO UPDATE SET
      attempts = CASE
        WHEN rate_limits.window_start < now() - ${window} THEN 1
        ELSE rate_limits.attempts + 1
      END,
      window_start = CASE
        WHEN rate_limits.window_start < now() - ${window} THEN now()
        ELSE rate_limits.window_start
      END
    RETURNING
      attempts,
      CEIL(EXTRACT(EPOCH FROM (window_start + ${window}) - now()))::int AS reset_in
  `);

  const row = (result as unknown as { attempts: number; reset_in: number }[])[0];
  // No row can only mean the statement did not run. Failing open would let a
  // database hiccup silently remove the limit, so treat it as exhausted.
  if (!row) return { allowed: false, attempts: limit, retryAfterSeconds: windowSeconds };

  const attempts = Number(row.attempts);
  return attempts <= limit
    ? { allowed: true, attempts, retryAfterSeconds: 0 }
    : { allowed: false, attempts, retryAfterSeconds: Math.max(1, Number(row.reset_in)) };
}

/**
 * Drop a counter. Called after a successful sign-in, so a user who mistyped
 * their password four times is not left one attempt from a lockout.
 */
export async function clearRateLimit(key: string): Promise<void> {
  await db().execute(sql`DELETE FROM rate_limits WHERE key = ${hashKey(key)}`);
}

/**
 * Delete counters whose window has closed. Nothing reads an expired row — the
 * statement above rolls it in place — so this is housekeeping to stop the table
 * growing by one row per address ever seen.
 */
export async function pruneRateLimits(olderThanSeconds = 86_400): Promise<number> {
  const result = await db().execute(sql`
    DELETE FROM rate_limits
    WHERE window_start < now() - make_interval(secs => ${olderThanSeconds})
    RETURNING key
  `);
  return (result as unknown as unknown[]).length;
}
