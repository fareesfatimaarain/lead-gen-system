import Link from "next/link";
import { summarizeAcquisition } from "@outreach/shared";
import {
  Badge,
  Card,
  EmptyState,
  Notice,
  PageHeader,
  Stat,
  StatRow,
  Table,
  TD,
  TH,
  THead,
  TR,
} from "@/components/ui";
import { getAcquisitionBySource } from "@/lib/data";
import { formatUsd } from "@/lib/format";
import { requirePageSession } from "@/lib/session";
import { PatientValueForm } from "./PatientValueForm";

/**
 * Acquisition.
 *
 * The screen that answers "is this working" in the currency the customer thinks
 * in. Clinics buy on cost per booked consultation measured against what a
 * patient is worth — not clicks, not leads — and because discovery, outreach,
 * the call and the booking all happen inside this product, the whole chain is
 * attributable here in a way a single-surface tool cannot manage.
 *
 * Cost per booked consultation leads. Everything else on the page exists to
 * explain that number or to say which source to stop paying for.
 */
export default async function AcquisitionPage() {
  const session = await requirePageSession();
  const { rows, patientValueCents } = await getAcquisitionBySource(session);

  const summary = summarizeAcquisition(rows, patientValueCents);
  const hasValue = patientValueCents > 0;
  const money = (cents: number | null) => (cents === null ? "—" : formatUsd(cents / 100));

  return (
    <>
      <PageHeader
        title="Acquisition"
        description="What each source costs per booked consultation, and what those consultations are worth."
      />

      <div className="flex flex-col gap-4 p-4">
        {!hasValue ? (
          <Card>
            <div className="flex flex-col gap-3 p-4">
              <p className="max-w-2xl text-sm text-fg-muted">
                Costs and booking rates below are already accurate. Enter what one booked
                consultation is worth to see return alongside them — it is deliberately not
                guessed, because a made-up patient value produces a confident, wrong answer.
              </p>
              <PatientValueForm current={null} />
            </div>
          </Card>
        ) : null}

        <StatRow>
          <Stat
            label="Cost per booked consultation"
            value={money(summary.totals.costPerBookedCents)}
            hint={`${summary.totals.booked} booked from ${summary.totals.leads} leads`}
          />
          <Stat
            label="Best source"
            value={summary.best ? summary.best.source : "—"}
            hint={summary.best ? `${money(summary.best.costPerBookedCents)} each` : "No bookings yet"}
            tone={summary.best ? "ok" : "neutral"}
          />
          <Stat
            label="Total spend"
            value={money(summary.totals.costCents)}
            hint="Discovery and enrichment"
          />
          {hasValue ? (
            <Stat
              label="Return"
              value={summary.totals.roas === null ? "—" : `${summary.totals.roas.toFixed(1)}×`}
              hint={`${money(summary.totals.valueCents)} booked value`}
              tone={summary.totals.netCents >= 0 ? "ok" : "danger"}
            />
          ) : null}
        </StatRow>

        {summary.unprofitable.length > 0 ? (
          <Notice tone="warn">
            {summary.unprofitable.length === 1 ? "One source has" : `${summary.unprofitable.length} sources have`}{" "}
            cost money and booked nothing:{" "}
            <span className="font-medium">{summary.unprofitable.map((s) => s.source).join(", ")}</span>. That is{" "}
            {money(summary.unprofitable.reduce((a, s) => a + s.costCents, 0))} to reallocate.
          </Notice>
        ) : null}

        <Card>
          {summary.sources.length === 0 ? (
            <EmptyState
              title="No prospects yet"
              description="Once discovery runs and consultations are booked, every source is ranked here by what it costs to fill a chair."
            />
          ) : (
            <Table>
              <THead>
                <TH>Source</TH>
                <TH align="right">Leads</TH>
                <TH align="right">Qualified</TH>
                <TH align="right">Contacted</TH>
                <TH align="right">Booked</TH>
                <TH align="right">Booking rate</TH>
                <TH align="right">Spend</TH>
                <TH align="right">Cost / consultation</TH>
                {hasValue ? <TH align="right">Net</TH> : null}
              </THead>
              <tbody>
                {summary.sources.map((s) => (
                  <TR key={s.source}>
                    <TD>
                      <span className="font-medium">{s.source}</span>
                      {s.booked === 0 && s.costCents > 0 ? (
                        <Badge tone="warn">no bookings</Badge>
                      ) : null}
                    </TD>
                    <TD align="right">{s.leads}</TD>
                    <TD align="right">{s.qualified}</TD>
                    <TD align="right">{s.contacted}</TD>
                    <TD align="right">{s.booked}</TD>
                    <TD align="right">{(s.bookingRate * 100).toFixed(1)}%</TD>
                    <TD align="right">{money(s.costCents)}</TD>
                    <TD align="right">
                      <span className={s.costPerBookedCents === null ? "text-fg-subtle" : "font-medium"}>
                        {money(s.costPerBookedCents)}
                      </span>
                    </TD>
                    {hasValue ? (
                      <TD align="right">
                        <span className={s.netCents >= 0 ? "text-ok" : "text-danger"}>
                          {money(s.netCents)}
                        </span>
                      </TD>
                    ) : null}
                  </TR>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <p className="max-w-3xl text-sm text-fg-subtle">
          Spend covers discovery and enrichment, which is what varies between sources. Model, voice
          and verification costs are recorded per provider rather than per prospect, so they are
          reported on{" "}
          <Link href="/spend" className="underline">
            Spend
          </Link>{" "}
          rather than apportioned here — splitting them across prospects would be an invented number.
        </p>
      </div>
    </>
  );
}
