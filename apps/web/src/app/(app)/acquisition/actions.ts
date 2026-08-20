"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { schema, withOrg } from "@outreach/db";
import { validationFailed } from "@outreach/shared";
import { action } from "@/lib/action";
import type { ActionState } from "@/lib/action";

/**
 * Set what a booked consultation is worth.
 *
 * Lives on the Acquisition screen rather than in Settings because that is where
 * the number is missing from and where its absence is visible. Asking someone to
 * navigate away to unlock the figure they came to read is how a field stays
 * unset forever.
 */
export async function setPatientValueAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return action("write", async (session) => {
    const raw = String(form.get("patientValueUsd") ?? "").trim().replace(/[$,]/g, "");
    if (!raw) throw validationFailed("Enter what one booked consultation is worth.");

    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) {
      throw validationFailed("That is not an amount. Enter a number like 4775.");
    }
    // numeric(12,2): more than this cannot be stored, and a clinic entering it
    // has typed cents-as-dollars or added a digit.
    if (value > 9_999_999_999) {
      throw validationFailed("That value is implausibly large — check the figure.");
    }

    await withOrg({ orgId: session.orgId, userId: session.userId }, (tx) =>
      tx
        .update(schema.settings)
        .set({ patientValueUsd: value.toFixed(2), updatedAt: new Date() })
        .where(eq(schema.settings.orgId, session.orgId)),
    );

    revalidatePath("/acquisition");
    revalidatePath("/settings");
    return { ok: true, message: `Consultation value set to $${value.toLocaleString("en-US")}.` };
  });
}
