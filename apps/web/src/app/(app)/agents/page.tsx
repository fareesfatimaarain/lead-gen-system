import { Badge, Card, EmptyState, PageHeader, Table, TD, TH, THead, TR } from "@/components/ui";
import { listAgentRuns } from "@/lib/data";
import { formatDateTime } from "@/lib/format";
import { requirePageSession } from "@/lib/session";

export default async function AgentRunsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const session = await requirePageSession();
  const resolvedSearchParams = await searchParams;
  const page = Number(resolvedSearchParams.page ?? "1");

  const agentRunsData = await listAgentRuns(session, { page });

  return (
    <>
      <PageHeader
        title="Agent Runs Transparency Log"
        description="Full auditability into discrete agent calls: input prompts, structured JSON outputs, tokens, costs, and latency."
      />

      <div className="p-4">
        {agentRunsData.rows.length === 0 ? (
          <Card className="p-4">
            <EmptyState
              title="No agent runs recorded yet"
              description="Calls to the Source Strategist, Scorer, Message Composer, Research Agent, and Reply Classifier are logged here."
            />
          </Card>
        ) : (
          <Table>
            <THead>
              <TH>Agent Type</TH>
              <TH>Model</TH>
              <TH align="right">Input Tokens</TH>
              <TH align="right">Output Tokens</TH>
              <TH align="right">Cost USD</TH>
              <TH align="right">Latency</TH>
              <TH>Target Prospect</TH>
              <TH>Timestamp</TH>
            </THead>
            <tbody>
              {agentRunsData.rows.map((r) => (
                <TR key={r.id}>
                  <TD mono>
                    <Badge tone="accent">{r.agent}</Badge>
                  </TD>
                  <TD mono>{r.model}</TD>
                  <TD align="right" mono>{r.inputTokens ?? "—"}</TD>
                  <TD align="right" mono>{r.outputTokens ?? "—"}</TD>
                  <TD align="right" mono>${r.costUsd ?? "0.00"}</TD>
                  <TD align="right" mono>{r.latencyMs ? `${r.latencyMs}ms` : "—"}</TD>
                  <TD mono>{r.prospectId ?? "—"}</TD>
                  <TD>{formatDateTime(r.createdAt)}</TD>
                </TR>
              ))}
            </tbody>
          </Table>
        )}
      </div>
    </>
  );
}
