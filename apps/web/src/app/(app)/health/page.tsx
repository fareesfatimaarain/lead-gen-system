import { Badge, Card, PageHeader, Stat, StatRow, StatusDot, Table, TD, TH, THead, TR } from "@/components/ui";
import { getSendingHealth, listGuardrailEvents } from "@/lib/data";
import { formatDateTime, formatPercent } from "@/lib/format";
import { requirePageSession } from "@/lib/session";

export default async function SendingHealthPage() {
  const session = await requirePageSession();
  const [health, guardrails] = await Promise.all([
    getSendingHealth(session),
    listGuardrailEvents(session, { page: 1 }),
  ]);

  const authStatus = health.mailboxes.every(
    (m) => m.spfPass && m.dkimPass && m.dmarcPass,
  )
    ? "passing"
    : health.mailboxes.length === 0
      ? "unconfigured"
      : "failing";

  const volume = health.volume;
  const bounceRate = volume.sent > 0 ? volume.bounced / volume.sent : 0;
  const complaintRate = volume.sent > 0 ? volume.complained / volume.sent : 0;
  const settings = health.settings;

  return (
    <>
      <PageHeader
        title="Sending Health"
        description="Monitor domain reputation, mailbox health status, bounce/complaint rates, and guardrail throttle reasons."
      />

      <div className="flex flex-col gap-6 p-4">
        <StatRow>
          <Stat
            label="Domain Auth Status"
            value={authStatus === "passing" ? "Passing" : authStatus === "unconfigured" ? "Not configured" : "Failing"}
            hint="SPF, DKIM, DMARC across connected mailboxes"
            tone={authStatus === "passing" ? "ok" : authStatus === "unconfigured" ? "neutral" : "danger"}
          />
          <Stat
            label="Bounce Rate (7d)"
            value={formatPercent(bounceRate * 100)}
            hint={`Hard limit: ${settings ? `${Number(settings.bounceRatePausePct).toFixed(1)}%` : "3.0%"}`}
            tone={bounceRate > Number(settings?.bounceRatePausePct ?? 3) / 100 ? "danger" : "ok"}
          />
          <Stat
            label="Spam Complaint Rate (7d)"
            value={formatPercent(complaintRate * 100, 2)}
            hint={`Hard limit: ${settings ? `${Number(settings.complaintRatePausePct).toFixed(2)}%` : "0.10%"}`}
            tone={complaintRate > Number(settings?.complaintRatePausePct ?? 0.1) / 100 ? "danger" : "ok"}
          />
          <Stat
            label="Sent (7d)"
            value={volume.sent}
            hint={`${volume.failed} failed`}
            tone={volume.failed > 0 ? "warn" : "neutral"}
          />
          <Stat
            label="Guardrail Throttles (7d)"
            value={health.blocks.reduce((sum, b) => sum + b.n, 0)}
            hint="Blocked by frequency/cadence rules"
            tone={health.blocks.length > 0 ? "warn" : "neutral"}
          />
        </StatRow>

        <div className="flex flex-col gap-3">
          <h3 className="text-xs font-semibold text-fg">Mailbox Health</h3>
          {health.mailboxes.length === 0 ? (
            <Card className="p-4 text-center text-xs text-fg-subtle">
              No mailboxes connected yet. Domain auth cannot be verified until a mailbox exists.
            </Card>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Mailbox</TH>
                  <TH>Status</TH>
                  <TH align="right">Cap / Day</TH>
                  <TH align="right">Sent Today</TH>
                  <TH>SPF</TH>
                  <TH>DKIM</TH>
                  <TH>DMARC</TH>
                  <TH>Paused Reason</TH>
                </TR>
              </THead>
              <tbody>
                {health.mailboxes.map((m) => (
                  <TR key={m.id}>
                    <TD mono>{m.email}</TD>
                    <TD>
                      <span className="flex items-center gap-1.5">
                        <StatusDot tone={m.status === "healthy" || m.status === "warming" ? "ok" : m.status === "paused" ? "warn" : "neutral"} />
                        <span className="text-xs">{m.status}</span>
                      </span>
                    </TD>
                    <TD align="right" mono>{m.currentDailyCap}</TD>
                    <TD align="right" mono>{m.sentToday}</TD>
                    <TD><Badge tone={m.spfPass ? "ok" : "danger"}>SPF</Badge></TD>
                    <TD><Badge tone={m.dkimPass ? "ok" : "danger"}>DKIM</Badge></TD>
                    <TD><Badge tone={m.dmarcPass ? "ok" : "danger"}>DMARC</Badge></TD>
                    <TD>{m.pausedReason ?? "—"}</TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          )}
        </div>

        <div className="flex flex-col gap-3">
          <h3 className="text-xs font-semibold text-fg">Recent Guardrail Throttling</h3>
          {guardrails.rows.length === 0 ? (
            <Card className="p-4 text-center text-xs text-fg-subtle">
              No recent guardrail blocks logged. All outbound actions are operating within policy thresholds — or nothing has been scheduled yet.
            </Card>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Rule Triggered</TH>
                  <TH>Channel</TH>
                  <TH>Reason</TH>
                  <TH>Timestamp</TH>
                </TR>
              </THead>
              <tbody>
                {guardrails.rows.map((ev) => (
                  <TR key={ev.id}>
                    <TD mono>{ev.rule}</TD>
                    <TD>
                      <Badge tone="neutral">{ev.channel}</Badge>
                    </TD>
                    <TD className="max-w-md truncate">{ev.reason}</TD>
                    <TD>{formatDateTime(ev.createdAt)}</TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          )}
        </div>
      </div>
    </>
  );
}
