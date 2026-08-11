import "server-only";
import { NextResponse } from "next/server";
import { AppError, errorMessage, isAppError } from "@outreach/shared";

/**
 * Route handler helper.
 *
 * Turns a thrown AppError into its intended status and user-facing message, and
 * turns anything else into a generic 500 — an unexpected exception must never
 * leak a stack trace, a query, or a provider response to the client.
 */
export async function handle<T>(fn: () => Promise<T>): Promise<NextResponse> {
  try {
    return NextResponse.json((await fn()) ?? { ok: true });
  } catch (err) {
    if (isAppError(err)) {
      return NextResponse.json(err.toJSON(), { status: err.status });
    }
    console.error("Unhandled route error:", err);
    return NextResponse.json(
      new AppError("internal", "Something failed on the server. The error has been logged.").toJSON(),
      { status: 500 },
    );
  }
}

export function readJson<T>(request: Request): Promise<T> {
  return request.json().catch(() => {
    throw new AppError("validation_failed", "The request body was not valid JSON.");
  }) as Promise<T>;
}

export { errorMessage };
