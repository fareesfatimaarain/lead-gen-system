import { NextResponse } from "next/server";
import { db, sql } from "@outreach/db";

/**
 * Liveness and readiness for load balancers and container orchestrators.
 *
 * The check is a real query, not a bare 200. A process that is running but
 * cannot reach Postgres serves an error on every page, so reporting it healthy
 * would keep a broken instance in rotation — which is the one outcome a health
 * check exists to prevent.
 *
 * The query is deliberately trivial. Anything heavier turns the health check
 * into load of its own, and at one request per second per instance that adds up.
 */

// Never cached or prerendered: a health check answering from a build-time
// snapshot reports the state of the build, not of this process.
export const dynamic = "force-dynamic";
export const revalidate = 0;

const startedAt = Date.now();

export async function GET() {
  const began = Date.now();
  try {
    await db().execute(sql`SELECT 1`);
  } catch (err) {
    // Logged in full, reported as a bare "unreachable": this endpoint is
    // unauthenticated, and a driver error names the host, port and role.
    console.error("[health] database check failed:", err);
    return NextResponse.json(
      { status: "unhealthy", database: "unreachable" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }

  return NextResponse.json(
    {
      status: "ok",
      database: "ok",
      databaseLatencyMs: Date.now() - began,
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
