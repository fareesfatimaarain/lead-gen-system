import { and, count, db, desc, eq, isNotNull, open, schema, withOrg } from "@outreach/db";
import type { ClaimedJob } from "@outreach/jobs";
import { heartbeat } from "@outreach/jobs";
import { getProvider } from "@outreach/adapters/registry";
import type { AdapterCtx, LeadSource, RawLead } from "@outreach/adapters";
import { hunterDomainSearchProvider } from "@outreach/adapters";
import { ingestLead } from "@outreach/ingest";
import { rankSourcesForIcp } from "@outreach/shared";
import { z } from "zod";
import { buildSourceQuery } from "./source-query";

const payloadSchema = z.object({
  runId: z.string().uuid(),
  icpId: z.string().uuid(),
  targetCount: z.number().int().min(1).max(500),
  campaignId: z.string().uuid().nullable().optional(),
});

/**
 * Discovery run handler.
 *
 * v1: deterministic ranking (`rankSourcesForIcp`, the same function the
 * Sources screen shows) rather than an LLM Source Strategist — that is future
 * work. What is real here: it calls the actual adapters with the actual ICP
 * and writes actual companies/prospects, through the same `ingestLead` a
 * manual CSV import uses.
 */
export async function runDiscoveryJob(job: ClaimedJob): Promise<Record<string, unknown>> {
  const payload = payloadSchema.parse(job.payload);
  const orgId = job.orgId;

  const context = await withOrg({ orgId }, async (tx) => {
    const [run] = await tx.select().from(schema.discoveryRuns).where(eq(schema.discoveryRuns.id, payload.runId)).limit(1);
    if (!run) throw new Error(`Discovery run ${payload.runId} no longer exists.`);
    if (run.status === "cancelled" || run.status === "completed") return null;

    const [icp] = await tx.select().from(schema.icps).where(eq(schema.icps.id, payload.icpId)).limit(1);
    if (!icp) throw new Error(`ICP ${payload.icpId} no longer exists.`);

    await tx.update(schema.discoveryRuns).set({ status: "running" }).where(eq(schema.discoveryRuns.id, run.id));

    const sources = await tx
      .select()
      .from(schema.dataSources)
      .where(and(eq(schema.dataSources.status, "active"), eq(schema.dataSources.kind, "lead_source")));

    const perf = await tx
      .select({
        source: schema.sourcePerformance.source,
        leadsReturned: schema.sourcePerformance.leadsReturned,
        leadsQualified: schema.sourcePerformance.leadsQualified,
        avgFitScore: schema.sourcePerformance.avgFitScore,
        costUsd: schema.sourcePerformance.costUsd,
        latencyMs: schema.sourcePerformance.latencyMs,
      })
      .from(schema.sourcePerformance)
      .where(eq(schema.sourcePerformance.icpId, icp.id));

    return { run, icp, sources, perf };
  });

  if (!context) return { skipped: true, reason: "Run already finished or was cancelled." };
  const { run, icp, sources } = context;

  const ranked = rankSourcesForIcp(
    { industries: icp.industries, titles: icp.titles, geographies: icp.geographies },
    sources.map((s) => ({
      id: s.provider ?? s.name,
      name: s.name,
      kind: s.kind as "lead_source",
      status: "active" as const,
      weight: s.weight,
      config: s.config ?? {},
    })),
    context.perf.map((p) => ({
      source: p.source,
      leadsReturned: p.leadsReturned,
      leadsQualified: p.leadsQualified,
      costUsd: Number(p.costUsd),
      avgFitScore: p.avgFitScore ? Number(p.avgFitScore) : null,
      latencyMs: p.latencyMs,
    })),
  );

  let totalNew = 0;
  let totalCost = 0;
  let sourcesRun = 0;

  for (const rankedSource of ranked) {
    if (totalNew >= run.targetCount) break;

    const dataSource = sources.find((s) => (s.provider ?? s.name) === rankedSource.id);
    if (!dataSource?.provider) continue;

    const providerDef = getProvider(dataSource.provider);
    if (!providerDef || providerDef.category !== "lead_source") continue;
    const adapter = providerDef.adapter as LeadSource;

    const remaining = run.targetCount - totalNew;
    let built;
    try {
      built = await buildSourceQuery(providerDef.id, icp, remaining);
    } catch (err) {
      built = { skip: err instanceof Error ? err.message : String(err) };
    }

    if ("skip" in built) {
      await recordSourceRun(orgId, icp.id, providerDef.id, { leadsReturned: 0, leadsNew: 0, error: built.skip });
      continue;
    }

    const ctx = await buildAdapterCtx(orgId, providerDef, dataSource);
    if (!ctx) {
      await recordSourceRun(orgId, icp.id, providerDef.id, { leadsReturned: 0, leadsNew: 0, error: "No credential connected." });
      continue;
    }

    const startedAt = Date.now();
    let leads: RawLead[] = [];
    let error: string | undefined;
    try {
      leads = await adapter.search(built.query, ctx);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
    const latencyMs = Date.now() - startedAt;
    sourcesRun++;

    if (error) {
      await recordSourceRun(orgId, icp.id, providerDef.id, { leadsReturned: 0, leadsNew: 0, error, latencyMs });
      continue;
    }

    const outcome = await withOrg({ orgId }, async (tx) => {
      let created = 0, duplicate = 0, suppressed = 0;
      for (const lead of leads) {
        const result = await ingestLead(tx, { orgId, lead, source: providerDef.id, discoveryRunId: run.id, campaignId: run.campaignId });
        if (result.kind === "suppressed") suppressed++;
        else if (result.kind.startsWith("duplicate")) duplicate++;
        else created++;
      }
      return { created, duplicate, suppressed };
    });

    const estCost = adapter.estimateCost(built.query).costUsd;
    totalCost += estCost;
    totalNew += outcome.created;

    await recordSourceRun(orgId, icp.id, providerDef.id, { leadsReturned: leads.length, leadsNew: outcome.created, costUsd: estCost, latencyMs });
    await bumpRunCounters(orgId, run.id, {
      found: leads.length,
      withEmail: leads.filter((l) => l.email).length,
      created: outcome.created,
      duplicate: outcome.duplicate,
      suppressed: outcome.suppressed,
      cost: estCost,
    });
    await heartbeatSafe(job.id);
  }

  await runHunterEnrichmentPass(orgId, run.id, icp.id);

  await withOrg({ orgId }, (tx) =>
    tx.update(schema.discoveryRuns).set({ status: "completed", finishedAt: new Date() }).where(eq(schema.discoveryRuns.id, run.id)),
  );

  return { totalNew, totalCost, sourcesRun };
}

async function buildAdapterCtx(
  orgId: string,
  providerDef: { id: string; requiresCredential?: boolean },
  dataSource: typeof schema.dataSources.$inferSelect,
): Promise<AdapterCtx | null> {
  if (providerDef.requiresCredential === false) {
    return { orgId, secret: "", config: dataSource.config ?? {} };
  }
  if (!dataSource.credentialId) return null;

  const credential = await withOrg({ orgId }, (tx) =>
    tx.select().from(schema.credentials).where(eq(schema.credentials.id, dataSource.credentialId!)).limit(1),
  ).then((rows) => rows[0]);
  if (!credential) return null;

  return {
    orgId,
    secret: open({ ciphertext: credential.encryptedValue, iv: credential.encryptionIv, tag: credential.encryptionTag, keyVersion: credential.keyVersion }),
    config: { ...credential.config, ...dataSource.config },
  };
}

async function recordSourceRun(
  orgId: string,
  icpId: string,
  source: string,
  data: { leadsReturned: number; leadsNew: number; costUsd?: number; latencyMs?: number; error?: string },
): Promise<void> {
  await withOrg({ orgId }, (tx) =>
    tx.insert(schema.sourcePerformance).values({
      orgId,
      icpId,
      source,
      leadsReturned: data.leadsReturned,
      leadsNew: data.leadsNew,
      leadsQualified: 0,
      costUsd: String(data.costUsd ?? 0),
      latencyMs: data.latencyMs,
      error: data.error,
    }),
  );
}

async function bumpRunCounters(
  orgId: string,
  runId: string,
  delta: { found: number; withEmail: number; created: number; duplicate: number; suppressed: number; cost: number },
): Promise<void> {
  await withOrg({ orgId }, async (tx) => {
    const [current] = await tx.select().from(schema.discoveryRuns).where(eq(schema.discoveryRuns.id, runId)).limit(1);
    if (!current) return;
    await tx
      .update(schema.discoveryRuns)
      .set({
        companiesFound: current.companiesFound + delta.found,
        prospectsFound: current.prospectsFound + delta.withEmail,
        prospectsNew: current.prospectsNew + delta.created,
        duplicatesSkipped: current.duplicatesSkipped + delta.duplicate,
        suppressedSkipped: current.suppressedSkipped + delta.suppressed,
        costUsd: String(Number(current.costUsd) + delta.cost),
      })
      .where(eq(schema.discoveryRuns.id, runId));
  });
}

async function heartbeatSafe(jobId: string): Promise<void> {
  try {
    await db().transaction((tx) => heartbeat(tx, jobId));
  } catch {
    // A missed heartbeat just shortens the lease; the job is re-offered, not lost.
  }
}

/**
 * Second pass: companies with a domain but no prospect yet get a Hunter
 * Domain Search call, if Hunter is connected. Hunter is not useful as a cold
 * top-of-funnel source on its own — it needs a domain to search against —
 * this is the "Overpass/Google finds the business, Hunter finds the person"
 * pipeline those sources are meant to compose into.
 */
async function runHunterEnrichmentPass(orgId: string, runId: string, icpId: string): Promise<void> {
  const hunterSource = await withOrg({ orgId }, (tx) =>
    tx
      .select()
      .from(schema.dataSources)
      .where(and(eq(schema.dataSources.provider, "hunter_domain_search"), eq(schema.dataSources.status, "active")))
      .limit(1),
  ).then((rows) => rows[0]);
  if (!hunterSource?.credentialId) return;

  const credential = await withOrg({ orgId }, (tx) =>
    tx.select().from(schema.credentials).where(eq(schema.credentials.id, hunterSource.credentialId!)).limit(1),
  ).then((rows) => rows[0]);
  if (!credential) return;

  const ctx: AdapterCtx = {
    orgId,
    secret: open({ ciphertext: credential.encryptedValue, iv: credential.encryptionIv, tag: credential.encryptionTag, keyVersion: credential.keyVersion }),
    config: credential.config,
  };

  const candidates = await withOrg({ orgId }, (tx) =>
    tx
      .select({ id: schema.companies.id, domain: schema.companies.domain, prospectCount: count(schema.prospects.id) })
      .from(schema.companies)
      .leftJoin(schema.prospects, eq(schema.prospects.companyId, schema.companies.id))
      .where(isNotNull(schema.companies.domain))
      .groupBy(schema.companies.id)
      .orderBy(desc(schema.companies.createdAt))
      .limit(15),
  );

  const withoutProspects = candidates.filter((c) => c.prospectCount === 0).slice(0, 10);
  let created = 0;
  let leadsReturned = 0;

  for (const company of withoutProspects) {
    try {
      const leads = await hunterDomainSearchProvider.search({ query: company.domain!, filters: { domain: company.domain! }, limit: 5 }, ctx);
      leadsReturned += leads.length;
      await withOrg({ orgId }, async (tx) => {
        for (const lead of leads) {
          const outcome = await ingestLead(tx, { orgId, lead, source: "hunter_domain_search" });
          if (outcome.kind === "prospect_created") created++;
        }
      });
    } catch {
      // One company's domain failing (no coverage, bad domain) does not stop the rest.
    }
  }

  if (withoutProspects.length > 0) {
    await recordSourceRun(orgId, icpId, "hunter_domain_search", { leadsReturned, leadsNew: created });
    await bumpRunCounters(orgId, runId, { found: 0, withEmail: leadsReturned, created, duplicate: 0, suppressed: 0, cost: 0 });
  }
}

