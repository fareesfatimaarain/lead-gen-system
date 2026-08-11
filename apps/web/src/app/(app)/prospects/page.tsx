import Link from "next/link";
import { PROSPECT_STATUSES, VERIFICATION_RESULTS } from "@outreach/shared";
import { ClearFilters, FilterSelect, ListKeyboardNav, SearchInput } from "@/components/ui-client";
import {
  Badge,
  EmptyState,
  Pager,
  PageHeader,
  RowLink,
  ScoreBar,
  Table,
  TD,
  TH,
  THead,
  Toolbar,
  TR,
} from "@/components/ui";
import { listProspects } from "@/lib/data";
import { humanize, since } from "@/lib/format";
import { getEnum, getPage, getSearch, getString, PAGE_SIZE, toQueryRecord } from "@/lib/query";
import type { SearchParams } from "@/lib/query";
import { prospectTone, scoreTone, verificationTone } from "@/lib/tone";
import { requirePageSession } from "@/lib/session";

/**
 * Prospects.
 *
 * The verification column sits next to the email on purpose. It is the gate that
 * decides whether a prospect may enter a sequence at all, so it has to be as
 * visible as the address it qualifies rather than buried in a detail pane.
 */
export default async function ProspectsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await requirePageSession();
  const params = await searchParams;

  const page = getPage(params);
  const filters = {
    page,
    q: getSearch(params),
    status: getEnum(params, "status", PROSPECT_STATUSES),
    verification: getEnum(params, "verification", VERIFICATION_RESULTS),
    campaignId: getString(params, "campaign"),
    companyId: getString(params, "company"),
  };

  const { rows, total } = await listProspects(session, filters);
  const now = new Date();

  return (
    <>
      <PageHeader
        title="Prospects"
        description="Every person discovered for this workspace, and where each one stands."
      />

      <Toolbar>
        <SearchInput placeholder="Name, email or company" />
        <FilterSelect
          paramName="status"
          label="Any status"
          options={PROSPECT_STATUSES.map((s) => ({ value: s, label: humanize(s) }))}
        />
        <FilterSelect
          paramName="verification"
          label="Any verification"
          options={VERIFICATION_RESULTS.map((v) => ({ value: v, label: humanize(v) }))}
        />
        <ClearFilters keys={["q", "status", "verification", "campaign", "company"]} />
        <span className="ml-auto tabular text-sm text-fg-subtle">{total} total</span>
      </Toolbar>

      {rows.length === 0 ? (
        <EmptyState
          title={total === 0 && !filters.q && !filters.status ? "No prospects yet" : "Nothing matches those filters"}
          description={
            total === 0 && !filters.q && !filters.status
              ? "Prospects arrive from a discovery run or a CSV import. Both start from an ICP, which is how the system knows what a good fit looks like."
              : "Try clearing a filter. Nothing has been hidden — this workspace simply has no rows matching that combination."
          }
          action={
            <Link
              href="/discovery"
              className="motion-ok inline-flex h-7 items-center rounded border border-transparent bg-accent px-2.5 text-sm font-medium text-accent-fg hover:opacity-90"
            >
              Go to discovery
            </Link>
          }
        />
      ) : (
        <>
          <ListKeyboardNav hrefs={rows.map((r) => `/prospects/${r.id}`)} />
          <Table>
            <THead>
              <TH width="24%">Name</TH>
              <TH width="20%">Company</TH>
              <TH width="22%">Email</TH>
              <TH>Verification</TH>
              <TH>Status</TH>
              <TH align="right">Fit</TH>
              <TH align="right">Last touch</TH>
            </THead>
            <tbody>
              {rows.map((row, i) => (
                <TR key={row.id} href={`/prospects/${row.id}`}>
                  <TD>
                    <span data-row-index={i} className="block">
                      <RowLink href={`/prospects/${row.id}`}>{row.fullName ?? "Unnamed"}</RowLink>
                      {row.title ? <span className="block truncate text-sm text-fg-subtle">{row.title}</span> : null}
                    </span>
                  </TD>
                  <TD>
                    {row.companyId ? (
                      <Link href={`/companies/${row.companyId}`} className="motion-ok text-fg-muted hover:text-accent">
                        {row.companyName ?? row.companyDomain ?? "—"}
                      </Link>
                    ) : (
                      <span className="text-fg-subtle">—</span>
                    )}
                  </TD>
                  <TD mono>
                    {row.email ? (
                      <span className="text-fg-muted">{row.email}</span>
                    ) : (
                      <span className="text-fg-subtle">not found</span>
                    )}
                  </TD>
                  <TD>
                    <Badge tone={verificationTone[row.emailVerification]}>
                      {humanize(row.emailVerification)}
                    </Badge>
                  </TD>
                  <TD>
                    <Badge tone={prospectTone[row.status]}>{humanize(row.status)}</Badge>
                  </TD>
                  <TD align="right">
                    {row.fitScore === null ? (
                      <span className="text-fg-subtle">—</span>
                    ) : (
                      <ScoreBar value={row.fitScore} tone={scoreTone(row.fitScore)} />
                    )}
                  </TD>
                  <TD align="right">
                    <span className="text-fg-subtle">
                      {row.lastContactedAt ? since(row.lastContactedAt, now) : "never"}
                    </span>
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
          <Pager
            basePath="/prospects"
            page={page}
            pageSize={PAGE_SIZE}
            total={total}
            query={toQueryRecord(params, ["q", "status", "verification", "campaign", "company"])}
          />
        </>
      )}
    </>
  );
}
