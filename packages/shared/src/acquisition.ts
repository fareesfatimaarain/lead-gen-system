/**
 * Acquisition economics.
 *
 * Everything downstream of "which source produced a booked consultation, and
 * what did it cost". Clinics do not buy on cost per click or cost per lead —
 * they buy on cost per booked consultation measured against what a patient is
 * worth, and that is the one number most tools cannot produce because they only
 * see one surface. Discovery, outreach, the call and the booking all happen
 * here, so the whole chain is attributable.
 *
 * Pure arithmetic, no I/O, so the arithmetic can be tested rather than trusted.
 */

/** Money is handled in whole cents. Floats do not accumulate correctly over a quarter of spend. */
export type Cents = number;

export interface SourceTotals {
  /** Provider id or manual origin: "google_places", "csv", "hubspot". */
  source: string;
  leads: number;
  qualified: number;
  contacted: number;
  /** Consultations actually booked. The numerator everything else is judged against. */
  booked: number;
  /** Everything spent to produce those leads: discovery, enrichment, verification, model, voice. */
  costCents: Cents;
}

export interface SourceEconomics extends SourceTotals {
  /** null when nothing booked yet — an unknown cost, not an infinite one. */
  costPerBookedCents: Cents | null;
  costPerLeadCents: Cents | null;
  /** Booked ÷ leads, 0–1. */
  bookingRate: number;
  /** Qualified ÷ leads, 0–1. */
  qualificationRate: number;
  /** Expected value of the consultations booked, at the org's stated patient value. */
  valueCents: Cents;
  /** valueCents − costCents. Negative is a source to stop paying for. */
  netCents: Cents;
  /**
   * Return per unit spent. null when nothing was spent — a free source that
   * produced a booking is not "infinite ROI", it is a source with no cost basis
   * to divide by, and printing ∞ in front of a client is not a number.
   */
  roas: number | null;
}

function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

function perUnit(costCents: Cents, units: number): Cents | null {
  return units > 0 ? Math.round(costCents / units) : null;
}

/**
 * @param patientValueCents What one booked consultation is worth. Lifetime value
 *   if the org tracks it, first-treatment revenue if not — the caller decides,
 *   because a clinic quoting an 18-month LTV and one quoting a single treatment
 *   are answering different questions and neither is wrong.
 */
export function sourceEconomics(totals: SourceTotals, patientValueCents: Cents): SourceEconomics {
  const valueCents = Math.round(totals.booked * patientValueCents);
  return {
    ...totals,
    costPerBookedCents: perUnit(totals.costCents, totals.booked),
    costPerLeadCents: perUnit(totals.costCents, totals.leads),
    bookingRate: ratio(totals.booked, totals.leads),
    qualificationRate: ratio(totals.qualified, totals.leads),
    valueCents,
    netCents: valueCents - totals.costCents,
    roas: totals.costCents > 0 ? valueCents / totals.costCents : null,
  };
}

export interface AcquisitionSummary {
  sources: SourceEconomics[];
  totals: SourceEconomics;
  /** Sources that cost money and have booked nothing. The budget to reallocate. */
  unprofitable: SourceEconomics[];
  /** Best cost per booked consultation among sources that have booked at least one. */
  best: SourceEconomics | null;
}

/**
 * Rank sources by cost per booked consultation, cheapest first.
 *
 * Sources with no booking yet sort last rather than first. A source that has
 * spent nothing and booked nothing is not the best performer, which is what a
 * naive ascending sort on a null cost would claim.
 */
export function summarizeAcquisition(
  rows: readonly SourceTotals[],
  patientValueCents: Cents,
): AcquisitionSummary {
  const sources = rows
    .map((r) => sourceEconomics(r, patientValueCents))
    .sort((a, b) => {
      if (a.costPerBookedCents === null && b.costPerBookedCents === null) return b.leads - a.leads;
      if (a.costPerBookedCents === null) return 1;
      if (b.costPerBookedCents === null) return -1;
      return a.costPerBookedCents - b.costPerBookedCents;
    });

  const combined = rows.reduce<SourceTotals>(
    (acc, r) => ({
      source: "All sources",
      leads: acc.leads + r.leads,
      qualified: acc.qualified + r.qualified,
      contacted: acc.contacted + r.contacted,
      booked: acc.booked + r.booked,
      costCents: acc.costCents + r.costCents,
    }),
    { source: "All sources", leads: 0, qualified: 0, contacted: 0, booked: 0, costCents: 0 },
  );

  return {
    sources,
    totals: sourceEconomics(combined, patientValueCents),
    unprofitable: sources.filter((s) => s.booked === 0 && s.costCents > 0),
    best: sources.find((s) => s.costPerBookedCents !== null) ?? null,
  };
}
