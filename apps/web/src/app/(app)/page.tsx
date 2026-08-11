import Link from "next/link";
import { PROVIDERS } from "@outreach/adapters/registry";
import {
  Badge,
  Card,
  EmptyState,
  PageHeader,
  SectionHeading,
  Stat,
  StatRow,
  StatusDot,
  Table,
  TD,
  TH,
  THead,
  TR,
  RowLink,
} from "@/components/ui";
import { getDashboard } from "@/lib/data";
import { formatDateTime, humanize, since } from "@/lib/format";
import { listCredentials } from "@/lib/credentials";
import { requirePageSession } from "@/lib/session";

/**
 * Dashboard.
 *
 * Two questions, in order: is anything owed to a human right now, and is the
 * machinery configured. Volume comes third and deliberately without a trend
 * line — a chart of sends going up is the exact incentive this product exists
 * to resist.
 */
export default async function DashboardPage() {
  const session = await requirePageSession();
  const [credentials, data] = await Promise.all([listCredentials(session), getDashboard(session)]);

  const active = credentials.filter((c) => c.status === "active");
  const failing = credentials.filter((c) => c.status === "failing");
  const connected = new Set(active.map((c) => c.provider));
  const now = new Date();

  const readiness = [
    {
      label: "A model provider is connected",
      done: PROVIDERS.some((p) => p.category === "llm" && connected.has(p.id)),
      href: "/connections",
      why: "Every agent — source strategy, research, scoring, message writing — runs through it.",
    },
    {
      label: "An ICP is defined",
      done: data.icpCount > 0,
      href: "/icp",
      why: "Nothing can be discovered or scored until the system knows who counts as a fit.",
    },
    {
      label: "A sending mailbox is connected",
      done: data.mailboxCount > 0,
      href: "/mailboxes",
      why: "Needed before any email can leave, and before SPF, DKIM and DMARC can be checked.",
    },
    {
      label: "A campaign is active",
      done: data.activeCampaigns > 0,
      href: "/campaigns",
      why: "A campaign binds an ICP to a sequence and a mailbox. Without one, nothing is scheduled.",
    },
  ];
  const remaining = readiness.filter((r) => !r.done);

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={`${session.orgName} · signed in as ${session.role}`}
        actions={
          <Link
            href="/discovery"
            prefetch
            className="motion-ok inline-flex h-7 items-center rounded border border-transparent bg-accent px-2.5 text-sm font-medium text-accent-fg hover:opacity-90"
          >
            Find prospects
          </Link>
        }
      />

      <StatRow>
        <Stat
          label="Waiting on you"
          value={data.pendingApproval + data.unhandledReplies}
          hint={`${data.pendingApproval} drafts · ${data.unhandledReplies} replies`}
          tone={data.pendingApproval + data.unhandledReplies > 0 ? "accent" : "neutral"}
        />
        <Stat label="Prospects" value={data.pipeline?.total ?? 0} hint={`${data.pipeline?.qualified ?? 0} qualified`} />
        <Stat label="In conversation" value={data.pipeline?.engaged ?? 0} hint={`${data.pipeline?.booked ?? 0} meetings booked`} tone={(data.pipeline?.engaged ?? 0) > 0 ? "ok" : "neutral"} />
        <Stat label="Sent, last 24h" value={data.sentToday} hint={`${data.callsWeek} calls this week`} />
        <Stat
          label="Blocked by guardrails"
          value={data.blocksWeek}
          hint="Last 7 days — see Sending health"
          tone={data.blocksWeek > 0 ? "warn" : "neutral"}
        />
      </StatRow>

      <div className="grid gap-4 p-6 lg:grid-cols-2">
        {remaining.length > 0 ? (
          <Card>
            <SectionHeading
              title="Setup"
              note="Nothing sends until these are done."
              actions={
                <span className="tabular text-xs text-fg-subtle">
                  {readiness.length - remaining.length}/{readiness.length}
                </span>
              }
            />
            <ul>
              {readiness.map((item) => (
                <li key={item.label} className="flex items-start gap-2.5 border-b border-border px-4 py-2.5 last:border-b-0">
                  <span className="mt-1.5">
                    <StatusDot tone={item.done ? "ok" : "neutral"} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className={item.done ? "text-base text-fg-muted line-through" : "text-base text-fg"}>
                      {item.label}
                    </p>
                    {!item.done ? <p className="mt-0.5 text-sm text-fg-subtle">{item.why}</p> : null}
                  </div>
                  {!item.done ? (
                    <Link href={item.href} className="motion-ok shrink-0 text-sm text-accent hover:underline">
                      Set up
                    </Link>
                  ) : null}
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        <Card>
          <SectionHeading
            title="Needs a person"
            note="Everything here is paused until someone looks at it."
          />
          <ul>
            <li className="flex items-center gap-3 border-b border-border px-4 py-2.5">
              <StatusDot tone={data.pendingApproval > 0 ? "warn" : "neutral"} />
              <Link href="/approvals" className="motion-ok flex-1 text-base text-fg hover:text-accent">
                Drafts awaiting approval
              </Link>
              <span className="tabular text-base text-fg-muted">{data.pendingApproval}</span>
            </li>
            <li className="flex items-center gap-3 border-b border-border px-4 py-2.5">
              <StatusDot tone={data.unhandledReplies > 0 ? "accent" : "neutral"} />
              <Link href="/inbox" className="motion-ok flex-1 text-base text-fg hover:text-accent">
                Replies not yet handled
              </Link>
              <span className="tabular text-base text-fg-muted">{data.unhandledReplies}</span>
            </li>
            <li className="flex items-center gap-3 border-b border-border px-4 py-2.5">
              <StatusDot tone={(data.pipeline?.needsReview ?? 0) > 0 ? "warn" : "neutral"} />
              <Link href="/prospects?status=needs_review" className="motion-ok flex-1 text-base text-fg hover:text-accent">
                Prospects flagged for review
              </Link>
              <span className="tabular text-base text-fg-muted">{data.pipeline?.needsReview ?? 0}</span>
            </li>
            <li className="flex items-center gap-3 px-4 py-2.5">
              <StatusDot tone={(data.pipeline?.pausedByReply ?? 0) > 0 ? "ok" : "neutral"} />
              <Link href="/prospects" className="motion-ok flex-1 text-base text-fg hover:text-accent">
                Paused because a human replied
              </Link>
              <span className="tabular text-base text-fg-muted">{data.pipeline?.pausedByReply ?? 0}</span>
            </li>
          </ul>
        </Card>

        <Card>
          <SectionHeading
            title="Scheduled next"
            note="The orchestrator acts on these when they come due."
          />
          {data.dueSoon.length === 0 ? (
            <p className="px-4 py-6 text-sm text-fg-muted">Nothing is scheduled.</p>
          ) : (
            <Table>
              <THead>
                <TH>Prospect</TH>
                <TH>Action</TH>
                <TH align="right">Due</TH>
              </THead>
              <tbody>
                {data.dueSoon.map((row) => (
                  <TR key={row.id} href={`/prospects/${row.id}`}>
                    <TD>
                      <RowLink href={`/prospects/${row.id}`}>{row.fullName ?? "Unnamed"}</RowLink>
                      {row.companyName ? (
                        <span className="ml-1.5 text-sm text-fg-subtle">{row.companyName}</span>
                      ) : null}
                    </TD>
                    <TD>
                      <span className="text-fg-muted">{humanize(row.nextActionType)}</span>
                    </TD>
                    <TD align="right">
                      <span className="text-fg-muted">{formatDateTime(row.nextActionAt, now)}</span>
                    </TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <Card>
          <SectionHeading
            title="Providers"
            actions={failing.length > 0 ? <Badge tone="danger">{failing.length} failing</Badge> : undefined}
          />
          {credentials.length === 0 ? (
            <p className="px-4 py-6 text-sm text-fg-muted">
              Nothing connected yet.{" "}
              <Link href="/connections" className="text-accent hover:underline">
                Add a provider
              </Link>
              .
            </p>
          ) : (
            <ul>
              {credentials.map((c) => (
                <li key={c.id} className="flex items-center gap-2.5 border-b border-border px-4 py-2 last:border-b-0">
                  <StatusDot tone={c.status === "active" ? "ok" : c.status === "failing" ? "danger" : "neutral"} />
                  <span className="text-base text-fg">
                    {PROVIDERS.find((p) => p.id === c.provider)?.name ?? c.provider}
                  </span>
                  <span className="mono text-xs text-fg-subtle">{c.maskedHint}</span>
                  <span className="ml-auto text-xs text-fg-subtle">
                    {c.status === "active" ? "Verified" : c.status === "failing" ? "Failing" : "Not tested"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="lg:col-span-2">
          <SectionHeading
            title="Recent activity"
            actions={
              <Link href="/activity" className="motion-ok text-sm text-fg-muted hover:text-fg">
                View all
              </Link>
            }
          />
          {data.recent.length === 0 ? (
            <EmptyState
              title="Nothing has happened yet"
              description="Every discovery, enrichment, message and call writes one line here. Define an ICP to start the loop."
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
            <ul>
              {data.recent.map((a) => (
                <li key={a.id} className="flex items-baseline gap-3 border-b border-border px-4 py-1.5 last:border-b-0">
                  <span className="w-32 shrink-0 text-sm text-fg-subtle">{humanize(a.type)}</span>
                  <span className="min-w-0 flex-1 truncate text-base text-fg">{a.summary ?? "—"}</span>
                  {a.prospectId ? (
                    <Link href={`/prospects/${a.prospectId}`} className="motion-ok shrink-0 text-sm text-fg-muted hover:text-accent">
                      {a.prospectName ?? "Prospect"}
                    </Link>
                  ) : null}
                  <span className="tabular w-10 shrink-0 text-right text-xs text-fg-subtle">
                    {since(a.occurredAt, now)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
