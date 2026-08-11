import { Badge, Card, EmptyState, PageHeader, Stat, StatRow, StatusDot, Table, TD, TH, THead, TR } from "@/components/ui";
import { listJobs } from "@/lib/data";
import { formatDateTime } from "@/lib/format";
import { requirePageSession } from "@/lib/session";

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const session = await requirePageSession();
  const resolvedSearchParams = await searchParams;
  const page = Number(resolvedSearchParams.page ?? "1");

  const jobsData = await listJobs(session, { page });

  return (
    <>
      <PageHeader
        title="Jobs Queue Monitor"
        description="BullMQ + Redis background worker jobs runtime. Every agent action is an idempotent, retryable background job."
      />

      <div className="flex flex-col gap-6 p-4">
        {jobsData.rows.length === 0 ? (
          <Card className="p-4">
            <EmptyState
              title="No active or historical background jobs logged"
              description="Agent runs, email send tasks, discovery web crawlers, and webhook ingestion jobs run asynchronously through the worker service."
            />
          </Card>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Job Name</TH>
                <TH>Status</TH>
                <TH align="right">Attempts</TH>
                <TH>Error Details</TH>
                <TH>Started</TH>
                <TH>Completed</TH>
              </TR>
            </THead>
            <tbody>
              {jobsData.rows.map((j) => {
                const statusTone = j.status === "completed" ? "ok" : j.status === "failed" ? "danger" : "warn";
                return (
                  <TR key={j.id}>
                    <TD mono>{j.name}</TD>
                    <TD>
                      <span className="flex items-center gap-1.5">
                        <StatusDot tone={statusTone} />
                        <span className="text-xs">{j.status}</span>
                      </span>
                    </TD>
                    <TD align="right" mono>{j.attempts}</TD>
                    <TD className="max-w-xs truncate">{j.lastError ?? "—"}</TD>
                    <TD>{j.startedAt ? formatDateTime(j.startedAt) : "—"}</TD>
                    <TD>{j.finishedAt ? formatDateTime(j.finishedAt) : "—"}</TD>
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
