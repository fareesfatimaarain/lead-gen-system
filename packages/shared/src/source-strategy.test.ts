import { describe, expect, it } from "vitest";
import { rankSourcesForIcp } from "./source-strategy";

describe("rankSourcesForIcp", () => {
  it("prefers higher-performing active sources and filters disabled ones", () => {
    const ranked = rankSourcesForIcp(
      {
        industries: ["SaaS"],
        titles: ["VP Operations"],
        geographies: [{ country: "United States" }],
      },
      [
        { id: "apollo", name: "Apollo", kind: "lead_source", status: "active", weight: 50, config: {} },
        { id: "linkedin", name: "LinkedIn", kind: "lead_source", status: "paused", weight: 40, config: {} },
        { id: "clearbit", name: "Clearbit", kind: "enrichment", status: "active", weight: 30, config: {} },
      ],
      [
        { source: "apollo", leadsReturned: 120, leadsQualified: 28, costUsd: 0, avgFitScore: 82.5, latencyMs: 1500 },
        { source: "clearbit", leadsReturned: 60, leadsQualified: 8, costUsd: 7.5, avgFitScore: 70, latencyMs: 2600 },
      ],
    );

    expect(ranked.map((s) => s.id)).toEqual(["apollo", "clearbit"]);
    expect(ranked[0]?.score).toBeGreaterThan(ranked[1]!.score);
  });

  it("falls back to a default score when the source has no historical performance yet", () => {
    const ranked = rankSourcesForIcp(
      { industries: ["Healthcare"], titles: ["COO"], geographies: [] },
      [
        { id: "hunter", name: "Hunter", kind: "verification", status: "active", weight: 45, config: {} },
      ],
      [],
    );

    expect(ranked).toHaveLength(1);
    expect(ranked[0]?.score).toBeGreaterThan(0);
    expect(ranked[0]?.reason).toContain("fallback");
  });
});
