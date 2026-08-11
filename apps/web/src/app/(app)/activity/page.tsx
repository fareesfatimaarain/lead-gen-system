import { Badge, Card, EmptyState, PageHeader, Table, TD, TH, THead, TR } from "@/components/ui";
import { listActivityLog } from "@/lib/data";
import { formatDateTime, humanize } from "@/lib/format";
import { requirePageSession } from "@/lib/session";

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const session = await requirePageSession();
  const resolvedSearchParams = await searchParams;
  const page = Number(resolvedSearchParams.page ?? "1");

  const activityData = await listActivityLog(session, { page });

  return (
    <>
      <PageHeader
        title="Activity Log"
        description="Unified audit trail of all emails, calls, notes, status updates, and agent operations across the workspace."
      />

      <div className="p-4">
        {activityData.rows.length === 0 ? (
          <Card className="p-4">
            <EmptyState
              title="No activity recorded yet"
              description="System actions, email events, call logs, and prospect state changes will stream here chronologically."
            />
          </Card>
        ) : (
          <Table>
            <THead>
              <TH>Activity Type</TH>
              <TH>Prospect</TH>
              <TH>Details</TH>
              <TH>Channel</TH>
              <TH>Timestamp</TH>
            </THead>
            <tbody>
              {activityData.rows.map((act) => (
                <TR key={act.id}>
                  <TD mono>
                    <Badge tone="neutral">{humanize(act.type)}</Badge>
                  </TD>
                  <TD>
                    {act.prospectName ? (
                      <span className="text-fg-muted">{act.prospectName}</span>
                    ) : (
                      <span className="text-fg-subtle">—</span>
                    )}
                  </TD>
                  <TD className="max-w-md truncate">
                    {act.summary ??
                      (Object.keys(act.metadata ?? {}).length > 0
                        ? JSON.stringify(act.metadata)
                        : "—")}
                  </TD>
                  <TD mono>{act.channel ?? "system"}</TD>
                  <TD>{formatDateTime(act.occurredAt)}</TD>
                </TR>
              ))}
            </tbody>
          </Table>
        )}
      </div>
    </>
  );
}
