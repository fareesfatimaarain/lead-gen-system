"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq, schema, withOrg } from "@outreach/db";
import { notFound, validationFailed } from "@outreach/shared";
import { action, str } from "@/lib/action";
import type { ActionState } from "@/lib/action";

export async function createSequenceAction(
  prevState: ActionState,
  form: FormData,
): Promise<ActionState> {
  return action("write", async (session) => {
    const name = str(form, "name");

    if (!name) throw validationFailed("Give this sequence a name.");

    const sequenceId = await withOrg({ orgId: session.orgId, userId: session.userId }, async (tx) => {
      const [newSeq] = await tx
        .insert(schema.sequences)
        .values({
          orgId: session.orgId,
          name,
        })
        .returning({ id: schema.sequences.id });

      if (!newSeq) throw new Error("Failed to create sequence");

      // Create initial step 1 (Email)
      await tx.insert(schema.sequenceSteps).values({
        orgId: session.orgId,
        sequenceId: newSeq.id,
        position: 1,
        type: "email",
        delayHours: 0,
      });

      return newSeq.id;
    });

    revalidatePath("/sequences");
    redirect(`/sequences/${sequenceId}`);
  });
}

export async function addSequenceStepAction(
  sequenceId: string,
  type: "email" | "call" | "wait" | "manual_task" | "branch",
  delayHours: number,
): Promise<ActionState> {
  return action("write", async (session) => {
    await withOrg({ orgId: session.orgId, userId: session.userId }, async (tx) => {
      const existing = await tx
        .select()
        .from(schema.sequenceSteps)
        .where(eq(schema.sequenceSteps.sequenceId, sequenceId))
        .orderBy(schema.sequenceSteps.position);

      await tx.insert(schema.sequenceSteps).values({
        orgId: session.orgId,
        sequenceId,
        position: existing.length + 1,
        type,
        delayHours: Math.max(0, delayHours),
      });
    });

    revalidatePath(`/sequences/${sequenceId}`);
    return { ok: true };
  });
}
