import Link from "next/link";
import {
  Badge,
  Card,
  EmptyState,
  Pager,
  PageHeader,
  RowLink,
  SectionHeading,
  Table,
  TD,
  TH,
  THead,
  TR,
} from "@/components/ui";
import { listDiscoveryRuns, listIcps } from "@/lib/data";
import { formatDateTime, formatUsd, humanize } from "@/lib/format";
import { getPage, PAGE_SIZE } from "@/lib/query";
import type { SearchParams } from "@/lib/query";
import { runTone } from "@/lib/tone";
import { requirePageSession } from "@/lib/session";

/**
 * Discovery runs.
 *
 * The counts on each row are the honest ones: found, new, duplicate, suppressed.
 * A run that returns 200 leads of which 190 were already in the database has
 * found ten leads, and reporting it as 200 would make every source look good.
 */
export default async function DiscoveryPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await requirePageSession();
  const params = await searchParams;
  const page = getPage(params);

  const [{ rows, total }, icps] = await Promise.all([
    listDiscoveryRuns(session, { page }),
    listIcps(session),
  ]);
  const now = new Date();

  return (
    <>
      <PageHeader
        title="Discovery"
        description="Each run plans its sources from an ICP, then reports exactly what it found and what it discarded."
        actions={
          icps.length > 0 ? (
            <Link
              href="/discovery/new"
              prefetch
              className="motion-ok inline-flex h-7 items-center rounded border border-transparent bg-accent px-2.5 text-sm font-medium text-accent-fg hover:opacity-90"
            >
              New run
            </Link>
          ) : undefined
        }
      />

      {icps.length === 0 ? (
        <EmptyState
          title="Define an ICP first"
          description="A discovery run needs a profile to plan against — which industries, which places, which titles. Without one there is nothing to search for."
          action={
            <Link
              href="/icp/new"
              className="motion-ok inline-flex h-7 items-center rounded border border-transparent bg-accent px-2.5 text-sm font-medium text-accent-fg hover:opacity-90"
            >
              Define an ICP
            </Link>
          }
        />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No runs yet"
          description="A run picks its sources from your ICP, deduplicates against everything already in this workspace, and drops anything on a suppression list before it is ever stored."
          action={
            <Link
              href="/discovery/new"
              className="motion-ok inline-flex h-7 items-center rounded border border-transparent bg-accent px-2.5 text-sm font-medium text-accent-fg hover:opacity-90"
            >
              Start a run
            </Link>
          }
        />
      ) : (
        <div className="p-6">
          <Card>
            <SectionHeading title="Runs" actions={<span className="tabular text-xs text-fg-subtle">{total}</span>} />
            <Table>
              <THead>
                <TH>Started</TH>
                <TH>ICP</TH>
                <TH>Status</TH>
                <TH align="right">Target</TH>
                <TH align="right">Companies</TH>
                <TH align="right">Found</TH>
                <TH align="right">New</TH>
                <TH align="right">Duplicate</TH>
                <TH align="right">Suppressed</TH>
                <TH align="right">Cost</TH>
              </THead>
              <tbody>
                {rows.map((r) => (
                  <TR key={r.id} href={`/discovery/${r.id}`}>
                    <TD>
                      <RowLink href={`/discovery/${r.id}`}>{formatDateTime(r.startedAt, now)}</RowLink>
                    </TD>
                    <TD>
                      <span className="text-fg-muted">{r.icpName ?? "—"}</span>
                    </TD>
                    <TD>
                      <Badge tone={runTone[r.status]}>{humanize(r.status)}</Badge>
                    </TD>
                    <TD align="right">{r.targetCount}</TD>
                    <TD align="right">{r.companiesFound}</TD>
                    <TD align="right">{r.prospectsFound}</TD>
                    <TD align="right">
                      <span className={r.prospectsNew > 0 ? "text-ok" : "text-fg-subtle"}>{r.prospectsNew}</span>
                    </TD>
                    <TD align="right">
                      <span className="text-fg-subtle">{r.duplicatesSkipped}</span>
                    </TD>
                    <TD align="right">
                      <span className={r.suppressedSkipped > 0 ? "text-warn" : "text-fg-subtle"}>
                        {r.suppressedSkipped}
                      </span>
                    </TD>
                    <TD align="right">
                      <span className="text-fg-muted">{formatUsd(r.costUsd)}</span>
                    </TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          </Card>
          <div className="mt-2">
            <Pager basePath="/discovery" page={page} pageSize={PAGE_SIZE} total={total} />
          </div>
        </div>
      )}
    </>
  );
}
