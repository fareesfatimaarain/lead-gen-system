export type DataSourceKind = "lead_source" | "enrichment" | "verification" | "search" | "crm" | "email_send" | "voice";

export interface DataSourceRecord {
  id: string;
  name: string;
  kind: DataSourceKind;
  status: "active" | "paused" | "disabled";
  weight: number;
  config: Record<string, unknown>;
}

export interface HistoricalSourcePerformance {
  source: string;
  leadsReturned: number;
  leadsQualified: number;
  costUsd: number;
  avgFitScore?: number | null;
  latencyMs?: number | null;
}

export interface RankedSource extends DataSourceRecord {
  score: number;
  reason: string;
}

export function rankSourcesForIcp(
  icp: {
    industries?: string[];
    titles?: string[];
    geographies?: Array<{ country?: string; region?: string; city?: string }>;
  },
  sources: DataSourceRecord[],
  history: HistoricalSourcePerformance[],
): RankedSource[] {
  const performanceBySource = new Map(
    history.map((row) => [row.source, row]),
  );

  return sources
    .filter((source) => source.status === "active")
    .map((source) => {
      const perf = performanceBySource.get(source.id);
      const base = Number.isFinite(source.weight) ? source.weight : 0;

      let score = base;
      let reason = "default fallback weight";

      if (perf) {
        const yieldScore = (perf.leadsQualified / Math.max(perf.leadsReturned, 1)) * 100;
        const fitScore = Number(perf.avgFitScore ?? 0);
        const latencyBoost = perf.latencyMs ? Math.max(0, 2000 - perf.latencyMs) / 20 : 0;
        const costPenalty = perf.costUsd > 0 ? Math.max(0, 20 - perf.costUsd) : 0;
        score = base + yieldScore * 0.6 + fitScore * 0.5 + latencyBoost + costPenalty;
        reason = `${source.name} has ${perf.leadsQualified} qualified leads in recent runs`;
      }

      if (source.kind === "lead_source" && icp.industries?.length) {
        score += 10;
      }
      if (source.kind === "lead_source" && icp.titles?.length) {
        score += 6;
      }
      if (source.kind === "search" && icp.geographies?.length) {
        score += 8;
      }

      return {
        ...source,
        score: Number(score.toFixed(2)),
        reason: perf ? reason : `fallback ranking for ${source.name}; no history yet`,
      };
    })
    .sort((a, b) => b.score - a.score);
}
