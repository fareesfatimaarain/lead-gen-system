import Link from "next/link";
import {
  Card,
  EmptyState,
  PageHeader,
  Table,
  TD,
  TH,
  THead,
  TR,
  RowLink,
} from "@/components/ui";
import { listSequences } from "@/lib/data";
import { formatDateTime } from "@/lib/format";
import { requirePageSession } from "@/lib/session";

export default async function SequencesPage() {
  const session = await requirePageSession();
  const sequences = await listSequences(session);

  return (
    <>
      <PageHeader
        title="Sequences"
        description="Design multi-touch outbound cadences combining AI email synthesis, dynamic voice calls, and wait delays."
        actions={
          <Link
            href="/sequences/new"
            prefetch
            className="motion-ok inline-flex h-7 items-center rounded border border-transparent bg-accent px-2.5 text-sm font-medium text-accent-fg hover:opacity-90"
          >
            New sequence
          </Link>
        }
      />

      <div className="p-4">
        {sequences.length === 0 ? (
          <Card className="p-4">
            <EmptyState
              title="No sequences yet"
              description="A sequence defines the multi-step schedule of touchpoints for prospect outreach."
              action={
                <Link
                  href="/sequences/new"
                  prefetch
                  className="motion-ok inline-flex h-7 items-center rounded border border-transparent bg-accent px-2.5 text-sm font-medium text-accent-fg hover:opacity-90"
                >
                  Create sequence
                </Link>
              }
            />
          </Card>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Sequence</TH>
                <TH align="right">Steps</TH>
                <TH align="right">Campaigns</TH>
                <TH>Last Updated</TH>
              </TR>
            </THead>
            <tbody>
              {sequences.map((s) => (
                <TR key={s.id}>
                  <TD>
                    <RowLink href={`/sequences/${s.id}`}>{s.name}</RowLink>
                  </TD>
                  <TD align="right" mono>
                    {s.stepCount}
                  </TD>
                  <TD align="right" mono>
                    {s.campaignCount}
                  </TD>
                  <TD>{formatDateTime(s.updatedAt)}</TD>
                </TR>
              ))}
            </tbody>
          </Table>
        )}
      </div>
    </>
  );
}
