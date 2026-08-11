import { eq, schema, withOrg } from "@outreach/db";
import { Card, PageHeader } from "@/components/ui";
import { requirePageSession } from "@/lib/session";
import { ThemeToggle } from "./ThemeToggle";

/**
 * Settings.
 *
 * Phase 1 shows the sending policy read-only. The values are real — they are the
 * defaults the guardrail engine will read in Phase 4 — but nothing enforces them
 * yet, and the page says so rather than implying protection that does not exist.
 */
export default async function SettingsPage() {
  const session = await requirePageSession();

  const rows = await withOrg({ orgId: session.orgId, userId: session.userId }, (tx) =>
    tx.select().from(schema.settings).where(eq(schema.settings.orgId, session.orgId)).limit(1),
  );
  const s = rows[0];

  const groups: { title: string; note: string; rows: [string, string][] }[] = s
    ? [
        {
          title: "Volume and reputation",
          note: "Conservative by default. Raising a cap should be a decision, not an inherited setting.",
          rows: [
            ["Daily cap per mailbox", String(s.mailboxDailyCap)],
            ["Warm-up period", `${s.warmupWeeks} weeks`],
            ["Interval between sends", `${s.sendIntervalMinSeconds}–${s.sendIntervalMaxSeconds}s, randomized`],
            ["Pause mailbox above bounce rate", `${s.bounceRatePausePct}%`],
            ["Pause mailbox above complaint rate", `${s.complaintRatePausePct}%`],
          ],
        },
        {
          title: "Frequency and consent",
          note: "Hard ceilings. A campaign can lower these but never raise them past this point.",
          rows: [
            ["Max emails per prospect", String(s.maxEmailsPerProspect)],
            ["Max calls per prospect", String(s.maxCallsPerProspect)],
            ["Cross-campaign cooldown", `${s.crossCampaignCooldownDays} days`],
            ["One contact per company at a time", s.oneContactPerCompany ? "On" : "Off"],
            ["Calling hours (prospect local)", `${s.callWindowStartHour}:00–${s.callWindowEndHour}:00`],
            ["Minimum days between calls", String(s.minDaysBetweenCalls)],
            ["Maximum voicemails", String(s.maxVoicemails)],
            ["Send on weekends", s.sendOnWeekends ? "Yes" : "No"],
            ["Respect public holidays", s.respectPublicHolidays ? "Yes" : "No"],
          ],
        },
        {
          title: "Content",
          note: "Enforced by a deterministic validator after generation, not by the prompt alone.",
          rows: [
            ["First-touch word limit", String(s.maxFirstTouchWords)],
            ["Minimum signal confidence to cite", String(s.minSignalConfidence)],
            ["Spam-score threshold", String(s.spamScoreThreshold)],
            ["Banned phrases", `${s.bannedPhrases.length} configured`],
            [
              "Open tracking",
              s.openTrackingEnabled
                ? "On"
                : "Off — a tracking pixel is a beacon the recipient did not agree to, and it hurts deliverability",
            ],
          ],
        },
        {
          title: "Qualification and approval",
          note: "",
          rows: [
            ["Minimum ICP fit score", String(s.minIcpFitScore)],
            ["Approval mode for new campaigns", s.approvalModeDefault ? "On" : "Off"],
            [
              "Monthly spend cap",
              s.monthlySpendCapUsd ? `$${s.monthlySpendCapUsd}` : "Not set",
            ],
          ],
        },
      ]
    : [];

  return (
    <>
      <PageHeader title="Settings" description={`${session.orgName} · ${session.orgSlug}`} />

      <div className="flex max-w-3xl flex-col gap-4 p-6">
        <Card>
          <div className="border-b border-border px-4 py-2.5">
            <h2 className="text-sm font-medium text-fg">Appearance</h2>
          </div>
          <div className="px-4 py-3">
            <ThemeToggle />
          </div>
        </Card>

        <p className="text-sm text-fg-muted">
          These are the values the guardrail engine will read. Nothing enforces them yet — the
          engine and its editor arrive in Phase 4, before any send path exists.
        </p>

        {groups.map((group) => (
          <Card key={group.title}>
            <div className="border-b border-border px-4 py-2.5">
              <h2 className="text-sm font-medium text-fg">{group.title}</h2>
              {group.note ? <p className="mt-0.5 text-xs text-fg-subtle">{group.note}</p> : null}
            </div>
            <dl>
              {group.rows.map(([label, value]) => (
                <div
                  key={label}
                  className="flex items-baseline justify-between gap-4 border-b border-border px-4 py-2 last:border-b-0"
                >
                  <dt className="text-base text-fg-muted">{label}</dt>
                  <dd className="text-right text-base text-fg tabular">{value}</dd>
                </div>
              ))}
            </dl>
          </Card>
        ))}
      </div>
    </>
  );
}
