import Link from "next/link";
import { Card, PageHeader } from "@/components/ui";
import { getApprovalGate, listIcps, listMailboxes, listSequences } from "@/lib/data";
import { requirePageSession } from "@/lib/session";
import { CampaignForm } from "./CampaignForm";

export default async function NewCampaignPage() {
  const session = await requirePageSession();
  const [icps, sequences, mailboxes, gate] = await Promise.all([
    listIcps(session),
    listSequences(session),
    listMailboxes(session),
    getApprovalGate(session),
  ]);

  return (
    <>
      <PageHeader
        title="New Campaign"
        description="Configure an automated outbound campaign. Verify dry-run draft samples before launching."
      />

      <div className="mx-auto max-w-4xl p-4">
        <Card className="p-4">
          <CampaignForm
            icps={icps}
            sequences={sequences}
            mailboxes={mailboxes}
            autoSendUnlocked={gate.unlocked}
            gateRequired={gate.required}
            gateApproved={gate.approved}
          />
        </Card>
      </div>
    </>
  );
}
