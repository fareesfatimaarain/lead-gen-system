/**
 * Error taxonomy shared by API routes, adapters, and the worker.
 *
 * Every error a user can see carries a `userMessage`: what happened and how to
 * fix it. No apologies, no stack traces, no "something went wrong".
 */

export type ErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "validation_failed"
  | "conflict"
  | "provider_error"
  | "provider_unconfigured"
  | "rate_limited"
  | "guardrail_blocked"
  | "spend_cap_exceeded"
  | "internal";

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  validation_failed: 422,
  conflict: 409,
  provider_error: 502,
  provider_unconfigured: 400,
  rate_limited: 429,
  guardrail_blocked: 409,
  spend_cap_exceeded: 402,
  internal: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly userMessage: string;
  readonly details?: unknown;

  constructor(code: ErrorCode, userMessage: string, options?: { cause?: unknown; details?: unknown }) {
    super(userMessage, options?.cause ? { cause: options.cause } : undefined);
    this.name = "AppError";
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.userMessage = userMessage;
    this.details = options?.details;
  }

  toJSON() {
    return { error: { code: this.code, message: this.userMessage, details: this.details } };
  }
}

export const unauthenticated = (m = "Sign in to continue.") => new AppError("unauthenticated", m);
export const forbidden = (m = "Your role does not allow this.") => new AppError("forbidden", m);
export const notFound = (what: string) => new AppError("not_found", `${what} not found.`);
export const conflict = (m: string) => new AppError("conflict", m);
export const validationFailed = (m: string, details?: unknown) =>
  new AppError("validation_failed", m, { details });

/**
 * A provider call failed. `provider` and `hint` are surfaced verbatim in the
 * Connections page, so the hint must be actionable — name the setting to change,
 * not the exception that was thrown.
 */
export function providerError(provider: string, hint: string, cause?: unknown): AppError {
  return new AppError("provider_error", hint, { cause, details: { provider } });
}

export function providerUnconfigured(provider: string): AppError {
  return new AppError(
    "provider_unconfigured",
    `No ${provider} credential is connected. Add one on the Connections page.`,
    { details: { provider } },
  );
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}

/**
 * Codes that a retry cannot fix.
 *
 * Retrying a validation failure or a missing credential burns quota and delays
 * the moment a human notices. These go straight to dead-letter, where the
 * Operations screen surfaces them.
 */
const PERMANENT_CODES: readonly ErrorCode[] = [
  "validation_failed",
  "forbidden",
  "not_found",
  "provider_unconfigured",
  "guardrail_blocked",
  "spend_cap_exceeded",
];

export function isRetryable(e: unknown): boolean {
  if (isAppError(e)) return !PERMANENT_CODES.includes(e.code);
  // An unrecognized failure is assumed transient. A permanent one that retries
  // wastes five attempts; a transient one that does not retry loses the work.
  return true;
}

/** Narrow an unknown thrown value to a message without leaking internals. */
export function errorMessage(e: unknown): string {
  if (isAppError(e)) return e.userMessage;
  if (e instanceof Error) return e.message;
  return String(e);
}
