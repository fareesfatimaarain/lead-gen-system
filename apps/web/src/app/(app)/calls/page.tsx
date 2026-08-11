import { Badge, Card, EmptyState, PageHeader, Table, TD, TH, THead, TR, RowLink } from "@/components/ui";
import { listCalls } from "@/lib/data";
import { formatDateTime, formatDuration, formatUsd } from "@/lib/format";
import { requirePageSession } from "@/lib/session";
import { callTone } from "@/lib/tone";

export default async function CallsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const session = await requirePageSession();
  const resolvedSearchParams = await searchParams;
  const page = Number(resolvedSearchParams.page ?? "1");

  const callsData = await listCalls(session, { page });

  return (
    <>
      <PageHeader
        title="Voice Calls"
        description="Dynamic AI phone agent execution log, audio recordings, turn-by-turn transcripts, and objection extractions."
      />

      <div className="p-4">
        {callsData.rows.length === 0 ? (
          <Card className="p-4">
            <EmptyState
              title="No calls placed yet"
              description="When a campaign includes an AI Voice Call step or call-first strategy, Vapi dynamic assistant executions will appear here."
            />
          </Card>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Prospect / Company</TH>
                <TH>Disposition</TH>
                <TH align="right">Duration</TH>
                <TH>Summary</TH>
                <TH align="right">Cost</TH>
                <TH>Date</TH>
              </TR>
            </THead>
            <tbody>
              {callsData.rows.map((c) => (
                <TR key={c.id} href={`/calls/${c.id}`}>
                  <TD>
                    <RowLink href={`/calls/${c.id}`}>
                      {c.prospectName ?? "Unknown Prospect"}
                    </RowLink>
                    <span className="ml-1.5 text-sm text-fg-subtle">{c.companyName ?? "—"}</span>
                  </TD>
                  <TD>
                    <Badge tone={c.disposition ? callTone[c.disposition] : "neutral"}>
                      {c.disposition ?? "placed"}
                    </Badge>
                  </TD>
                  <TD align="right" mono>
                    {c.durationSeconds ? formatDuration(c.durationSeconds) : "—"}
                  </TD>
                  <TD className="max-w-xs truncate">{c.summary ?? "—"}</TD>
                  <TD align="right">{formatUsd(c.costUsd)}</TD>
                  <TD>{formatDateTime(c.createdAt)}</TD>
                </TR>
              ))}
            </tbody>
          </Table>
        )}
      </div>
    </>
  );
}
