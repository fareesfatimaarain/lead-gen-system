import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { consumeRateLimit, schema, withOrg } from "@outreach/db";
import { AppError, isAppError } from "@outreach/shared";
import { requireCapability } from "@/lib/session";
import { DEMO_BLOCKER_MESSAGE, demoReadiness, readDemoConfig } from "@/lib/vapi-demo";

/**
 * Credentials for an in-browser test call.
 *
 * Vapi issues two keys. The private key places outbound calls and lives
 * encrypted in `credentials.encrypted_value` — it must never reach a browser.
 * The public key is designed to be shipped to a client and can only start a web
 * call against an assistant you own. This route returns the public one and the
 * assistant id, and nothing else.
 *
 * That distinction is the whole security model of this endpoint, so it is
 * enforced by construction: the response is built from named fields off
 * `credentials.config`, never by spreading the row. `config` is the non-secret
 * half by design, but a spread would still publish every field anyone adds to
 * it later, and a future config field is exactly the kind of thing that gets
 * added without thinking about this file.
 */

/**
 * A browser call bills real Vapi minutes, and this endpoint is the thing that
 * makes one possible. Ten per hour per user is generous for demonstrating to a
 * prospect and low enough that a stuck retry loop cannot run up a bill.
 */
const DEMO_CALLS_PER_HOUR = 10;

export async function POST() {
  try {
    // `send` rather than `read`: this spends money and speaks to whoever answers.
    // A viewer may look at call history without being able to place calls.
    const session = await requireCapability("send");

    const limit = await consumeRateLimit({
      key: `vapi-demo-call:${session.userId}`,
      limit: DEMO_CALLS_PER_HOUR,
      windowSeconds: 3600,
    });
    if (!limit.allowed) {
      throw new AppError(
        "rate_limited",
        `That is ${DEMO_CALLS_PER_HOUR} test calls this hour. Try again in ${Math.ceil(limit.retryAfterSeconds / 60)} minute(s).`,
      );
    }

    const rows = await withOrg({ orgId: session.orgId, userId: session.userId }, (tx) =>
      tx
        .select({ config: schema.credentials.config, status: schema.credentials.status })
        .from(schema.credentials)
        .where(eq(schema.credentials.provider, "vapi"))
        .orderBy(desc(schema.credentials.lastVerifiedAt))
        .limit(1),
    );

    const row = rows[0];
    const { ready, blocker } = demoReadiness(row?.config ?? null);
    if (!ready && blocker) {
      throw new AppError("provider_unconfigured", DEMO_BLOCKER_MESSAGE[blocker]);
    }

    const { publicKey, assistantId } = readDemoConfig(row?.config);
    return NextResponse.json({ publicKey, assistantId, callsRemainingThisHour: DEMO_CALLS_PER_HOUR - limit.attempts });
  } catch (err) {
    if (isAppError(err)) {
      return NextResponse.json(err.toJSON(), { status: err.status });
    }
    console.error("Demo call session failed:", err);
    return NextResponse.json(
      new AppError("internal", "Could not start a test call. The error has been logged.").toJSON(),
      { status: 500 },
    );
  }
}
