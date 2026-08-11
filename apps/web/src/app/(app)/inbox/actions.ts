"use server";

import { revalidatePath } from "next/cache";
import { eq, schema, withOrg } from "@outreach/db";
import { notFound } from "@outreach/shared";
import { action } from "@/lib/action";
import type { ActionState } from "@/lib/action";

export async function markReplyHandledAction(
  replyId: string,
  newProspectStatus?: "engaged" | "meeting_booked" | "disqualified" | "unsubscribed",
): Promise<ActionState> {
  return action("write", async (session) => {
    await withOrg({ orgId: session.orgId, userId: session.userId }, async (tx) => {
      const [reply] = await tx.select().from(schema.emailReplies).where(eq(schema.emailReplies.id, replyId)).limit(1);
      if (!reply) throw notFound("Email reply");

      await tx
        .update(schema.emailReplies)
        .set({
          handledAt: new Date(),
          handledBy: session.userId,
        })
        .where(eq(schema.emailReplies.id, replyId));

      if (newProspectStatus && reply.prospectId) {
        await tx
          .update(schema.prospects)
          .set({
            status: newProspectStatus,
            updatedAt: new Date(),
          })
          .where(eq(schema.prospects.id, reply.prospectId));
      }
    });

    revalidatePath("/inbox");
    revalidatePath("/dashboard");
    return { ok: true };
  });
}
