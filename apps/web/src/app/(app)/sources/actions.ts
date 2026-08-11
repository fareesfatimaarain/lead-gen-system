"use server";

import { revalidatePath } from "next/cache";
import { eq, schema, withOrg } from "@outreach/db";
import { validationFailed } from "@outreach/shared";
import { action, int, optionalStr, str } from "@/lib/action";
import type { ActionState } from "@/lib/action";

const VALID_KINDS = ["lead_source", "enrichment", "verification", "search", "crm"] as const;
const VALID_STATUSES = ["active", "paused", "disabled"] as const;

export async function saveDataSourceAction(
  _prevState: ActionState,
  form: FormData,
): Promise<ActionState> {
  return action("write", async (session) => {
    const id = str(form, "id");
    const name = str(form, "name");
    const kind = str(form, "kind");
    const status = str(form, "status");
    const weight = int(form, "weight", 0, 100, 50);
    const notes = optionalStr(form, "notes");

    if (!name) throw validationFailed("Give the source a name.");
    if (!VALID_KINDS.includes(kind as (typeof VALID_KINDS)[number])) {
      throw validationFailed("Pick a valid source kind.");
    }
    if (!VALID_STATUSES.includes(status as (typeof VALID_STATUSES)[number])) {
      throw validationFailed("Pick a valid source status.");
    }

    await withOrg({ orgId: session.orgId, userId: session.userId }, async (tx) => {
      if (id) {
        const updated = await tx
          .update(schema.dataSources)
          .set({
            name,
            kind,
            status,
            weight,
            notes,
            updatedAt: new Date(),
          })
          .where(eq(schema.dataSources.id, id))
          .returning({ id: schema.dataSources.id });
        if (updated.length === 0) throw validationFailed("This source no longer exists.");
        return;
      }

      await tx.insert(schema.dataSources).values({
        orgId: session.orgId,
        name,
        kind,
        status,
        weight,
        notes,
        createdBy: session.userId,
      });
    });

    revalidatePath("/sources");
    return { ok: true, message: "Saved." };
  });
}

export async function setDataSourceStatusAction(
  _prevState: ActionState,
  form: FormData,
): Promise<ActionState> {
  return action("write", async (session) => {
    const id = str(form, "id");
    const status = str(form, "status");

    if (!id) throw validationFailed("Select a source to update.");
    if (!VALID_STATUSES.includes(status as (typeof VALID_STATUSES)[number])) {
      throw validationFailed("Pick a valid source status.");
    }

    await withOrg({ orgId: session.orgId, userId: session.userId }, async (tx) => {
      const updated = await tx
        .update(schema.dataSources)
        .set({ status, updatedAt: new Date() })
        .where(eq(schema.dataSources.id, id))
        .returning({ id: schema.dataSources.id });

      if (updated.length === 0) throw validationFailed("This source no longer exists.");
    });

    revalidatePath("/sources");
    return { ok: true, message: "Source updated." };
  });
}

export async function deleteDataSourceAction(
  _prevState: ActionState,
  form: FormData,
): Promise<ActionState> {
  return action("write", async (session) => {
    const id = str(form, "id");
    if (!id) throw validationFailed("Select a source to delete.");

    await withOrg({ orgId: session.orgId, userId: session.userId }, async (tx) => {
      const deleted = await tx
        .delete(schema.dataSources)
        .where(eq(schema.dataSources.id, id))
        .returning({ id: schema.dataSources.id });
      if (deleted.length === 0) throw validationFailed("This source no longer exists.");
    });

    revalidatePath("/sources");
    return { ok: true, message: "Removed." };
  });
}
