import { Badge, Card, EmptyState, PageHeader, Table, TD, TH, THead, TR } from "@/components/ui";
import { listSuppressions } from "@/lib/data";
import { formatDateTime } from "@/lib/format";
import { requirePageSession } from "@/lib/session";
import { SuppressionForm } from "./SuppressionForm";

export default async function SuppressionsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const session = await requirePageSession();
  const resolvedSearchParams = await searchParams;
  const page = Number(resolvedSearchParams.page ?? "1");

  const suppressionsData = await listSuppressions(session, { page });

  return (
    <>
      <PageHeader
        title="Suppressions"
        description="Org-wide and global Do-Not-Contact registry for emails, domains, and phone numbers."
      />

      <div className="flex flex-col gap-6 p-4">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Table */}
          <div className="flex flex-col gap-4 lg:col-span-8">
            {suppressionsData.rows.length === 0 ? (
              <Card>
                <EmptyState
                  title="No active suppressions"
                  description="Unsubscribes, objections, hard bounces, and manual DNC entries are permanently recorded here to prevent contact."
                />
              </Card>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Type</TH>
                    <TH>Target Value</TH>
                    <TH>Reason</TH>
                    <TH>Source</TH>
                    <TH>Date Added</TH>
                  </TR>
                </THead>
                <tbody>
                  {suppressionsData.rows.map((s) => (
                    <TR key={s.id}>
                      <TD>
                        <Badge tone="neutral">{s.kind}</Badge>
                      </TD>
                      <TD mono>{s.value}</TD>
                      <TD>{s.reason ?? "—"}</TD>
                      <TD mono>{s.source ?? "manual"}</TD>
                      <TD>{formatDateTime(s.createdAt)}</TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
            )}
          </div>

          {/* Manual Add Form */}
          <div className="flex flex-col gap-4 lg:col-span-4">
            <Card className="p-4">
              <h3 className="text-xs font-semibold text-fg mb-3">Add Suppression</h3>
              <SuppressionForm />
            </Card>
          </div>
        </div>
      </div>
    </>
  );
}
