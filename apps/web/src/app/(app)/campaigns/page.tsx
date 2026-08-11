import Link from "next/link";
import {
  Badge,
  Card,
  EmptyState,
  PageHeader,
  StatusDot,
  Table,
  TD,
  TH,
  THead,
  TR,
  RowLink,
} from "@/components/ui";
import { listCampaigns } from "@/lib/data";
import { formatDateTime } from "@/lib/format";
import { requirePageSession } from "@/lib/session";

export default async function CampaignsPage() {
  const session = await requirePageSession();
  const campaigns = await listCampaigns(session);

  return (
    <>
      <PageHeader
        title="Campaigns"
        description="Bind an ICP to a multi-channel sequence, set sending policy, and launch automated outreach."
        actions={
          <Link
            href="/campaigns/new"
            prefetch
            className="motion-ok inline-flex h-7 items-center rounded border border-transparent bg-accent px-2.5 text-sm font-medium text-accent-fg hover:opacity-90"
          >
            New campaign
          </Link>
        }
      />

      <div className="p-4">
        {campaigns.length === 0 ? (
          <Card className="p-4">
            <EmptyState
              title="No campaigns yet"
              description="A campaign connects an ICP audience segment to a sequence steps workflow and mailboxes."
              action={
                <Link
                  href="/campaigns/new"
                  prefetch
                  className="motion-ok inline-flex h-7 items-center rounded border border-transparent bg-accent px-2.5 text-sm font-medium text-accent-fg hover:opacity-90"
                >
                  Create your first campaign
                </Link>
              }
            />
          </Card>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Campaign</TH>
                <TH>Status</TH>
                <TH>ICP Target</TH>
                <TH>Sequence</TH>
                <TH align="right">Prospects</TH>
                <TH align="right">Sent</TH>
                <TH align="right">Replies</TH>
                <TH>Created</TH>
              </TR>
            </THead>
            <tbody>
              {campaigns.map((ca) => {
                const statusTone =
                  ca.status === "active" ? "ok" : ca.status === "paused" ? "warn" : "neutral";
                return (
                  <TR key={ca.id}>
                    <TD>
                      <RowLink href={`/campaigns/${ca.id}`}>{ca.name}</RowLink>
                      {ca.autoSendEnabled ? (
                        <span className="ml-2 inline-flex items-center rounded bg-accent-muted px-1.5 py-0.5 text-2xs font-medium text-accent">
                          Auto-send ON
                        </span>
                      ) : null}
                    </TD>
                    <TD>
                      <span className="flex items-center gap-1.5">
                        <StatusDot tone={statusTone} />
                        <span className="text-xs">{ca.status}</span>
                      </span>
                    </TD>
                    <TD>{ca.icpName ?? "—"}</TD>
                    <TD>{ca.sequenceName ?? "—"}</TD>
                    <TD align="right" mono>
                      {ca.prospectCount}
                    </TD>
                    <TD align="right" mono>
                      {ca.sentCount}
                    </TD>
                    <TD align="right" mono>
                      {ca.replyCount}
                    </TD>
                    <TD>{formatDateTime(ca.createdAt)}</TD>
                  </TR>
                );
              })}
            </tbody>
          </Table>
        )}
      </div>
    </>
  );
}
