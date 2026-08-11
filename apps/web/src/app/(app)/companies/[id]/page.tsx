import Link from "next/link";
import { notFound as nextNotFound } from "next/navigation";
import { isAppError } from "@outreach/shared";
import {
  Badge,
  Card,
  DescriptionList,
  PageHeader,
  RowLink,
  SectionHeading,
  Table,
  Tag,
  TD,
  TH,
  THead,
  TR,
} from "@/components/ui";
import { getCompanyProfile } from "@/lib/data";
import { formatNumber, humanize, since } from "@/lib/format";
import { prospectTone, verificationTone } from "@/lib/tone";
import { requirePageSession } from "@/lib/session";

export default async function CompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePageSession();
  const { id } = await params;

  let data;
  try {
    data = await getCompanyProfile(session, id);
  } catch (err) {
    if (isAppError(err) && err.code === "not_found") nextNotFound();
    throw err;
  }

  const { company, people, signals } = data;
  const now = new Date();

  return (
    <>
      <PageHeader
        title={company.name}
        description={company.domain ?? undefined}
        actions={
          company.websiteUrl ? (
            <a
              href={company.websiteUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="motion-ok inline-flex h-7 items-center rounded border border-border-strong px-2.5 text-sm text-fg hover:bg-surface-hover"
            >
              Visit site
            </a>
          ) : undefined
        }
      />

      <div className="grid gap-4 p-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex flex-col gap-4">
          <Card>
            <SectionHeading
              title="People"
              note="Contact limits apply across this whole list, not per person."
              actions={<span className="tabular text-xs text-fg-subtle">{people.length}</span>}
            />
            {people.length === 0 ? (
              <p className="px-4 py-6 text-sm text-fg-muted">No contacts found at this company yet.</p>
            ) : (
              <Table>
                <THead>
                  <TH>Name</TH>
                  <TH>Title</TH>
                  <TH>Email</TH>
                  <TH>Verification</TH>
                  <TH>Status</TH>
                </THead>
                <tbody>
                  {people.map((p) => (
                    <TR key={p.id} href={`/prospects/${p.id}`}>
                      <TD>
                        <RowLink href={`/prospects/${p.id}`}>{p.fullName ?? "Unnamed"}</RowLink>
                      </TD>
                      <TD>
                        <span className="text-fg-muted">{p.title ?? "—"}</span>
                      </TD>
                      <TD mono>
                        <span className="text-fg-muted">{p.email ?? "—"}</span>
                      </TD>
                      <TD>
                        <Badge tone={verificationTone[p.emailVerification]}>{humanize(p.emailVerification)}</Badge>
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

          <Card>
            <SectionHeading
              title="Company signals"
              note="Sourced facts about the account. Shared by every prospect who works here."
            />
            {signals.length === 0 ? (
              <p className="px-4 py-6 text-sm text-fg-muted">No research has run on this company.</p>
            ) : (
              <ul>
                {signals.map((s) => (
                  <li key={s.id} className="border-b border-border px-4 py-2 last:border-b-0">
                    <div className="flex items-baseline gap-2">
                      <span className="text-xs uppercase tracking-wide text-fg-subtle">{humanize(s.type)}</span>
                      <span className="min-w-0 flex-1 text-base text-fg">{s.value}</span>
                      <span className="tabular shrink-0 text-sm text-fg-muted">
                        {Number(s.confidence).toFixed(2)}
                      </span>
                    </div>
                    <a
                      href={s.sourceUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="motion-ok mt-0.5 block truncate text-sm text-fg-subtle hover:text-accent hover:underline"
                    >
                      {s.sourceName ?? s.sourceUrl}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <SectionHeading title="Firmographics" />
            <DescriptionList
              rows={[
                ["Industry", company.industry ?? "—"],
                ["Sub-industry", company.subIndustry ?? "—"],
                ["Employees", formatNumber(company.employeeCount)],
                ["Size band", company.sizeBand ?? "—"],
                ["Revenue band", company.revenueBand ?? "—"],
                ["Timezone", company.timezone ?? "—"],
              ]}
            />
          </Card>

          <Card>
            <SectionHeading title="Location" />
            <DescriptionList
              rows={[
                ["Address", company.address ?? "—"],
                ["City", company.city ?? "—"],
                ["Region", company.region ?? "—"],
                ["Postal code", company.postalCode ?? "—"],
                ["Country", company.country ?? "—"],
                ["Phone", company.phone ? <span key="p" className="mono text-sm">{company.phone}</span> : "—"],
              ]}
            />
          </Card>

          {company.techStack.length > 0 ? (
            <Card>
              <SectionHeading title="Tech stack" />
              <div className="flex flex-wrap gap-1 px-4 py-3">
                {company.techStack.map((t) => (
                  <Tag key={t}>{t}</Tag>
                ))}
              </div>
            </Card>
          ) : null}

          <Card>
            <SectionHeading title="Provenance" />
            <DescriptionList
              rows={[
                ["Source", company.source ? humanize(company.source) : "—"],
                ["External id", company.externalId ? <span key="e" className="mono text-sm">{company.externalId}</span> : "—"],
                [
                  "Found at",
                  company.sourceUrl ? (
                    <a
                      key="u"
                      href={company.sourceUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="motion-ok text-accent hover:underline"
                    >
                      Link
                    </a>
                  ) : (
                    "—"
                  ),
                ],
                ["Added", `${since(company.createdAt, now)} ago`],
                [
                  "LinkedIn",
                  company.linkedinUrl ? (
                    <a
                      key="l"
                      href={company.linkedinUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="motion-ok text-accent hover:underline"
                    >
                      Profile
                    </a>
                  ) : (
                    "—"
                  ),
                ],
              ]}
            />
          </Card>

          <Card>
            <SectionHeading title="Prospects" />
            <div className="px-4 py-3">
              <Link
                href={`/prospects?company=${company.id}`}
                className="motion-ok text-base text-accent hover:underline"
              >
                Filter prospects to this company
              </Link>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
