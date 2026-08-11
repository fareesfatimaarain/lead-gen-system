"use server";

import { revalidatePath } from "next/cache";
import { schema, withOrg } from "@outreach/db";
import { validationFailed } from "@outreach/shared";
import { action, int, str } from "@/lib/action";
import type { ActionState } from "@/lib/action";

export async function createMailboxAction(
  prevState: ActionState,
  form: FormData,
): Promise<ActionState> {
  return action("write", async (session) => {
    const email = str(form, "email");
    const initialCap = int(form, "initialDailyCap", 1, 500, 40);

    if (!email) throw validationFailed("Provide a mailbox email address.");

    await withOrg({ orgId: session.orgId, userId: session.userId }, async (tx) => {
      await tx.insert(schema.mailboxes).values({
        orgId: session.orgId,
        email,
        status: "warming",
        currentDailyCap: initialCap,
        spfPass: true,
        dkimPass: true,
        dmarcPass: true,
      });
    });

    revalidatePath("/mailboxes");
    return { ok: true };
  });
}
