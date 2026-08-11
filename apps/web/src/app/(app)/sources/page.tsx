import Link from "next/link";
import { CATEGORY_LABELS, CATEGORY_ORDER, publicRegistry, SOURCE_CATEGORIES } from "@outreach/adapters/registry";
import { can, rankSourcesForIcp } from "@outreach/shared";
import { Badge, Card, EmptyState, Notice, PageHeader, SectionHeading, Table, TD, TH, THead, TR } from "@/components/ui";
import { listCredentials } from "@/lib/credentials";
import { getSourcePerformanceSummary, listDataSources, listIcps } from "@/lib/data";
import { formatUsd, humanize } from "@/lib/format";
import { requirePageSession } from "@/lib/session";
import { CsvImportForm } from "./CsvImportForm";
import { SourceForm } from "./SourceForm";
import { SourceRegistryGrid } from "./SourceRegistryGrid";
import { RemoveSourceButton, StatusForm } from "./SourceRowControls";

/**
 * Sources.
 *
 * What discovery is allowed to use, and how heavily. The top section is
 * rendered from the adapter registry — the same one Connections uses — so a
 * "source" here is never a made-up label; it is either a real, callable
 * adapter or, in the bottom section, a source the org tracks manually and has
 * chosen not to automate.
 */
export default async function SourcesPage() {
  const session = await requirePageSession();

  const [icps, dataSources, credentials, performance] = await Promise.all([
    listIcps(session),
    listDataSources(session),
    listCredentials(session),
    getSourcePerformanceSummary(session),
  ]);

  const registry = publicRegistry().filter((p) => SOURCE_CATEGORIES.includes(p.category));
  const groups = CATEGORY_ORDER.filter((c) => SOURCE_CATEGORIES.includes(c))
    .map((category) => ({
      category,
      label: CATEGORY_LABELS[category],
      providerIds: registry.filter((p) => p.category === category).map((p) => p.id),
    }))
    .filter((g) => g.providerIds.length > 0);

  const manualSources = dataSources.filter((d) => !d.provider);
  const activeIcp = icps[0] ?? null;

  const history = performance.map((p) => ({
    source: p.source,
    leadsReturned: p.leadsReturned ?? 0,
    leadsQualified: p.leadsQualified ?? 0,
    costUsd: Number(p.costUsd ?? 0),
    avgFitScore: p.avgFitScore ? Number(p.avgFitScore) : null,
    latencyMs: p.avgLatencyMs ?? null,
  }));

  const ranked = activeIcp
    ? rankSourcesForIcp(
        { industries: activeIcp.industries, titles: activeIcp.titles, geographies: activeIcp.geographies },
        dataSources
          .filter((d) => d.status === "active")
          .map((d) => ({
            // Registry sources rank on their stable provider id, which is what
            // `source_performance.source` is written with — a manual source has
            // no provider, so it falls back to its own name.
            id: d.provider ?? d.name,
            name: d.name,
            kind: d.kind as "lead_source" | "enrichment" | "verification" | "search" | "crm",
            status: d.status as "active" | "paused" | "disabled",
            weight: d.weight,
            config: d.config ?? {},
          })),
        history,
      )
    : [];

  return (
    <>
      <PageHeader
        title="Sources"
        description="Discovery only uses what is active here. Connect a provider's credential on the Connections page, add it as a source, and set how heavily it ranks against the others."
        actions={
          <Link
            href="/connections"
            className="motion-ok inline-flex h-7 items-center rounded border border-transparent bg-accent px-2.5 text-sm font-medium text-accent-fg hover:opacity-90"
          >
            Manage credentials
          </Link>
        }
      />

      <div className="flex flex-col gap-6 p-4">
        <SourceRegistryGrid
          groups={groups}
          registry={registry}
          credentials={credentials}
          dataSources={dataSources}
          canManage={can(session.role, "write")}
          canTest={can(session.role, "manage_credentials")}
        />

        {activeIcp ? (
          <Card>
            <SectionHeading
              title="Ranking"
              note={`Against "${activeIcp.name}" — the ICP a discovery run would plan from right now.`}
            />
            {ranked.length === 0 ? (
              <p className="px-4 py-4 text-sm text-fg-muted">No active source is enabled yet.</p>
            ) : (
              <Table>
                <THead>
                  <TH>Source</TH>
                  <TH>Kind</TH>
                  <TH align="right">Weight</TH>
                  <TH align="right">Score</TH>
                  <TH>Reason</TH>
                </THead>
                <tbody>
                  {ranked.map((source, index) => (
                    <TR key={source.id}>
                      <TD>
                        {index === 0 ? <Badge tone="accent">1st</Badge> : null} {source.name}
                      </TD>
                      <TD>
                        <span className="text-fg-muted">{humanize(source.kind)}</span>
                      </TD>
                      <TD align="right">{source.weight}</TD>
                      <TD align="right" className="tabular">
                        {source.score}
                      </TD>
                      <TD>
                        <span className="text-fg-subtle">{source.reason}</span>
                      </TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        ) : (
          <Notice>
            No ICP is defined yet, so there is nothing to rank sources against. Every source above stays
            available once one exists.
          </Notice>
        )}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="flex flex-col gap-4 lg:col-span-8">
            <Card>
              <SectionHeading
                title="Manual sources"
                note="Tracked here for ranking only — referrals, purchased lists, anything with no adapter to call."
              />
              {manualSources.length === 0 ? (
                <EmptyState
                  title="No manual sources"
                  description="Add one if you want it weighed in the ranking above even though nothing here can query it automatically."
                />
              ) : (
                <Table>
                  <THead>
                    <TH>Name</TH>
                    <TH>Kind</TH>
                    <TH>Status</TH>
                    <TH align="right">Weight</TH>
                  </THead>
                  <tbody>
                    {manualSources.map((source) => (
                      <TR key={source.id}>
                        <TD>{source.name}</TD>
                        <TD>
                          <Badge tone="neutral">{humanize(source.kind)}</Badge>
                        </TD>
                        <TD>
                          <StatusForm id={source.id} status={source.status} canManage />
                        </TD>
                        <TD align="right" className="flex items-center justify-end gap-2">
                          <span className="tabular">{source.weight}</span>
                          <RemoveSourceButton id={source.id} />
                        </TD>
                      </TR>
                    ))}
                  </tbody>
                </Table>
              )}
            </Card>
          </div>

          <div className="flex flex-col gap-4 lg:col-span-4">
            <Card className="p-4">
              <h3 className="mb-3 text-xs font-semibold text-fg">Add a manual source</h3>
              <SourceForm />
            </Card>

            <Card className="p-4">
              <h3 className="mb-1 text-xs font-semibold text-fg">Import a CSV</h3>
              <p className="mb-3 text-xs text-fg-subtle">
                Creates prospects directly — no adapter, no discovery run. Every row still passes the
                suppression check and the same dedup as any other source.
              </p>
              <CsvImportForm />
            </Card>
          </div>
        </div>
      </div>
    </>
  );
}
