import { ClearFilters, ListKeyboardNav, SearchInput } from "@/components/ui-client";
import {
  EmptyState,
  Pager,
  PageHeader,
  RowLink,
  Table,
  TD,
  TH,
  THead,
  Toolbar,
  TR,
} from "@/components/ui";
import { listCompanies } from "@/lib/data";
import { formatNumber, humanize, since } from "@/lib/format";
import { getPage, getSearch, getString, PAGE_SIZE, toQueryRecord } from "@/lib/query";
import type { SearchParams } from "@/lib/query";
import { requirePageSession } from "@/lib/session";

/**
 * Companies.
 *
 * Separate from prospects because the org setting "one contact per company" is
 * enforced at this level: the account is the unit a prospect might be annoyed
 * on behalf of, not the individual inbox.
 */
export default async function CompaniesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await requirePageSession();
  const params = await searchParams;
  const page = getPage(params);

  const { rows, total } = await listCompanies(session, {
    page,
    q: getSearch(params),
    industry: getString(params, "industry"),
  });
  const now = new Date();

  return (
    <>
      <PageHeader
        title="Companies"
        description="Accounts discovered for this workspace. Contact limits are applied per company, not per person."
      />

      <Toolbar>
        <SearchInput placeholder="Name or domain" />
        <ClearFilters keys={["q", "industry"]} />
        <span className="ml-auto tabular text-sm text-fg-subtle">{total} total</span>
      </Toolbar>

      {rows.length === 0 ? (
        <EmptyState
          title={total === 0 ? "No companies yet" : "Nothing matches that search"}
          description="Companies are created by discovery runs and by CSV import, and deduplicated on domain so a re-run updates rather than duplicates."
        />
      ) : (
        <>
          <ListKeyboardNav hrefs={rows.map((r) => `/companies/${r.id}`)} />
          <Table>
            <THead>
              <TH width="26%">Company</TH>
              <TH width="20%">Domain</TH>
              <TH>Industry</TH>
              <TH align="right">Employees</TH>
              <TH>Location</TH>
              <TH align="right">People</TH>
              <TH align="right">Added</TH>
            </THead>
            <tbody>
              {rows.map((row, i) => (
                <TR key={row.id} href={`/companies/${row.id}`}>
                  <TD>
                    <span data-row-index={i} className="block">
                      <RowLink href={`/companies/${row.id}`}>{row.name}</RowLink>
                      {row.source ? (
                        <span className="block text-sm text-fg-subtle">{humanize(row.source)}</span>
                      ) : null}
                    </span>
                  </TD>
                  <TD mono>
                    {row.domain ? (
                      <span className="text-fg-muted">{row.domain}</span>
                    ) : (
                      <span className="text-fg-subtle">none</span>
                    )}
                  </TD>
                  <TD>
                    <span className="text-fg-muted">{row.industry ?? "—"}</span>
                  </TD>
                  <TD align="right">
                    <span className="text-fg-muted">{formatNumber(row.employeeCount)}</span>
                  </TD>
                  <TD>
                    <span className="text-fg-muted">
                      {[row.city, row.country].filter(Boolean).join(", ") || "—"}
                    </span>
                  </TD>
                  <TD align="right">{row.prospectCount}</TD>
                  <TD align="right">
                    <span className="text-fg-subtle">{since(row.createdAt, now)}</span>
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
          <Pager
            basePath="/companies"
            page={page}
            pageSize={PAGE_SIZE}
            total={total}
            query={toQueryRecord(params, ["q", "industry"])}
          />
        </>
      )}
    </>
  );
}
