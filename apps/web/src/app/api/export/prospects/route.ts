import { and, asc, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { schema, withOrg } from "@outreach/db";
import { AppError, isAppError, PROSPECT_STATUSES, toCsv } from "@outreach/shared";
import type { CsvColumn, ProspectStatus } from "@outreach/shared";
import { requireSession } from "@/lib/session";

/**
 * Prospect export.
 *
 * The counterpart to the CSV import in `sources/csv-actions.ts`, and the answer
 * to "can we get our data out?" — previously the honest answer was a database
 * dump, which is not something a customer can self-serve.
 *
 * Columns are declared explicitly rather than selected with `select()` and
 * spread. Two reasons, and the second is the important one:
 *
 *   - the export is an interface other people build spreadsheets against, so it
 *     should not reshape itself when a column is added to the table;
 *   - `prospects` accumulates internal bookkeeping (orchestrator cursors,
 *     denormalized counters, paused-by-human flags). Spreading the row would
 *     quietly publish each new one. An allow-list cannot leak a column nobody
 *     decided to publish.
 *
 * Round-trips with the importer: every column here that the importer recognizes
 * uses the header text the importer's alias table already maps.
 */

const MAX_ROWS = 50_000;

type ProspectRow = typeof schema.prospects.$inferSelect;

const COLUMNS: CsvColumn<ProspectRow>[] = [
  { header: "First Name", value: (p) => p.firstName },
  { header: "Last Name", value: (p) => p.lastName },
  { header: "Full Name", value: (p) => p.fullName },
  { header: "Title", value: (p) => p.title },
  { header: "Seniority", value: (p) => p.seniority },
  { header: "Department", value: (p) => p.department },
  { header: "Email", value: (p) => p.email },
  { header: "Email Verification", value: (p) => p.emailVerification },
  { header: "Email Source", value: (p) => p.emailSource },
  { header: "Phone", value: (p) => p.phone },
  { header: "Phone Type", value: (p) => p.phoneType },
  { header: "LinkedIn URL", value: (p) => p.linkedinUrl },
  { header: "City", value: (p) => p.city },
  { header: "Country", value: (p) => p.country },
  { header: "Timezone", value: (p) => p.timezone },
  { header: "Status", value: (p) => p.status },
  { header: "Status Reason", value: (p) => p.statusReason },
  { header: "Emails Sent", value: (p) => p.emailsSentCount },
  { header: "Calls Placed", value: (p) => p.callsPlacedCount },
  { header: "Last Contacted At", value: (p) => p.lastContactedAt },
  { header: "Source", value: (p) => p.source },
  { header: "Source URL", value: (p) => p.sourceUrl },
  { header: "Discovered At", value: (p) => p.discoveredAt },
];

function parseStatuses(raw: string | null): ProspectStatus[] | null {
  if (!raw) return null;
  const wanted = raw.split(",").map((s) => s.trim()).filter(Boolean);
  const invalid = wanted.filter((s) => !(PROSPECT_STATUSES as readonly string[]).includes(s));
  if (invalid.length > 0) {
    throw new AppError(
      "validation_failed",
      `Unknown status: ${invalid.join(", ")}. Valid values are ${PROSPECT_STATUSES.join(", ")}.`,
    );
  }
  return wanted as ProspectStatus[];
}

export async function GET(request: Request) {
  try {
    // Read is deliberate: exporting is reading. A viewer who can already see
    // these prospects on screen gains nothing by being blocked from a file of
    // what they are looking at.
    const session = await requireSession();
    const url = new URL(request.url);
    const statuses = parseStatuses(url.searchParams.get("status"));
    const campaignId = url.searchParams.get("campaignId");

    const rows = await withOrg({ orgId: session.orgId, userId: session.userId }, async (tx) => {
      const filters = [eq(schema.prospects.orgId, session.orgId)];
      if (statuses && statuses.length > 0) filters.push(inArray(schema.prospects.status, statuses));
      if (campaignId) filters.push(eq(schema.prospects.campaignId, campaignId));

      const found = await tx
        .select()
        .from(schema.prospects)
        .where(and(...filters))
        .orderBy(asc(schema.prospects.discoveredAt))
        .limit(MAX_ROWS);

      // Exporting contact data is exactly the event a regulator or a customer
      // asks about after the fact, so it is audited like credential access —
      // who, when, how many rows, under what filter.
      await tx.insert(schema.auditLog).values({
        orgId: session.orgId,
        userId: session.userId,
        action: "prospects.export",
        entity: "prospects",
        after: {
          rows: found.length,
          statuses: statuses ?? "all",
          campaignId: campaignId ?? "all",
          truncated: found.length === MAX_ROWS,
        },
      });

      return found;
    });

    const stamp = new Date().toISOString().slice(0, 10);
    return new NextResponse(toCsv(rows, COLUMNS), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="prospects-${stamp}.csv"`,
        // The file is a snapshot of live data; a cached copy would be wrong the
        // moment anything changes, and it contains personal data besides.
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    if (isAppError(err)) {
      return NextResponse.json(err.toJSON(), { status: err.status });
    }
    console.error("Prospect export failed:", err);
    return NextResponse.json(
      new AppError("internal", "The export failed. The error has been logged.").toJSON(),
      { status: 500 },
    );
  }
}
