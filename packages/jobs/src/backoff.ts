/**
 * Retry backoff.
 *
 * Pure and clock-free so it can be tested exhaustively — this is the function
 * that decides how hard we hammer a provider that is already struggling, and a
 * bug here turns one failing job into a self-inflicted rate limit.
 */

export interface BackoffOptions {
  /** Delay after the first failure. */
  baseSeconds?: number;
  /** Never wait longer than this, regardless of attempt count. */
  maxSeconds?: number;
  /** Fraction of the delay to randomize, 0-1. Prevents a thundering herd. */
  jitter?: number;
}

const DEFAULTS: Required<BackoffOptions> = {
  baseSeconds: 30,
  maxSeconds: 3600,
  jitter: 0.25,
};

/**
 * Exponential backoff with jitter.
 *
 * `attempt` is 1-based: the delay returned for attempt 1 is the wait before
 * attempt 2 runs.
 */
export function backoffSeconds(
  attempt: number,
  options: BackoffOptions = {},
  rand: () => number = Math.random,
): number {
  const { baseSeconds, maxSeconds, jitter } = { ...DEFAULTS, ...options };
  const safeAttempt = Math.max(1, Math.floor(attempt));

  // Cap the exponent before computing the power. 2 ** 1024 is Infinity, and
  // Infinity * anything downstream is NaN, which would be stored as a run_at.
  const exponent = Math.min(safeAttempt - 1, 20);
  const raw = Math.min(baseSeconds * 2 ** exponent, maxSeconds);

  // Jitter is subtractive only, so a delay never exceeds the cap the caller set.
  const spread = raw * Math.min(Math.max(jitter, 0), 1);
  return Math.max(1, Math.round(raw - rand() * spread));
}
