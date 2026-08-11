"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq, schema, withOrg } from "@outreach/db";
import { enqueue, PRIORITY } from "@outreach/jobs";
import { notFound, validationFailed } from "@outreach/shared";
import { action, int, str } from "@/lib/action";
import type { ActionState } from "@/lib/action";

/**
 * Start a discovery run.
 *
 * The run row and the job that executes it are written in one transaction, so a
 * run can never exist with no work scheduled and a job can never point at a run
 * that was rolled back. That atomicity is the reason the queue lives in
 * Postgres rather than in Redis.
 */
export async function startDiscoveryRun(_prev: ActionState, form: FormData): Promise<ActionState> {
  let runId: string | undefined;

  const result = await action("write", async (session) => {
    const icpId = str(form, "icpId");
    if (!icpId) throw validationFailed("Choose an ICP to discover against.");

    // A hard ceiling the user sets before the run starts, not a target the
    // system may exceed. 500 is the upper bound on purpose: a run that returns
    // thousands of unreviewed prospects is how a workspace ends up sending to
    // people nobody ever looked at.
    const targetCount = int(form, "targetCount", 1, 500, 50);
    const campaignId = str(form, "campaignId") || null;

    await withOrg({ orgId: session.orgId, userId: session.userId }, async (tx) => {
      const [icp] = await tx
        .select({ id: schema.icps.id })
        .from(schema.icps)
        .where(eq(schema.icps.id, icpId))
        .limit(1);
      if (!icp) throw notFound("ICP");

      const [run] = await tx
        .insert(schema.discoveryRuns)
        .values({
          orgId: session.orgId,
          icpId,
          campaignId,
          targetCount,
          status: "planning",
          startedBy: session.userId,
        })
        .returning({ id: schema.discoveryRuns.id });

      runId = run!.id;

      await enqueue(tx, {
        orgId: session.orgId,
        queue: "discovery",
        name: "discovery.run",
        // Keyed on the run, so a double-submitted form produces one job.
        jobKey: `discovery:${run!.id}`,
        payload: { runId: run!.id, icpId, targetCount, campaignId },
        priority: PRIORITY.human,
      });

      // No `activities` row here: `activities.prospect_id` is NOT NULL and a
      // run-level event has no prospect. The discovery run row itself is the
      // audit record — status, who started it, counts, cost.
    });
  });

  if (result.error) return result;
  revalidatePath("/discovery");
  redirect(`/discovery/${runId}`);
}

export async function cancelDiscoveryRun(_prev: ActionState, form: FormData): Promise<ActionState> {
  const id = str(form, "id");

  const result = await action("write", async (session) => {
    await withOrg({ orgId: session.orgId, userId: session.userId }, async (tx) => {
      const updated = await tx
        .update(schema.discoveryRuns)
        .set({ status: "cancelled", finishedAt: new Date() })
        .where(eq(schema.discoveryRuns.id, id))
        .returning({ id: schema.discoveryRuns.id });
      if (updated.length === 0) throw notFound("Discovery run");

      // Cancel the job too. Marking only the run cancelled would leave a worker
      // happily discovering into a run nobody wants.
      await tx
        .update(schema.jobs)
        .set({ status: "cancelled", finishedAt: new Date(), updatedAt: new Date() })
        .where(eq(schema.jobs.jobKey, `discovery:${id}`));
    });

    return { ok: true, message: "Cancelled." };
  });

  if (!result.error) revalidatePath(`/discovery/${id}`);
  return result;
}
