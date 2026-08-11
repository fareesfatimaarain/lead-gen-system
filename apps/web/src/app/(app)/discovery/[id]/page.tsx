import Link from "next/link";
import { notFound as nextNotFound } from "next/navigation";
import { isAppError } from "@outreach/shared";
import {
  Badge,
  Card,
  DescriptionList,
  Notice,
  PageHeader,
  RowLink,
  SectionHeading,
  Stat,
  StatRow,
  Table,
  TD,
  TH,
  THead,
  TR,
} from "@/components/ui";
import { getDiscoveryRun } from "@/lib/data";
import { formatDateTime, formatNumber, formatUsd, humanize } from "@/lib/format";
import { prospectTone, runTone } from "@/lib/tone";
import { requirePageSession } from "@/lib/session";
import { CancelRunButton } from "./CancelRunButton";

/**
 * One discovery run.
 *
 * The stored plan is shown verbatim, including the strategist's own reasoning.
 * "Why did it search there, and what did that cost?" has to be answerable months
 * later, and it is also the only way a user can tell a bad plan from a bad
 * source.
 */
export default async function DiscoveryRunPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePageSession();
  const { id } = await params;

  let data;
  try {
    data = await getDiscoveryRun(session, id);
  } catch (err) {
    if (isAppError(err) && err.code === "not_found") nextNotFound();
    throw err;
  }

  const { run, icp, sources, prospects } = data;
  const now = new Date();
  const inFlight = run.status === "planning" || run.status === "running";

  return (
    <>
      <PageHeader
        title="Discovery run"
        description={`${icp?.name ?? "Unknown ICP"} · started ${formatDateTime(run.startedAt, now)}`}
        actions={
          <div className="flex items-center gap-2">
            <Badge tone={runTone[run.status]}>{humanize(run.status)}</Badge>
            {inFlight ? <CancelRunButton id={run.id} /> : null}
          </div>
        }
      />

      <StatRow>
        <Stat label="Ceiling" value={run.targetCount} hint="Set before the run started" />
        <Stat label="Companies" value={formatNumber(run.companiesFound)} />
        <Stat label="Prospects found" value={formatNumber(run.prospectsFound)} />
        <Stat
          label="Actually new"
          value={formatNumber(run.prospectsNew)}
          hint={`${run.duplicatesSkipped} already known`}
          tone={run.prospectsNew > 0 ? "ok" : "neutral"}
        />
        <Stat
          label="Suppressed"
          value={formatNumber(run.suppressedSkipped)}
          hint="Never stored"
          tone={run.suppressedSkipped > 0 ? "warn" : "neutral"}
        />
      </StatRow>

      {run.error ? (
        <div className="px-6 pt-4">
          <Notice tone="danger">{run.error}</Notice>
        </div>
      ) : null}

      {inFlight ? (
        <div className="px-6 pt-4">
          <Notice tone="accent">
            This run is queued. A worker picks it up, plans its sources, and fills these counts in as
            it goes — the page shows whatever has been committed so far, not a projection.
          </Notice>
        </div>
      ) : null}

      <div className="grid gap-4 p-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex flex-col gap-4">
          <Card>
            <SectionHeading
              title="Plan"
              note="The strategist's output, stored verbatim so the run can be explained and repeated."
            />
            {run.planReasoning ? (
              <p className="border-b border-border px-4 py-2.5 text-base text-fg-muted">{run.planReasoning}</p>
            ) : null}
            {run.plan ? (
              <pre className="mono overflow-x-auto px-4 py-3 text-xs leading-5 text-fg-muted">
                {JSON.stringify(run.plan, null, 2)}
              </pre>
            ) : (
              <p className="px-4 py-4 text-sm text-fg-muted">
                No plan recorded yet. It is written before any source is queried.
              </p>
            )}
            {run.planModel ? (
              <p className="border-t border-border px-4 py-1.5 text-xs text-fg-subtle">{run.planModel}</p>
            ) : null}
          </Card>

          <Card>
            <SectionHeading
              title="Source performance"
              note="What each source returned. Read by the strategist to re-rank sources on the next run."
            />
            {sources.length === 0 ? (
              <p className="px-4 py-4 text-sm text-fg-muted">No source has reported yet.</p>
            ) : (
              <Table>
                <THead>
                  <TH>Source</TH>
                  <TH>Query</TH>
                  <TH align="right">Returned</TH>
                  <TH align="right">New</TH>
                  <TH align="right">Qualified</TH>
                  <TH align="right">Avg fit</TH>
                  <TH align="right">Cost</TH>
                  <TH align="right">Latency</TH>
                </THead>
                <tbody>
                  {sources.map((s) => (
                    <TR key={s.id}>
                      <TD>{humanize(s.source)}</TD>
                      <TD>
                        <span className="mono text-xs text-fg-subtle">{s.query ?? "—"}</span>
                      </TD>
                      <TD align="right">{s.leadsReturned}</TD>
                      <TD align="right">{s.leadsNew}</TD>
                      <TD align="right">{s.leadsQualified}</TD>
                      <TD align="right">{s.avgFitScore ? Number(s.avgFitScore).toFixed(0) : "—"}</TD>
                      <TD align="right">{formatUsd(s.costUsd)}</TD>
                      <TD align="right">
                        <span className="text-fg-subtle">{s.latencyMs ? `${s.latencyMs}ms` : "—"}</span>
                      </TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>

          <Card>
            <SectionHeading
              title="Prospects from this run"
              actions={<span className="tabular text-xs text-fg-subtle">{prospects.length}</span>}
            />
            {prospects.length === 0 ? (
              <p className="px-4 py-4 text-sm text-fg-muted">Nothing stored yet.</p>
            ) : (
              <Table>
                <THead>
                  <TH>Name</TH>
                  <TH>Title</TH>
                  <TH>Company</TH>
                  <TH>Email</TH>
                  <TH>Status</TH>
                </THead>
                <tbody>
                  {prospects.map((p) => (
                    <TR key={p.id} href={`/prospects/${p.id}`}>
                      <TD>
                        <RowLink href={`/prospects/${p.id}`}>{p.fullName ?? "Unnamed"}</RowLink>
                      </TD>
                      <TD>
                        <span className="text-fg-muted">{p.title ?? "—"}</span>
                      </TD>
                      <TD>
                        <span className="text-fg-muted">{p.companyName ?? "—"}</span>
                      </TD>
                      <TD mono>
                        <span className="text-fg-muted">{p.email ?? "—"}</span>
                      </TD>
                      <TD>
                        <Badge tone={prospectTone[p.status]}>{humanize(p.status)}</Badge>
                      </TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <SectionHeading title="Run" />
            <DescriptionList
              rows={[
                [
                  "ICP",
                  icp ? (
                    <Link key="i" href={`/icp/${icp.id}`} className="motion-ok text-accent hover:underline">
                      {icp.name}
                    </Link>
                  ) : (
                    "—"
                  ),
                ],
                ["Status", humanize(run.status)],
                ["Started", formatDateTime(run.startedAt, now)],
                ["Finished", run.finishedAt ? formatDateTime(run.finishedAt, now) : "—"],
                ["Cost", formatUsd(run.costUsd)],
              ]}
            />
          </Card>

          <Card>
            <SectionHeading title="What was discarded" />
            <DescriptionList
              rows={[
                ["Already in workspace", run.duplicatesSkipped],
                ["On a suppression list", run.suppressedSkipped],
              ]}
            />
            <p className="border-t border-border px-4 py-2 text-sm text-fg-muted">
              Suppressed records are counted and dropped, never stored. Someone who asked not to be
              contacted should not reappear in your database because a new source found them again.
            </p>
          </Card>
        </div>
      </div>
    </>
  );
}
