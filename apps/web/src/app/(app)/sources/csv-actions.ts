"use server";

import { revalidatePath } from "next/cache";
import { schema, withOrg } from "@outreach/db";
import { ingestLead } from "@outreach/ingest";
import { applyMapping, mapProspectColumns, parseCsvToObjects, validationFailed } from "@outreach/shared";
import { action } from "@/lib/action";
import type { ActionState } from "@/lib/action";

/**
 * CSV lead import.
 *
 * The one lead source that needs no adapter and no credential — it creates
 * prospects directly, on upload, rather than being planned and run by a
 * discovery job. Every row still goes through the same gates a discovered
 * lead would: suppression check first, dedup against what is already in the
 * workspace, and a company record reused or created by domain. A CSV upload
 * is manual and reviewed by definition, so `MAX_ROWS` exists only to stop one
 * mis-pasted file from seeding thousands of unqualified prospects at once.
 */
const MAX_ROWS = 2000;
const MAX_BYTES = 5 * 1024 * 1024;

export async function importCsvAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return action("write", async (session) => {
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) {
      throw validationFailed("Choose a CSV file to upload.");
    }
    if (file.size > MAX_BYTES) {
      throw validationFailed("That file is larger than 5MB. Split it into smaller batches.");
    }

    const text = await file.text();
    const { headers, records } = parseCsvToObjects(text);
    if (headers.length === 0 || records.length === 0) {
      throw validationFailed("That file has no rows to import.");
    }
    if (records.length > MAX_ROWS) {
      throw validationFailed(`That file has ${records.length} rows. Import at most ${MAX_ROWS} at a time.`);
    }

    const mapping = mapProspectColumns(headers);
    if (!mapping.email) {
      throw validationFailed("No email column was recognized in this file. An email address is required for every prospect.");
    }

    let created = 0;
    let duplicate = 0;
    let suppressed = 0;
    let skipped = 0;

    await withOrg({ orgId: session.orgId, userId: session.userId }, async (tx) => {
      const seenInBatch = new Set<string>();

      for (const record of records) {
        const mapped = applyMapping(record, mapping);
        const email = mapped.email?.toLowerCase().trim();
        if (!email || !email.includes("@")) {
          skipped++;
          continue;
        }
        if (seenInBatch.has(email)) {
          duplicate++;
          continue;
        }
        seenInBatch.add(email);

        const outcome = await ingestLead(tx, {
          orgId: session.orgId,
          source: "csv_import",
          lead: { ...mapped, email, sourceUrl: `csv:${file.name}` },
        });

        if (outcome.kind === "suppressed") suppressed++;
        else if (outcome.kind === "duplicate_prospect") duplicate++;
        else if (outcome.kind === "prospect_created") created++;
      }

      // Reported through the same table every other source's runs report
      // through, so a CSV batch shows up next to Overpass and Hunter on the
      // ranking the strategist reads — one honest ledger, not a special case.
      await tx.insert(schema.sourcePerformance).values({
        orgId: session.orgId,
        source: "csv_import",
        query: file.name,
        leadsReturned: records.length,
        leadsNew: created,
        leadsQualified: 0,
        costUsd: "0",
      });

      // A batch import is an org-level event, not one prospect's story, so it
      // is recorded in the audit log rather than `activities` — that table's
      // `prospectId` is required precisely because it is a single prospect's
      // timeline, and one row per imported prospect here would just be noise.
      await tx.insert(schema.auditLog).values({
        orgId: session.orgId,
        userId: session.userId,
        action: "data_source.csv_import",
        entity: "prospects",
        after: { fileName: file.name, created, duplicate, suppressed, skipped, rows: records.length },
      });
    });

    revalidatePath("/sources");
    revalidatePath("/prospects");
    return {
      ok: true,
      message: `Imported ${created} new prospect${created === 1 ? "" : "s"}. ${duplicate} already existed, ${suppressed} were suppressed, ${skipped} had no usable email.`,
    };
  });
}
