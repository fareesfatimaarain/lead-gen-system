"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq, schema, withOrg } from "@outreach/db";
import { notFound, validationFailed } from "@outreach/shared";
import { action, bool, str } from "@/lib/action";
import type { ActionState } from "@/lib/action";
import { getApprovalGate } from "@/lib/data";

export async function createCampaignAction(
  prevState: ActionState,
  form: FormData,
): Promise<ActionState> {
  return action("write", async (session) => {
    const name = str(form, "name");
    const icpId = str(form, "icpId");
    const sequenceId = str(form, "sequenceId");
    const autoSendEnabled = bool(form, "autoSendEnabled");
    const callFirst = bool(form, "callFirst");
    const mailboxIds = form.getAll("mailboxIds").filter((v): v is string => typeof v === "string" && v.length > 0);

    if (!name) throw validationFailed("Give this campaign a name.");
    if (!icpId) throw validationFailed("Select an ICP target for this campaign.");
    if (!sequenceId) throw validationFailed("Select a sequence to run.");

    if (autoSendEnabled) {
      const gate = await getApprovalGate(session);
      if (!gate.unlocked) {
        throw validationFailed(
          `Auto-send is locked. You must manually approve ${gate.required - gate.approved} more drafts before auto-send can be enabled.`,
        );
      }
    }

    const campaignId = await withOrg({ orgId: session.orgId, userId: session.userId }, async (tx) => {
      const [icp] = await tx.select().from(schema.icps).where(eq(schema.icps.id, icpId)).limit(1);
      if (!icp) throw notFound("ICP");

      const [sequence] = await tx.select().from(schema.sequences).where(eq(schema.sequences.id, sequenceId)).limit(1);
      if (!sequence) throw notFound("Sequence");

      const [newCampaign] = await tx
        .insert(schema.campaigns)
        .values({
          orgId: session.orgId,
          name,
          icpId,
          sequenceId,
          autoSendEnabled,
          callFirst,
          status: "draft",
        })
        .returning({ id: schema.campaigns.id });

      if (mailboxIds.length > 0 && newCampaign) {
        await tx.insert(schema.campaignMailboxes).values(
          mailboxIds.map((mailboxId) => ({
            orgId: session.orgId,
            campaignId: newCampaign.id,
            mailboxId,
          })),
        );
      }

      return newCampaign?.id;
    });

    revalidatePath("/campaigns");
    redirect(`/campaigns/${campaignId}`);
  });
}

export async function toggleCampaignStatusAction(
  campaignId: string,
  newStatus: "draft" | "active" | "paused" | "archived",
): Promise<ActionState> {
  return action("activate_campaign", async (session) => {
    await withOrg({ orgId: session.orgId, userId: session.userId }, async (tx) => {
      const [campaign] = await tx.select().from(schema.campaigns).where(eq(schema.campaigns.id, campaignId)).limit(1);
      if (!campaign) throw notFound("Campaign");

      await tx
        .update(schema.campaigns)
        .set({
          status: newStatus,
          activatedAt: newStatus === "active" && !campaign.activatedAt ? new Date() : campaign.activatedAt,
          updatedAt: new Date(),
        })
        .where(eq(schema.campaigns.id, campaignId));
    });

    revalidatePath("/campaigns");
    revalidatePath(`/campaigns/${campaignId}`);
    return { ok: true };
  });
}

export async function toggleAutoSendAction(
  campaignId: string,
  autoSendEnabled: boolean,
): Promise<ActionState> {
  return action("activate_campaign", async (session) => {
    if (autoSendEnabled) {
      const gate = await getApprovalGate(session);
      if (!gate.unlocked) {
        throw validationFailed(
          `Auto-send is locked. Approve ${gate.required - gate.approved} more drafts first.`,
        );
      }
    }

    await withOrg({ orgId: session.orgId, userId: session.userId }, async (tx) => {
      await tx
        .update(schema.campaigns)
        .set({
          autoSendEnabled,
          updatedAt: new Date(),
        })
        .where(eq(schema.campaigns.id, campaignId));
    });

    revalidatePath("/campaigns");
    revalidatePath(`/campaigns/${campaignId}`);
    return { ok: true };
  });
}
