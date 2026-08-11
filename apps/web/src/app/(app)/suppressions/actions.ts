"use server";

import { revalidatePath } from "next/cache";
import { schema, withOrg } from "@outreach/db";
import { validationFailed } from "@outreach/shared";
import { action, str } from "@/lib/action";
import type { ActionState } from "@/lib/action";

export async function addSuppressionAction(
  prevState: ActionState,
  form: FormData,
): Promise<ActionState> {
  return action("write", async (session) => {
    const kind = str(form, "kind") as "email" | "domain" | "phone";
    const value = str(form, "value").toLowerCase();
    const reason = str(form, "reason") || "Manual Do-Not-Contact entry";

    if (!value) throw validationFailed("Provide a target value (email, domain, or phone).");

    await withOrg({ orgId: session.orgId, userId: session.userId }, async (tx) => {
      await tx.insert(schema.suppressions).values({
        orgId: session.orgId,
        scope: "org",
        kind: kind || "email",
        value,
        reason,
        source: "manual",
        createdBy: session.userId,
      });
    });

    revalidatePath("/suppressions");
    return { ok: true };
  });
}
