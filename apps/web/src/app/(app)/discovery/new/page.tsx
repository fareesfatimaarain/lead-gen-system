import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { listCampaigns, listIcps } from "@/lib/data";
import { getString } from "@/lib/query";
import type { SearchParams } from "@/lib/query";
import { requirePageSession } from "@/lib/session";
import { NewRunForm } from "./NewRunForm";

export default async function NewDiscoveryRunPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await requirePageSession();
  const params = await searchParams;

  const [icps, campaigns] = await Promise.all([listIcps(session), listCampaigns(session)]);
  if (icps.length === 0) redirect("/icp/new");

  return (
    <>
      <PageHeader
        title="New discovery run"
        description="Sources are chosen by the strategist from your ICP. You set the ceiling."
      />
      <NewRunForm
        icps={icps.map((i) => ({ id: i.id, name: i.name }))}
        campaigns={campaigns
          .filter((c) => c.status === "draft" || c.status === "active")
          .map((c) => ({ id: c.id, name: c.name }))}
        defaultIcpId={getString(params, "icp")}
      />
    </>
  );
}
