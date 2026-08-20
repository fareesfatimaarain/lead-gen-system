import { describe, expect, it } from "vitest";
import { sourceEconomics, summarizeAcquisition } from "./acquisition";
import type { SourceTotals } from "./acquisition";

const LTV = 477_500; // $4,775 — the figure clinics quote for 18-month patient value.

function totals(over: Partial<SourceTotals> = {}): SourceTotals {
  return { source: "google_places", leads: 100, qualified: 40, contacted: 30, booked: 5, costCents: 90_000, ...over };
}

describe("sourceEconomics", () => {
  it("computes cost per booked consultation", () => {
    // $900 spent, 5 booked -> $180 each, the low end of the clinic benchmark.
    expect(sourceEconomics(totals(), LTV).costPerBookedCents).toBe(18_000);
  });

  it("computes cost per lead and the funnel rates", () => {
    const e = sourceEconomics(totals(), LTV);
    expect(e.costPerLeadCents).toBe(900);
    expect(e.bookingRate).toBeCloseTo(0.05);
    expect(e.qualificationRate).toBeCloseTo(0.4);
  });

  it("values bookings at the org's stated patient value and nets off spend", () => {
    const e = sourceEconomics(totals(), LTV);
    expect(e.valueCents).toBe(5 * LTV);
    expect(e.netCents).toBe(5 * LTV - 90_000);
    expect(e.roas).toBeCloseTo((5 * LTV) / 90_000);
  });

  // An unknown cost, not a free one. Showing $0 would rank a source that has
  // booked nothing as the cheapest way to book a consultation.
  it("reports null rather than zero when nothing has booked", () => {
    const e = sourceEconomics(totals({ booked: 0 }), LTV);
    expect(e.costPerBookedCents).toBeNull();
    expect(e.netCents).toBe(-90_000);
  });

  it("reports null ROAS for a free source rather than infinity", () => {
    const e = sourceEconomics(totals({ costCents: 0 }), LTV);
    expect(e.roas).toBeNull();
    expect(Number.isFinite(e.netCents)).toBe(true);
  });

  it("survives a source with no leads at all", () => {
    const e = sourceEconomics(totals({ leads: 0, qualified: 0, contacted: 0, booked: 0, costCents: 0 }), LTV);
    expect(e.costPerLeadCents).toBeNull();
    expect(e.bookingRate).toBe(0);
    expect(e.roas).toBeNull();
  });
});

describe("summarizeAcquisition", () => {
  const rows: SourceTotals[] = [
    { source: "expensive", leads: 50, qualified: 10, contacted: 8, booked: 1, costCents: 60_000 },
    { source: "cheap", leads: 80, qualified: 30, contacted: 25, booked: 4, costCents: 40_000 },
    { source: "dead", leads: 20, qualified: 1, contacted: 1, booked: 0, costCents: 25_000 },
  ];

  it("ranks by cost per booked consultation, cheapest first", () => {
    const s = summarizeAcquisition(rows, LTV);
    expect(s.sources.map((x) => x.source)).toEqual(["cheap", "expensive", "dead"]);
    expect(s.best?.source).toBe("cheap");
  });

  // The trap a naive ascending sort falls into: null sorts before 0.
  it("sorts sources that have booked nothing last, not first", () => {
    const s = summarizeAcquisition(rows, LTV);
    expect(s.sources[s.sources.length - 1]?.source).toBe("dead");
  });

  it("names the sources that cost money and booked nothing", () => {
    expect(summarizeAcquisition(rows, LTV).unprofitable.map((x) => x.source)).toEqual(["dead"]);
  });

  it("does not flag a free source that booked nothing as wasted budget", () => {
    const free = [{ source: "overpass", leads: 10, qualified: 2, contacted: 0, booked: 0, costCents: 0 }];
    expect(summarizeAcquisition(free, LTV).unprofitable).toEqual([]);
  });

  it("totals across every source", () => {
    const s = summarizeAcquisition(rows, LTV);
    expect(s.totals.leads).toBe(150);
    expect(s.totals.booked).toBe(5);
    expect(s.totals.costCents).toBe(125_000);
    expect(s.totals.costPerBookedCents).toBe(25_000);
  });

  it("returns an empty, non-throwing summary with no data at all", () => {
    const s = summarizeAcquisition([], LTV);
    expect(s.sources).toEqual([]);
    expect(s.best).toBeNull();
    expect(s.totals.costPerBookedCents).toBeNull();
  });
});
