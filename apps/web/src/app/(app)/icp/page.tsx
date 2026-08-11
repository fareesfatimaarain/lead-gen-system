import Link from "next/link";
import { Card, EmptyState, PageHeader, RowLink, SectionHeading, Table, Tag, TD, TH, THead, TR } from "@/components/ui";
import { listIcps } from "@/lib/data";
import { since, truncate } from "@/lib/format";
import { requirePageSession } from "@/lib/session";

/**
 * ICPs.
 *
 * The first screen a new workspace uses, because nothing downstream can run
 * without one: the strategist plans sources from the ICP, the scorer scores
 * against it, and the composer takes its angle from it.
 */
export default async function IcpListPage() {
  const session = await requirePageSession();
  const icps = await listIcps(session);
  const now = new Date();

  return (
    <>
      <PageHeader
        title="Ideal customer profiles"
        description="Who counts as a fit. Every agent in the system reads this."
        actions={
          <Link
            href="/icp/new"
            prefetch
            className="motion-ok inline-flex h-7 items-center rounded border border-transparent bg-accent px-2.5 text-sm font-medium text-accent-fg hover:opacity-90"
          >
            New ICP
          </Link>
        }
      />

      {icps.length === 0 ? (
        <EmptyState
          title="No ICP defined"
          description="An ICP is a structured description of who to go after — firmographics, persona, qualifying signals and hard disqualifiers. It is deliberately structured rather than free text, so the source strategist and the scorer are reasoning over the same fields instead of guessing."
          action={
            <Link
              href="/icp/new"
              className="motion-ok inline-flex h-7 items-center rounded border border-transparent bg-accent px-2.5 text-sm font-medium text-accent-fg hover:opacity-90"
            >
              Define an ICP
            </Link>
          }
        />
      ) : (
        <div className="p-6">
          <Card>
            <SectionHeading title="Profiles" actions={<span className="tabular text-xs text-fg-subtle">{icps.length}</span>} />
            <Table>
              <THead>
                <TH width="26%">Name</TH>
                <TH>Targets</TH>
                <TH align="right">Campaigns</TH>
                <TH align="right">Scored</TH>
                <TH align="right">Updated</TH>
              </THead>
              <tbody>
                {icps.map((icp) => {
                  const geo = icp.geographies
                    .map((g) => g.city ?? g.region ?? g.country)
                    .filter(Boolean) as string[];
                  return (
                    <TR key={icp.id} href={`/icp/${icp.id}`}>
                      <TD>
                        <RowLink href={`/icp/${icp.id}`}>{icp.name}</RowLink>
                        {icp.description ? (
                          <span className="block text-sm text-fg-subtle">{truncate(icp.description, 70)}</span>
                        ) : null}
                      </TD>
                      <TD>
                        <span className="flex flex-wrap gap-1">
                          {[...icp.industries.slice(0, 3), ...icp.titles.slice(0, 2), ...geo.slice(0, 2)].map(
                            (t, i) => (
                              <Tag key={`${t}-${i}`}>{t}</Tag>
                            ),
                          )}
                          {icp.industries.length + icp.titles.length + geo.length > 7 ? (
                            <span className="text-sm text-fg-subtle">
                              +{icp.industries.length + icp.titles.length + geo.length - 7}
                            </span>
                          ) : null}
                        </span>
                      </TD>
                      <TD align="right">{icp.campaignCount}</TD>
                      <TD align="right">{icp.scoredCount}</TD>
                      <TD align="right">
                        <span className="text-fg-subtle">{since(icp.updatedAt, now)}</span>
                      </TD>
                    </TR>
                  );
                })}
              </tbody>
            </Table>
          </Card>
        </div>
      )}
    </>
  );
}
