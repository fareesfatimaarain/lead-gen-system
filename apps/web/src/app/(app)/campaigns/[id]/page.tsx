import Link from "next/link";
import { Card, PageHeader, Stat, StatRow, StatusDot } from "@/components/ui";
import { getCampaign } from "@/lib/data";
import { requirePageSession } from "@/lib/session";
import { CampaignControls } from "./CampaignControls";

export default async function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePageSession();
  const resolvedParams = await params;
  const data = await getCampaign(session, resolvedParams.id);
  const { campaign, icp, sequence, steps, mailboxes, funnel } = data;

  const statusTone =
    campaign.status === "active" ? "ok" : campaign.status === "paused" ? "warn" : "neutral";

  return (
    <>
      <PageHeader
        title={campaign.name}
        description={`Target ICP: ${icp?.name ?? "None"} · Sequence: ${sequence?.name ?? "None"}`}
        actions={
          <CampaignControls
            campaignId={campaign.id}
            currentStatus={campaign.status}
            autoSendEnabled={campaign.autoSendEnabled}
          />
        }
      />

      <div className="flex flex-col gap-6 p-4">
        {/* Stat row */}
        <StatRow>
          <Stat label="Total Prospects" value={funnel.prospects} hint="In campaign pipeline" />
          <Stat label="Contacted" value={funnel.contacted} hint="Emails sent / calls placed" />
          <Stat label="Engaged" value={funnel.engaged} hint="Replies & call interactions" tone={funnel.engaged > 0 ? "ok" : "neutral"} />
          <Stat label="Meetings Booked" value={funnel.booked} hint="Warm handoffs" tone={funnel.booked > 0 ? "ok" : "neutral"} />
          <Stat label="Unsubscribed / Bounced" value={funnel.unsubscribed + funnel.bounced} hint={`${funnel.bounced} bounces`} tone={funnel.bounced > 0 ? "warn" : "neutral"} />
        </StatRow>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {/* Campaign details */}
          <Card className="p-4 flex flex-col gap-3 lg:col-span-1">
            <h3 className="text-xs font-semibold text-fg">Campaign Details</h3>
            <div className="flex flex-col gap-2 text-xs">
              <div className="flex justify-between border-b border-border pb-1">
                <span className="text-fg-subtle">Status</span>
                <span className="flex items-center gap-1.5">
                  <StatusDot tone={statusTone} />
                  <span className="text-xs">{campaign.status}</span>
                </span>
              </div>
              <div className="flex justify-between border-b border-border pb-1">
                <span className="text-fg-subtle">Auto-Send</span>
                <span className={campaign.autoSendEnabled ? "font-medium text-accent" : "text-fg-muted"}>
                  {campaign.autoSendEnabled ? "Enabled" : "Approval Queue Required"}
                </span>
              </div>
              <div className="flex justify-between border-b border-border pb-1">
                <span className="text-fg-subtle">Channel Strategy</span>
                <span>{campaign.callFirst ? "Call-first" : "Email-first"}</span>
              </div>
              <div className="flex justify-between border-b border-border pb-1">
                <span className="text-fg-subtle">Target ICP</span>
                <Link href={icp ? `/icp/${icp.id}` : "#"} className="text-accent hover:underline">
                  {icp?.name ?? "—"}
                </Link>
              </div>
              <div className="flex justify-between border-b border-border pb-1">
                <span className="text-fg-subtle">Sequence</span>
                <Link href={sequence ? `/sequences/${sequence.id}` : "#"} className="text-accent hover:underline">
                  {sequence?.name ?? "—"}
                </Link>
              </div>
            </div>

            <div className="mt-2 flex flex-col gap-1.5">
              <span className="text-2xs font-semibold text-fg-muted uppercase tracking-wider">Assigned Mailboxes</span>
              {mailboxes.length === 0 ? (
                <span className="text-xs text-fg-subtle">No mailboxes attached</span>
              ) : (
                mailboxes.map((mb) => (
                  <div key={mb.id} className="flex items-center justify-between text-xs rounded border border-border p-2">
                    <span className="font-mono text-fg">{mb.email}</span>
                    <span className="text-2xs text-fg-subtle">Sent: {mb.sentToday}/{mb.currentDailyCap}</span>
                  </div>
                ))
              )}
            </div>
          </Card>

          {/* Sequence Steps overview */}
          <Card className="p-4 flex flex-col gap-3 lg:col-span-2">
            <h3 className="text-xs font-semibold text-fg">Sequence Steps ({steps.length})</h3>
            {steps.length === 0 ? (
              <span className="text-xs text-fg-subtle">No steps defined in sequence.</span>
            ) : (
              <div className="flex flex-col gap-2">
                {steps.map((st, i) => (
                  <div key={st.id} className="flex items-center justify-between rounded border border-border p-2.5 bg-surface">
                    <div className="flex items-center gap-3">
                      <span className="grid size-6 place-items-center rounded bg-surface-muted text-xs font-mono font-bold text-fg-muted">
                        {i + 1}
                      </span>
                      <div className="flex flex-col">
                        <span className="text-xs font-medium text-fg uppercase tracking-wider">
                          {st.type}
                        </span>
                        {st.type === "wait" ? (
                          <span className="text-2xs text-fg-subtle">Wait {st.delayHours} hours</span>
                        ) : (
                          <span className="text-2xs text-fg-subtle">
                            {st.type === "email" ? "Personalized AI Email" : "AI Phone Call"}
                          </span>
                        )}
                      </div>
                    </div>
                    {st.conditions ? (
                      <span className="text-2xs text-fg-subtle font-mono">Condition: {JSON.stringify(st.conditions)}</span>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
