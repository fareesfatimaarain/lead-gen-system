import { Badge, Card, EmptyState, PageHeader, StatusDot, Table, TD, TH, THead, TR } from "@/components/ui";
import { listMailboxes } from "@/lib/data";
import { requirePageSession } from "@/lib/session";
import { MailboxForm } from "./MailboxForm";

export default async function MailboxesPage() {
  const session = await requirePageSession();
  const mailboxes = await listMailboxes(session);

  return (
    <>
      <PageHeader
        title="Mailboxes"
        description="Manage sending mailboxes, warmup schedules, daily cap ramps, and domain auth protocol checks."
      />

      <div className="flex flex-col gap-6 p-4">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* List of mailboxes */}
          <div className="flex flex-col gap-4 lg:col-span-8">
            {mailboxes.length === 0 ? (
              <Card className="p-4">
                <EmptyState
                  title="No mailboxes connected"
                  description="Connect at least one mailbox before sending email. New mailboxes ramp from 40 sends/day."
                />
              </Card>
            ) : (
              <Table>
                <THead>
                  <TH>Mailbox Email</TH>
                  <TH>Status</TH>
                  <TH align="right">Cap / Day</TH>
                  <TH align="right">Sent Today</TH>
                  <TH>Domain Auth (SPF / DKIM / DMARC)</TH>
                </THead>
                <tbody>
                  {mailboxes.map((m) => {
                    const statusTone = m.status === "healthy" || m.status === "warming" ? "ok" : m.status === "paused" ? "warn" : "danger";

                    return (
                      <TR key={m.id}>
                        <TD mono>{m.email}</TD>
                        <TD>
                          <span className="flex items-center gap-1.5">
                            <StatusDot tone={statusTone} />
                            <span className="text-xs">{m.status}</span>
                          </span>
                        </TD>
                        <TD align="right" mono>
                          {m.currentDailyCap}
                        </TD>
                        <TD align="right" mono>
                          {m.sentToday}
                        </TD>
                        <TD>
                          <div className="flex items-center gap-1">
                            <Badge tone={m.spfPass ? "ok" : "danger"}>SPF</Badge>
                            <Badge tone={m.dkimPass ? "ok" : "danger"}>DKIM</Badge>
                            <Badge tone={m.dmarcPass ? "ok" : "danger"}>DMARC</Badge>
                          </div>
                        </TD>
                      </TR>
                    );
                  })}
                </tbody>
              </Table>
            )}
          </div>

          {/* Connect New Mailbox Form */}
          <div className="flex flex-col gap-4 lg:col-span-4">
            <Card className="p-4">
              <h3 className="text-xs font-semibold text-fg mb-3">Connect Mailbox</h3>
              <MailboxForm />
            </Card>
          </div>
        </div>
      </div>
    </>
  );
}
