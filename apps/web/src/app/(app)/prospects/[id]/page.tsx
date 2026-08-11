import Link from "next/link";
import { notFound as nextNotFound } from "next/navigation";
import { isAppError } from "@outreach/shared";
import {
  Badge,
  Card,
  DescriptionList,
  Notice,
  PageHeader,
  ScoreBar,
  SectionHeading,
  StatusDot,
  Timeline,
  TimelineItem,
} from "@/components/ui";
import { getProspectProfile } from "@/lib/data";
import { formatDateTime, formatDuration, formatUsd, humanize, since, truncate } from "@/lib/format";
import { callTone, emailTone, prospectTone, replyTone, scoreTone, verificationTone } from "@/lib/tone";
import { requirePageSession } from "@/lib/session";
import type { Tone } from "@/components/ui";

/**
 * The unified prospect profile.
 *
 * One chronological story across email, calls and replies rather than three
 * logs, plus the two things that make the story auditable: the signals the
 * agents were allowed to use, each with a source URL and a confidence, and the
 * score breakdown that decided this person was worth contacting.
 */
export default async function ProspectPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePageSession();
  const { id } = await params;

  let data;
  try {
    data = await getProspectProfile(session, id);
  } catch (err) {
    if (isAppError(err) && err.code === "not_found") nextNotFound();
    throw err;
  }

  const { prospect, company, campaign, signals, scores, emails, calls, replies, activities, guardrails } =
    data;
  const now = new Date();
  const name = prospect.fullName ?? ([prospect.firstName, prospect.lastName].filter(Boolean).join(" ") || "Unnamed prospect");
  const topScore = scores[0];

  // One list, sorted once. The whole point of this screen is that a call and the
  // email that preceded it appear in the order they actually happened.
  const events = buildTimeline({ emails, calls, replies, activities });

  return (
    <>
      <PageHeader
        title={name}
        description={[prospect.title, company?.name].filter(Boolean).join(" · ") || undefined}
        actions={<Badge tone={prospectTone[prospect.status]}>{humanize(prospect.status)}</Badge>}
      />

      {prospect.pausedByHumanReply ? (
        <div className="px-6 pt-4">
          <Notice tone="ok">
            A human replied, so every automated step for this prospect is paused. Nothing will be sent
            or dialled until someone clears the pause.
          </Notice>
        </div>
      ) : null}

      {prospect.statusReason ? (
        <div className="px-6 pt-4">
          <Notice tone={prospect.status === "needs_review" ? "warn" : "neutral"}>
            {prospect.statusReason}
          </Notice>
        </div>
      ) : null}

      <div className="grid gap-4 p-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex flex-col gap-4">
          <Card>
            <SectionHeading
              title="Timeline"
              note={
                events.length === 0
                  ? "Nothing has happened to this prospect yet."
                  : `${events.length} events, newest first`
              }
            />
            {events.length === 0 ? (
              <p className="px-4 py-6 text-sm text-fg-muted">
                Discovered {since(prospect.discoveredAt, now)} ago. No contact has been attempted.
              </p>
            ) : (
              <div className="py-2">
                <Timeline>
                  {events.map((e, i) => (
                    <TimelineItem
                      key={e.key}
                      tone={e.tone}
                      title={e.title}
                      meta={formatDateTime(e.at, now)}
                      last={i === events.length - 1}
                    >
                      {e.body}
                    </TimelineItem>
                  ))}
                </Timeline>
              </div>
            )}
          </Card>

          <Card>
            <SectionHeading
              title="Signals"
              note="Facts an agent may reference. Anything not listed here cannot be used in a message."
              actions={<span className="tabular text-xs text-fg-subtle">{signals.length}</span>}
            />
            {signals.length === 0 ? (
              <p className="px-4 py-6 text-sm text-fg-muted">
                No research has run. With no signals, the composer has nothing specific to say — which
                is why an unresearched prospect is not sendable rather than sent generically.
              </p>
            ) : (
              <ul>
                {signals.map((s) => {
                  const confidence = Number(s.confidence);
                  return (
                    <li key={s.id} className="border-b border-border px-4 py-2 last:border-b-0">
                      <div className="flex items-baseline gap-2">
                        <span className="text-xs uppercase tracking-wide text-fg-subtle">{humanize(s.type)}</span>
                        <span className="min-w-0 flex-1 text-base text-fg">{s.value}</span>
                        <span
                          className={
                            confidence >= 0.7
                              ? "tabular shrink-0 text-sm text-ok"
                              : "tabular shrink-0 text-sm text-warn"
                          }
                          title={
                            confidence >= 0.7
                              ? "At or above the confidence floor — usable in a message."
                              : "Below the confidence floor. Recorded, but no agent may cite it."
                          }
                        >
                          {confidence.toFixed(2)}
                        </span>
                      </div>
                      <div className="mt-0.5 flex items-baseline gap-2 text-sm text-fg-subtle">
                        <a
                          href={s.sourceUrl}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="motion-ok truncate hover:text-accent hover:underline"
                        >
                          {s.sourceName ?? s.sourceUrl}
                        </a>
                        <span className="ml-auto shrink-0">{since(s.discoveredAt, now)}</span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          {guardrails.length > 0 ? (
            <Card>
              <SectionHeading
                title="Guardrail blocks"
                note="Outbound actions the engine refused for this prospect."
              />
              <ul>
                {guardrails.map((g) => (
                  <li key={g.id} className="flex items-baseline gap-3 border-b border-border px-4 py-1.5 last:border-b-0">
                    <StatusDot tone="warn" />
                    <span className="mono text-sm text-fg-muted">{g.rule}</span>
                    <span className="min-w-0 flex-1 text-base text-fg">{g.reason}</span>
                    <span className="shrink-0 text-xs text-fg-subtle">{since(g.createdAt, now)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <SectionHeading title="Contact" />
            <DescriptionList
              rows={[
                [
                  "Email",
                  prospect.email ? (
                    <span className="mono text-sm">{prospect.email}</span>
                  ) : (
                    <span className="text-fg-subtle">not found</span>
                  ),
                ],
                [
                  "Verification",
                  <Badge key="v" tone={verificationTone[prospect.emailVerification]}>
                    {humanize(prospect.emailVerification)}
                  </Badge>,
                ],
                ["Email source", prospect.emailSource ? humanize(prospect.emailSource) : "—"],
                [
                  "Phone",
                  prospect.phone ? <span className="mono text-sm">{prospect.phone}</span> : <span className="text-fg-subtle">—</span>,
                ],
                ["Phone type", prospect.phoneType ? humanize(prospect.phoneType) : "—"],
                [
                  "LinkedIn",
                  prospect.linkedinUrl ? (
                    <a
                      href={prospect.linkedinUrl}
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
                ["Timezone", prospect.timezone ?? <span className="text-warn">unknown</span>],
                ["Location", [prospect.city, prospect.country].filter(Boolean).join(", ") || "—"],
              ]}
            />
          </Card>

          {topScore ? (
            <Card>
              <SectionHeading
                title="Fit"
                note={topScore.icpName ? `Scored against ${topScore.icpName}` : undefined}
                actions={<ScoreBar value={topScore.icpFitScore} tone={scoreTone(topScore.icpFitScore)} />}
              />
              {topScore.breakdown.length > 0 ? (
                <ul>
                  {topScore.breakdown.map((c, i) => (
                    <li
                      key={`${c.criterion}-${i}`}
                      className="flex items-baseline gap-2 border-b border-border px-4 py-1.5 last:border-b-0"
                    >
                      <StatusDot tone={c.matched ? "ok" : "neutral"} />
                      <span className="min-w-0 flex-1 text-base text-fg">{c.criterion}</span>
                      <span className="tabular shrink-0 text-sm text-fg-subtle">
                        {Math.round(c.weight * 100)}%
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
              {topScore.reasoning ? (
                <p className="border-t border-border px-4 py-2 text-sm text-fg-muted">{topScore.reasoning}</p>
              ) : null}
              <p className="border-t border-border px-4 py-1.5 text-xs text-fg-subtle">
                {topScore.model ? `${topScore.model} · ` : ""}
                {formatDateTime(topScore.scoredAt, now)}
              </p>
            </Card>
          ) : (
            <Card>
              <SectionHeading title="Fit" />
              <p className="px-4 py-4 text-sm text-fg-muted">
                Not scored yet. A prospect with no score cannot be qualified, and an unqualified
                prospect is never scheduled.
              </p>
            </Card>
          )}

          <Card>
            <SectionHeading title="Company" />
            {company ? (
              <DescriptionList
                rows={[
                  [
                    "Name",
                    <Link key="n" href={`/companies/${company.id}`} className="motion-ok text-accent hover:underline">
                      {company.name}
                    </Link>,
                  ],
                  ["Domain", company.domain ?? "—"],
                  ["Industry", company.industry ?? "—"],
                  ["Employees", company.employeeCount ?? "—"],
                  ["Location", [company.city, company.country].filter(Boolean).join(", ") || "—"],
                  ["Phone", company.phone ?? "—"],
                ]}
              />
            ) : (
              <p className="px-4 py-4 text-sm text-fg-muted">Not linked to a company.</p>
            )}
          </Card>

          <Card>
            <SectionHeading title="Pipeline" />
            <DescriptionList
              rows={[
                [
                  "Campaign",
                  campaign ? (
                    <Link key="c" href={`/campaigns/${campaign.id}`} className="motion-ok text-accent hover:underline">
                      {campaign.name}
                    </Link>
                  ) : (
                    "—"
                  ),
                ],
                ["Step", prospect.currentStepPosition ?? "—"],
                [
                  "Next action",
                  prospect.nextActionAt
                    ? `${humanize(prospect.nextActionType)} · ${formatDateTime(prospect.nextActionAt, now)}`
                    : "none scheduled",
                ],
                ["Emails sent", prospect.emailsSentCount],
                ["Calls placed", prospect.callsPlacedCount],
                ["Voicemails", prospect.voicemailsLeftCount],
                ["Last contacted", prospect.lastContactedAt ? formatDateTime(prospect.lastContactedAt, now) : "never"],
              ]}
            />
          </Card>

          <Card>
            <SectionHeading title="Provenance" />
            <DescriptionList
              rows={[
                ["Source", prospect.source ? humanize(prospect.source) : "—"],
                [
                  "Found at",
                  prospect.sourceUrl ? (
                    <a
                      key="s"
                      href={prospect.sourceUrl}
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
                [
                  "Discovery run",
                  prospect.discoveryRunId ? (
                    <Link
                      key="d"
                      href={`/discovery/${prospect.discoveryRunId}`}
                      className="motion-ok text-accent hover:underline"
                    >
                      View run
                    </Link>
                  ) : (
                    "—"
                  ),
                ],
                ["Discovered", formatDateTime(prospect.discoveredAt, now)],
                ["Enriched", prospect.enrichedAt ? formatDateTime(prospect.enrichedAt, now) : "not yet"],
                ["Researched", prospect.researchedAt ? formatDateTime(prospect.researchedAt, now) : "not yet"],
              ]}
            />
          </Card>
        </div>
      </div>
    </>
  );
}

interface TimelineEvent {
  key: string;
  at: Date;
  tone: Tone;
  title: React.ReactNode;
  body?: React.ReactNode;
}

type Profile = Awaited<ReturnType<typeof getProspectProfile>>;

function buildTimeline(data: Pick<Profile, "emails" | "calls" | "replies" | "activities">): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  for (const e of data.emails) {
    events.push({
      key: `email-${e.id}`,
      at: e.sentAt ?? e.createdAt,
      tone: emailTone[e.state],
      title: (
        <span>
          <span className="text-fg-muted">{e.direction === "outbound" ? "Email" : "Inbound email"}</span>{" "}
          <span className="font-medium">{e.subject}</span>{" "}
          <span className="text-sm text-fg-subtle">({humanize(e.state)})</span>
        </span>
      ),
      body: (
        <div>
          <p className="whitespace-pre-wrap">{truncate(e.bodyText, 400)}</p>
          {e.reasoning ? (
            <p className="mt-1 border-l-2 border-border pl-2 text-fg-subtle">Why: {e.reasoning}</p>
          ) : null}
          {e.bouncedAt ? (
            <p className="mt-1 text-danger">Bounced ({e.bounceType ?? "unknown type"}).</p>
          ) : null}
        </div>
      ),
    });
  }

  for (const c of data.calls) {
    events.push({
      key: `call-${c.id}`,
      at: c.startedAt ?? c.createdAt,
      tone: c.disposition ? callTone[c.disposition] : "neutral",
      title: (
        <span>
          <Link href={`/calls/${c.id}`} className="motion-ok text-fg-muted hover:text-accent">
            Call
          </Link>{" "}
          <span className="font-medium">{c.disposition ? humanize(c.disposition) : humanize(c.status)}</span>{" "}
          {c.durationSeconds ? (
            <span className="tabular text-sm text-fg-subtle">{formatDuration(c.durationSeconds)}</span>
          ) : null}
          {c.costUsd ? <span className="ml-1 text-sm text-fg-subtle">{formatUsd(c.costUsd)}</span> : null}
        </span>
      ),
      body: (
        <div>
          {c.permissionGranted === false ? (
            <p className="text-danger">
              The prospect declined to continue after the permission ask. The call ended there.
            </p>
          ) : null}
          {c.summary ? <p>{c.summary}</p> : null}
          {c.nextStep ? <p className="mt-1 text-fg">Next step: {c.nextStep}</p> : null}
        </div>
      ),
    });
  }

  for (const r of data.replies) {
    events.push({
      key: `reply-${r.id}`,
      at: r.receivedAt,
      tone: replyTone[r.intent],
      title: (
        <span>
          <span className="text-fg-muted">Reply</span>{" "}
          <span className="font-medium">{humanize(r.intent)}</span>{" "}
          <span className="text-sm text-fg-subtle">from {r.fromEmail}</span>
        </span>
      ),
      body: <p className="whitespace-pre-wrap">{truncate(r.parsedBody ?? r.rawBody, 500)}</p>,
    });
  }

  // Activities that are not already represented by a richer row above. Rendering
  // both would show every send twice.
  const covered = new Set(["email_sent", "email_replied", "email_bounced", "call_placed", "call_completed"]);
  for (const a of data.activities) {
    if (covered.has(a.type)) continue;
    events.push({
      key: `activity-${a.id}`,
      at: a.occurredAt,
      tone: a.type === "guardrail_block" ? "warn" : "neutral",
      title: (
        <span>
          <span className="text-fg-muted">{humanize(a.type)}</span> {a.summary ?? ""}
        </span>
      ),
      body: a.actor ? <span className="text-fg-subtle">{a.actor}</span> : undefined,
    });
  }

  return events.sort((a, b) => b.at.getTime() - a.at.getTime());
}
