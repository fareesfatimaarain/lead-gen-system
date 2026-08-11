"use server";

import { revalidatePath } from "next/cache";
import { eq, schema, sql, withOrg } from "@outreach/db";
import { notFound } from "@outreach/shared";
import { action } from "@/lib/action";
import type { ActionState } from "@/lib/action";

export async function approveDraftAction(
  emailId: string,
  sendImmediately: boolean = false,
): Promise<ActionState> {
  return action("write", async (session) => {
    await withOrg({ orgId: session.orgId, userId: session.userId }, async (tx) => {
      const [email] = await tx.select().from(schema.emails).where(eq(schema.emails.id, emailId)).limit(1);
      if (!email) throw notFound("Email draft");

      await tx
        .update(schema.emails)
        .set({
          state: sendImmediately ? "queued" : "queued",
          approvedAt: new Date(),
          approvedBy: session.userId,
        })
        .where(eq(schema.emails.id, emailId));

      await tx
        .update(schema.orgs)
        .set({
          approvedDraftCount: sql`${schema.orgs.approvedDraftCount} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(schema.orgs.id, session.orgId));
    });

    revalidatePath("/approvals");
    revalidatePath("/dashboard");
    return { ok: true };
  });
}

export async function rejectDraftAction(emailId: string): Promise<ActionState> {
  return action("write", async (session) => {
    await withOrg({ orgId: session.orgId, userId: session.userId }, async (tx) => {
      await tx
        .update(schema.emails)
        .set({
          state: "rejected",
          updatedAt: new Date(),
        })
        .where(eq(schema.emails.id, emailId));
    });

    revalidatePath("/approvals");
    return { ok: true };
  });
}

export async function updateDraftTextAction(emailId: string, subject: string, bodyText: string): Promise<ActionState> {
  return action("write", async (session) => {
    await withOrg({ orgId: session.orgId, userId: session.userId }, async (tx) => {
      await tx
        .update(schema.emails)
        .set({
          subject,
          bodyText,
          updatedAt: new Date(),
        })
        .where(eq(schema.emails.id, emailId));
    });

    revalidatePath("/approvals");
    return { ok: true };
  });
}
