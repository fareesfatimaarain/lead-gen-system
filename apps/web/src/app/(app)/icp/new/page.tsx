import { PageHeader } from "@/components/ui";
import { requirePageSession } from "@/lib/session";
import { createIcp } from "../actions";
import { IcpForm } from "../IcpForm";

export default async function NewIcpPage() {
  await requirePageSession();
  return (
    <>
      <PageHeader
        title="New ICP"
        description="Structured, not free text — the strategist, the scorer and the composer all read these fields directly."
      />
      <IcpForm action={createIcp} submitLabel="Create ICP" />
    </>
  );
}
