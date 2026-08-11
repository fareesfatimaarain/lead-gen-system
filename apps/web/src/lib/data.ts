import "server-only";
import {
  and,
  count,
  countDistinct,
  desc,
  eq,
  gte,
  ilike,
  isNull,
  or,
  schema,
  sql,
  withOrg,
} from "@outreach/db";
import type { Tx } from "@outreach/db";
import { notFound } from "@outreach/shared";
import type {
  CallDisposition,
  EmailState,
  ProspectStatus,
  ReplyIntent,
  VerificationResult,
} from "@outreach/shared";
import { PAGE_SIZE, offsetFor } from "./query";
import type { SessionContext } from "./session";

/**
 * Read models for the UI.
 *
 * Every function here runs inside `withOrg`, which sets the tenant claim the RLS
 * policies resolve through. No query in this file carries its own `orgId` filter
 * and none should: a WHERE clause someone forgets is a cross-tenant leak, a
 * missing tenant claim is an empty result.
 *
 * These are all read paths. Writes live in the server actions beside the screens
 * that perform them, so a mutation is always visible next to its authorization
 * check.
 */

function scope<T>(session: SessionContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withOrg({ orgId: session.orgId, userId: session.userId }, fn);
}

export interface Page<T> {
  rows: T[];
  total: number;
}

// ---------------------------------------------------------------------------
// Prospects
// ---------------------------------------------------------------------------

export interface ProspectListFilters {
  page: number;
  q?: string;
  status?: ProspectStatus;
  verification?: VerificationResult;
  campaignId?: string;
  companyId?: string;
  icpId?: string;
}

export async function listProspects(
  session: SessionContext,
  filters: ProspectListFilters,
): Promise<Page<{
  id: string;
  fullName: string | null;
  title: string | null;
  email: string | null;
  emailVerification: VerificationResult;
  status: ProspectStatus;
  companyId: string | null;
  companyName: string | null;
  companyDomain: string | null;
  fitScore: number | null;
  lastContactedAt: Date | null;
  nextActionAt: Date | null;
  discoveredAt: Date;
}>> {
  const p = schema.prospects;
  const c = schema.companies;
  const s = schema.prospectScores;

  const conditions = [
    filters.status ? eq(p.status, filters.status) : undefined,
    filters.verification ? eq(p.emailVerification, filters.verification) : undefined,
    filters.campaignId ? eq(p.campaignId, filters.campaignId) : undefined,
    filters.companyId ? eq(p.companyId, filters.companyId) : undefined,
    filters.q
      ? or(
          ilike(p.fullName, `%${filters.q}%`),
          ilike(p.email, `%${filters.q}%`),
          ilike(c.name, `%${filters.q}%`),
        )
      : undefined,
  ].filter(Boolean);

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  return scope(session, async (tx) => {
    const rows = await tx
      .select({
        id: p.id,
        fullName: p.fullName,
        title: p.title,
        email: p.email,
        emailVerification: p.emailVerification,
        status: p.status,
        companyId: p.companyId,
        companyName: c.name,
        companyDomain: c.domain,
        fitScore: s.icpFitScore,
        lastContactedAt: p.lastContactedAt,
        nextActionAt: p.nextActionAt,
        discoveredAt: p.discoveredAt,
      })
      .from(p)
      .leftJoin(c, eq(c.id, p.companyId))
      // Left-joined so an unscored prospect still appears — hiding them would
      // hide exactly the ones that need attention.
      .leftJoin(s, and(eq(s.prospectId, p.id), filters.icpId ? eq(s.icpId, filters.icpId) : sql`true`))
      .where(where)
      .orderBy(desc(p.discoveredAt))
      .limit(PAGE_SIZE)
      .offset(offsetFor(filters.page));

    const [totals] = await tx
      .select({ n: countDistinct(p.id) })
      .from(p)
      .leftJoin(c, eq(c.id, p.companyId))
      .where(where);

    return { rows, total: Number(totals?.n ?? 0) };
  });
}

export async function getProspectProfile(session: SessionContext, id: string) {
  return scope(session, async (tx) => {
    const [prospect] = await tx
      .select()
      .from(schema.prospects)
      .where(eq(schema.prospects.id, id))
      .limit(1);
    if (!prospect) throw notFound("Prospect");

    const [company] = prospect.companyId
      ? await tx.select().from(schema.companies).where(eq(schema.companies.id, prospect.companyId)).limit(1)
      : [];

    const [campaign] = prospect.campaignId
      ? await tx
          .select({ id: schema.campaigns.id, name: schema.campaigns.name, status: schema.campaigns.status })
          .from(schema.campaigns)
          .where(eq(schema.campaigns.id, prospect.campaignId))
          .limit(1)
      : [];

    const signals = await tx
      .select()
      .from(schema.prospectSignals)
      .where(
        or(
          eq(schema.prospectSignals.prospectId, id),
          prospect.companyId ? eq(schema.prospectSignals.companyId, prospect.companyId) : sql`false`,
        ),
      )
      .orderBy(desc(schema.prospectSignals.confidence), desc(schema.prospectSignals.discoveredAt));

    const scores = await tx
      .select({
        id: schema.prospectScores.id,
        icpId: schema.prospectScores.icpId,
        icpName: schema.icps.name,
        icpFitScore: schema.prospectScores.icpFitScore,
        intentScore: schema.prospectScores.intentScore,
        reachabilityScore: schema.prospectScores.reachabilityScore,
        breakdown: schema.prospectScores.breakdown,
        reasoning: schema.prospectScores.reasoning,
        model: schema.prospectScores.model,
        scoredAt: schema.prospectScores.scoredAt,
      })
      .from(schema.prospectScores)
      .leftJoin(schema.icps, eq(schema.icps.id, schema.prospectScores.icpId))
      .where(eq(schema.prospectScores.prospectId, id))
      .orderBy(desc(schema.prospectScores.icpFitScore));

    const emails = await tx
      .select()
      .from(schema.emails)
      .where(eq(schema.emails.prospectId, id))
      .orderBy(desc(schema.emails.createdAt));

    const calls = await tx
      .select()
      .from(schema.calls)
      .where(eq(schema.calls.prospectId, id))
      .orderBy(desc(schema.calls.createdAt));

    const replies = await tx
      .select()
      .from(schema.emailReplies)
      .where(eq(schema.emailReplies.prospectId, id))
      .orderBy(desc(schema.emailReplies.receivedAt));

    const activities = await tx
      .select()
      .from(schema.activities)
      .where(eq(schema.activities.prospectId, id))
      .orderBy(desc(schema.activities.occurredAt))
      .limit(200);

    const guardrails = await tx
      .select()
      .from(schema.guardrailEvents)
      .where(eq(schema.guardrailEvents.prospectId, id))
      .orderBy(desc(schema.guardrailEvents.createdAt))
      .limit(20);

    return {
      prospect,
      company: company ?? null,
      campaign: campaign ?? null,
      signals,
      scores,
      emails,
      calls,
      replies,
      activities,
      guardrails,
    };
  });
}

// ---------------------------------------------------------------------------
// Companies
// ---------------------------------------------------------------------------

export async function listCompanies(
  session: SessionContext,
  filters: { page: number; q?: string; industry?: string },
) {
  const c = schema.companies;
  const conditions = [
    filters.q ? or(ilike(c.name, `%${filters.q}%`), ilike(c.domain, `%${filters.q}%`)) : undefined,
    filters.industry ? eq(c.industry, filters.industry) : undefined,
  ].filter(Boolean);
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  return scope(session, async (tx) => {
    const rows = await tx
      .select({
        id: c.id,
        name: c.name,
        domain: c.domain,
        industry: c.industry,
        employeeCount: c.employeeCount,
        city: c.city,
        country: c.country,
        source: c.source,
        createdAt: c.createdAt,
        prospectCount: sql<number>`(
          SELECT count(*)::int FROM ${schema.prospects} p WHERE p.company_id = ${c.id}
        )`,
      })
      .from(c)
      .where(where)
      .orderBy(desc(c.createdAt))
      .limit(PAGE_SIZE)
      .offset(offsetFor(filters.page));

    const [totals] = await tx.select({ n: count() }).from(c).where(where);
    return { rows, total: Number(totals?.n ?? 0) };
  });
}

export async function getCompanyProfile(session: SessionContext, id: string) {
  return scope(session, async (tx) => {
    const [company] = await tx.select().from(schema.companies).where(eq(schema.companies.id, id)).limit(1);
    if (!company) throw notFound("Company");

    const people = await tx
      .select({
        id: schema.prospects.id,
        fullName: schema.prospects.fullName,
        title: schema.prospects.title,
        email: schema.prospects.email,
        emailVerification: schema.prospects.emailVerification,
        status: schema.prospects.status,
      })
      .from(schema.prospects)
      .where(eq(schema.prospects.companyId, id))
      .orderBy(desc(schema.prospects.discoveredAt));

    const signals = await tx
      .select()
      .from(schema.prospectSignals)
      .where(eq(schema.prospectSignals.companyId, id))
      .orderBy(desc(schema.prospectSignals.confidence));

    return { company, people, signals };
  });
}

// ---------------------------------------------------------------------------
// ICP
// ---------------------------------------------------------------------------

export async function listIcps(session: SessionContext) {
  return scope(session, (tx) =>
    tx
      .select({
        id: schema.icps.id,
        name: schema.icps.name,
        description: schema.icps.description,
        industries: schema.icps.industries,
        titles: schema.icps.titles,
        geographies: schema.icps.geographies,
        updatedAt: schema.icps.updatedAt,
        campaignCount: sql<number>`(
          SELECT count(*)::int FROM ${schema.campaigns} ca WHERE ca.icp_id = ${schema.icps.id}
        )`,
        scoredCount: sql<number>`(
          SELECT count(*)::int FROM ${schema.prospectScores} ps WHERE ps.icp_id = ${schema.icps.id}
        )`,
      })
      .from(schema.icps)
      .orderBy(desc(schema.icps.updatedAt)),
  );
}

export async function getIcp(session: SessionContext, id: string) {
  return scope(session, async (tx) => {
    const [icp] = await tx.select().from(schema.icps).where(eq(schema.icps.id, id)).limit(1);
    if (!icp) throw notFound("ICP");
    return icp;
  });
}

export async function listProofAssets(session: SessionContext, icpId?: string) {
  return scope(session, (tx) =>
    tx
      .select()
      .from(schema.proofAssets)
      .where(icpId ? or(eq(schema.proofAssets.icpId, icpId), isNull(schema.proofAssets.icpId)) : undefined)
      .orderBy(desc(schema.proofAssets.createdAt)),
  );
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

export async function listDiscoveryRuns(session: SessionContext, filters: { page: number }) {
  const r = schema.discoveryRuns;
  return scope(session, async (tx) => {
    const rows = await tx
      .select({
        id: r.id,
        status: r.status,
        icpId: r.icpId,
        icpName: schema.icps.name,
        targetCount: r.targetCount,
        companiesFound: r.companiesFound,
        prospectsFound: r.prospectsFound,
        prospectsNew: r.prospectsNew,
        duplicatesSkipped: r.duplicatesSkipped,
        suppressedSkipped: r.suppressedSkipped,
        costUsd: r.costUsd,
        error: r.error,
        startedAt: r.startedAt,
        finishedAt: r.finishedAt,
      })
      .from(r)
      .leftJoin(schema.icps, eq(schema.icps.id, r.icpId))
      .orderBy(desc(r.startedAt))
      .limit(PAGE_SIZE)
      .offset(offsetFor(filters.page));

    const [totals] = await tx.select({ n: count() }).from(r);
    return { rows, total: Number(totals?.n ?? 0) };
  });
}

export async function getDiscoveryRun(session: SessionContext, id: string) {
  return scope(session, async (tx) => {
    const [run] = await tx.select().from(schema.discoveryRuns).where(eq(schema.discoveryRuns.id, id)).limit(1);
    if (!run) throw notFound("Discovery run");

    const [icp] = run.icpId
      ? await tx.select().from(schema.icps).where(eq(schema.icps.id, run.icpId)).limit(1)
      : [];

    const sources = await tx
      .select()
      .from(schema.sourcePerformance)
      .where(run.icpId ? eq(schema.sourcePerformance.icpId, run.icpId) : undefined)
      .orderBy(desc(schema.sourcePerformance.ranAt))
      .limit(50);

    const prospects = await tx
      .select({
        id: schema.prospects.id,
        fullName: schema.prospects.fullName,
        title: schema.prospects.title,
        email: schema.prospects.email,
        status: schema.prospects.status,
        companyName: schema.companies.name,
      })
      .from(schema.prospects)
      .leftJoin(schema.companies, eq(schema.companies.id, schema.prospects.companyId))
      .where(eq(schema.prospects.discoveryRunId, id))
      .orderBy(desc(schema.prospects.discoveredAt))
      .limit(200);

    return { run, icp: icp ?? null, sources, prospects };
  });
}

// ---------------------------------------------------------------------------
// Campaigns and sequences
// ---------------------------------------------------------------------------

export async function listCampaigns(session: SessionContext) {
  const ca = schema.campaigns;
  return scope(session, (tx) =>
    tx
      .select({
        id: ca.id,
        name: ca.name,
        status: ca.status,
        icpId: ca.icpId,
        icpName: schema.icps.name,
        sequenceId: ca.sequenceId,
        sequenceName: schema.sequences.name,
        autoSendEnabled: ca.autoSendEnabled,
        callFirst: ca.callFirst,
        activatedAt: ca.activatedAt,
        createdAt: ca.createdAt,
        prospectCount: sql<number>`(
          SELECT count(*)::int FROM ${schema.prospects} p WHERE p.campaign_id = ${ca.id}
        )`,
        sentCount: sql<number>`(
          SELECT count(*)::int FROM ${schema.emails} e
          WHERE e.campaign_id = ${ca.id} AND e.state IN ('sent','delivered')
        )`,
        replyCount: sql<number>`(
          SELECT count(*)::int FROM ${schema.emailReplies} r
          JOIN ${schema.prospects} p2 ON p2.id = r.prospect_id
          WHERE p2.campaign_id = ${ca.id}
        )`,
      })
      .from(ca)
      .leftJoin(schema.icps, eq(schema.icps.id, ca.icpId))
      .leftJoin(schema.sequences, eq(schema.sequences.id, ca.sequenceId))
      .orderBy(desc(ca.createdAt)),
  );
}

export async function getCampaign(session: SessionContext, id: string) {
  return scope(session, async (tx) => {
    const [campaign] = await tx.select().from(schema.campaigns).where(eq(schema.campaigns.id, id)).limit(1);
    if (!campaign) throw notFound("Campaign");

    const [icp] = await tx.select().from(schema.icps).where(eq(schema.icps.id, campaign.icpId)).limit(1);
    const [sequence] = await tx
      .select()
      .from(schema.sequences)
      .where(eq(schema.sequences.id, campaign.sequenceId))
      .limit(1);
    const steps = await tx
      .select()
      .from(schema.sequenceSteps)
      .where(eq(schema.sequenceSteps.sequenceId, campaign.sequenceId))
      .orderBy(schema.sequenceSteps.position);

    const mailboxLinks = await tx
      .select({
        id: schema.mailboxes.id,
        email: schema.mailboxes.email,
        status: schema.mailboxes.status,
        currentDailyCap: schema.mailboxes.currentDailyCap,
        sentToday: schema.mailboxes.sentToday,
        spfPass: schema.mailboxes.spfPass,
        dkimPass: schema.mailboxes.dkimPass,
        dmarcPass: schema.mailboxes.dmarcPass,
      })
      .from(schema.campaignMailboxes)
      .innerJoin(schema.mailboxes, eq(schema.mailboxes.id, schema.campaignMailboxes.mailboxId))
      .where(eq(schema.campaignMailboxes.campaignId, id));

    const [funnel] = await tx
      .select({
        prospects: count(),
        contacted: sql<number>`count(*) FILTER (WHERE ${schema.prospects.status} IN ('contacted','engaged','meeting_booked','won'))::int`,
        engaged: sql<number>`count(*) FILTER (WHERE ${schema.prospects.status} IN ('engaged','meeting_booked','won'))::int`,
        booked: sql<number>`count(*) FILTER (WHERE ${schema.prospects.status} IN ('meeting_booked','won'))::int`,
        unsubscribed: sql<number>`count(*) FILTER (WHERE ${schema.prospects.status} = 'unsubscribed')::int`,
        bounced: sql<number>`count(*) FILTER (WHERE ${schema.prospects.status} = 'bounced')::int`,
      })
      .from(schema.prospects)
      .where(eq(schema.prospects.campaignId, id));

    // Aggregates always return exactly one row, so the tuple destructure below
    // only *looks* optional. Default the zeros so the UI gets a stable shape.
    return {
      campaign,
      icp: icp ?? null,
      sequence: sequence ?? null,
      steps,
      mailboxes: mailboxLinks,
      funnel: {
        prospects: Number(funnel?.prospects ?? 0),
        contacted: Number(funnel?.contacted ?? 0),
        engaged: Number(funnel?.engaged ?? 0),
        booked: Number(funnel?.booked ?? 0),
        unsubscribed: Number(funnel?.unsubscribed ?? 0),
        bounced: Number(funnel?.bounced ?? 0),
      },
    };
  });
}

export async function listSequences(session: SessionContext) {
  return scope(session, (tx) =>
    tx
      .select({
        id: schema.sequences.id,
        name: schema.sequences.name,
        updatedAt: schema.sequences.updatedAt,
        stepCount: sql<number>`(
          SELECT count(*)::int FROM ${schema.sequenceSteps} ss WHERE ss.sequence_id = ${schema.sequences.id}
        )`,
        campaignCount: sql<number>`(
          SELECT count(*)::int FROM ${schema.campaigns} ca WHERE ca.sequence_id = ${schema.sequences.id}
        )`,
      })
      .from(schema.sequences)
      .orderBy(desc(schema.sequences.updatedAt)),
  );
}

export async function getSequence(session: SessionContext, id: string) {
  return scope(session, async (tx) => {
    const [sequence] = await tx.select().from(schema.sequences).where(eq(schema.sequences.id, id)).limit(1);
    if (!sequence) throw notFound("Sequence");
    const steps = await tx
      .select()
      .from(schema.sequenceSteps)
      .where(eq(schema.sequenceSteps.sequenceId, id))
      .orderBy(schema.sequenceSteps.position);
    return { sequence, steps };
  });
}

// ---------------------------------------------------------------------------
// Approvals
// ---------------------------------------------------------------------------

export async function listApprovals(
  session: SessionContext,
  filters: { page: number; state?: EmailState },
) {
  const e = schema.emails;
  const where = eq(e.state, filters.state ?? "pending_approval");

  return scope(session, async (tx) => {
    const rows = await tx
      .select({
        id: e.id,
        subject: e.subject,
        bodyText: e.bodyText,
        reasoning: e.reasoning,
        citedSignalIds: e.citedSignalIds,
        validatorReport: e.validatorReport,
        regenerationCount: e.regenerationCount,
        model: e.model,
        generationCostUsd: e.generationCostUsd,
        createdAt: e.createdAt,
        prospectId: e.prospectId,
        prospectName: schema.prospects.fullName,
        prospectEmail: schema.prospects.email,
        prospectTitle: schema.prospects.title,
        companyName: schema.companies.name,
        campaignName: schema.campaigns.name,
      })
      .from(e)
      .leftJoin(schema.prospects, eq(schema.prospects.id, e.prospectId))
      .leftJoin(schema.companies, eq(schema.companies.id, schema.prospects.companyId))
      .leftJoin(schema.campaigns, eq(schema.campaigns.id, e.campaignId))
      .where(where)
      .orderBy(e.createdAt)
      .limit(PAGE_SIZE)
      .offset(offsetFor(filters.page));

    const [totals] = await tx.select({ n: count() }).from(e).where(where);
    return { rows, total: Number(totals?.n ?? 0) };
  });
}

/**
 * Progress toward the auto-send unlock.
 *
 * The counter lives on the org and is only ever incremented server-side by an
 * actual approval. There is no setting that skips it.
 */
export async function getApprovalGate(session: SessionContext) {
  const [org] = await scope(session, (tx) =>
    tx
      .select({ approvedDraftCount: schema.orgs.approvedDraftCount })
      .from(schema.orgs)
      .where(eq(schema.orgs.id, session.orgId))
      .limit(1),
  );
  const approved = org?.approvedDraftCount ?? 0;
  return { approved, required: 25, unlocked: approved >= 25 };
}

// ---------------------------------------------------------------------------
// Inbox
// ---------------------------------------------------------------------------

export async function listReplies(
  session: SessionContext,
  filters: { page: number; intent?: ReplyIntent; handled?: boolean },
) {
  const r = schema.emailReplies;
  const conditions = [
    filters.intent ? eq(r.intent, filters.intent) : undefined,
    filters.handled === true ? sql`${r.handledAt} IS NOT NULL` : undefined,
    filters.handled === false ? isNull(r.handledAt) : undefined,
  ].filter(Boolean);
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  return scope(session, async (tx) => {
    const rows = await tx
      .select({
        id: r.id,
        intent: r.intent,
        sentiment: r.sentiment,
        fromEmail: r.fromEmail,
        parsedBody: r.parsedBody,
        rawBody: r.rawBody,
        classificationReasoning: r.classificationReasoning,
        referredName: r.referredName,
        referredEmail: r.referredEmail,
        oooReturnDate: r.oooReturnDate,
        handledAt: r.handledAt,
        receivedAt: r.receivedAt,
        prospectId: r.prospectId,
        prospectName: schema.prospects.fullName,
        prospectStatus: schema.prospects.status,
        companyName: schema.companies.name,
      })
      .from(r)
      .leftJoin(schema.prospects, eq(schema.prospects.id, r.prospectId))
      .leftJoin(schema.companies, eq(schema.companies.id, schema.prospects.companyId))
      .where(where)
      .orderBy(desc(r.receivedAt))
      .limit(PAGE_SIZE)
      .offset(offsetFor(filters.page));

    const [totals] = await tx.select({ n: count() }).from(r).where(where);
    const [unhandled] = await tx.select({ n: count() }).from(r).where(isNull(r.handledAt));

    return { rows, total: Number(totals?.n ?? 0), unhandled: Number(unhandled?.n ?? 0) };
  });
}

// ---------------------------------------------------------------------------
// Calls
// ---------------------------------------------------------------------------

export async function listCalls(
  session: SessionContext,
  filters: { page: number; disposition?: CallDisposition },
) {
  const c = schema.calls;
  const where = filters.disposition ? eq(c.disposition, filters.disposition) : undefined;

  return scope(session, async (tx) => {
    const rows = await tx
      .select({
        id: c.id,
        disposition: c.disposition,
        status: c.status,
        durationSeconds: c.durationSeconds,
        sentiment: c.sentiment,
        summary: c.summary,
        permissionGranted: c.permissionGranted,
        voicemailLeft: c.voicemailLeft,
        costUsd: c.costUsd,
        startedAt: c.startedAt,
        createdAt: c.createdAt,
        prospectId: c.prospectId,
        prospectName: schema.prospects.fullName,
        prospectPhone: schema.prospects.phone,
        companyName: schema.companies.name,
        campaignName: schema.campaigns.name,
      })
      .from(c)
      .leftJoin(schema.prospects, eq(schema.prospects.id, c.prospectId))
      .leftJoin(schema.companies, eq(schema.companies.id, schema.prospects.companyId))
      .leftJoin(schema.campaigns, eq(schema.campaigns.id, c.campaignId))
      .where(where)
      .orderBy(desc(c.createdAt))
      .limit(PAGE_SIZE)
      .offset(offsetFor(filters.page));

    const [totals] = await tx.select({ n: count() }).from(c).where(where);
    return { rows, total: Number(totals?.n ?? 0) };
  });
}

export async function getCall(session: SessionContext, id: string) {
  return scope(session, async (tx) => {
    const [call] = await tx.select().from(schema.calls).where(eq(schema.calls.id, id)).limit(1);
    if (!call) throw notFound("Call");

    const [prospect] = call.prospectId
      ? await tx
          .select({
            id: schema.prospects.id,
            fullName: schema.prospects.fullName,
            title: schema.prospects.title,
            phone: schema.prospects.phone,
            timezone: schema.prospects.timezone,
            companyId: schema.prospects.companyId,
          })
          .from(schema.prospects)
          .where(eq(schema.prospects.id, call.prospectId))
          .limit(1)
      : [];

    const [company] = prospect?.companyId
      ? await tx
          .select({ id: schema.companies.id, name: schema.companies.name })
          .from(schema.companies)
          .where(eq(schema.companies.id, prospect.companyId))
          .limit(1)
      : [];

    return { call, prospect: prospect ?? null, company: company ?? null };
  });
}

// ---------------------------------------------------------------------------
// Mailboxes and sending health
// ---------------------------------------------------------------------------

export async function listMailboxes(session: SessionContext) {
  return scope(session, (tx) =>
    tx.select().from(schema.mailboxes).orderBy(schema.mailboxes.email),
  );
}

export async function getSendingHealth(session: SessionContext) {
  const since = new Date(Date.now() - 7 * 86_400_000);

  return scope(session, async (tx) => {
    const mailboxes = await tx.select().from(schema.mailboxes).orderBy(schema.mailboxes.email);

    const blocks = await tx
      .select({
        rule: schema.guardrailEvents.rule,
        channel: schema.guardrailEvents.channel,
        n: count(),
        latest: sql<Date>`max(${schema.guardrailEvents.createdAt})`,
        example: sql<string>`(array_agg(${schema.guardrailEvents.reason} ORDER BY ${schema.guardrailEvents.createdAt} DESC))[1]`,
      })
      .from(schema.guardrailEvents)
      .where(gte(schema.guardrailEvents.createdAt, since))
      .groupBy(schema.guardrailEvents.rule, schema.guardrailEvents.channel)
      .orderBy(desc(count()));

    const [volume] = await tx
      .select({
        sent: sql<number>`count(*) FILTER (WHERE ${schema.emails.state} IN ('sent','delivered'))::int`,
        bounced: sql<number>`count(*) FILTER (WHERE ${schema.emails.state} = 'bounced')::int`,
        complained: sql<number>`count(*) FILTER (WHERE ${schema.emails.state} = 'complained')::int`,
        failed: sql<number>`count(*) FILTER (WHERE ${schema.emails.state} = 'failed')::int`,
      })
      .from(schema.emails)
      .where(gte(schema.emails.createdAt, since));

    const [settings] = await tx
      .select()
      .from(schema.settings)
      .where(eq(schema.settings.orgId, session.orgId))
      .limit(1);

    // Aggregates always return exactly one row; the tuple destructure makes it
    // look optional. Default the zeros so every consumer gets a stable shape.
    return {
      mailboxes,
      blocks,
      volume: {
        sent: Number(volume?.sent ?? 0),
        bounced: Number(volume?.bounced ?? 0),
        complained: Number(volume?.complained ?? 0),
        failed: Number(volume?.failed ?? 0),
      },
      settings: settings ?? null,
      since,
    };
  });
}

// ---------------------------------------------------------------------------
// Suppressions
// ---------------------------------------------------------------------------

export async function listSuppressions(
  session: SessionContext,
  filters: { page: number; q?: string; kind?: "email" | "domain" | "phone" },
) {
  const s = schema.suppressions;
  const conditions = [
    filters.q ? ilike(s.value, `%${filters.q}%`) : undefined,
    filters.kind ? eq(s.kind, filters.kind) : undefined,
  ].filter(Boolean);
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  return scope(session, async (tx) => {
    const rows = await tx
      .select({
        id: s.id,
        scope: s.scope,
        kind: s.kind,
        value: s.value,
        reason: s.reason,
        source: s.source,
        createdAt: s.createdAt,
        createdByEmail: schema.users.email,
      })
      .from(s)
      .leftJoin(schema.users, eq(schema.users.id, s.createdBy))
      .where(where)
      .orderBy(desc(s.createdAt))
      .limit(PAGE_SIZE)
      .offset(offsetFor(filters.page));

    const [totals] = await tx.select({ n: count() }).from(s).where(where);
    return { rows, total: Number(totals?.n ?? 0) };
  });
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

/** Read model for the Activity Log screen — one row per activity entry. */
export async function listActivityLog(
  session: SessionContext,
  filters: { page: number; type?: string },
) {
  const a = schema.activities;
  const where = filters.type ? sql`${a.type}::text = ${filters.type}` : undefined;

  return scope(session, async (tx) => {
    const rows = await tx
      .select({
        id: a.id,
        type: a.type,
        actor: a.actor,
        summary: a.summary,
        metadata: a.metadata,
        channel: sql<string>`CASE
          WHEN ${a.type} IN ('email_sent','email_opened','email_replied','email_bounced') THEN 'email'
          WHEN ${a.type} IN ('call_placed','call_connected','call_completed','call_voicemail') THEN 'call'
          ELSE 'system'
        END`,
        occurredAt: a.occurredAt,
        prospectId: a.prospectId,
        prospectName: schema.prospects.fullName,
        campaignName: schema.campaigns.name,
      })
      .from(a)
      .leftJoin(schema.prospects, eq(schema.prospects.id, a.prospectId))
      .leftJoin(schema.campaigns, eq(schema.campaigns.id, a.campaignId))
      .where(where)
      .orderBy(desc(a.occurredAt))
      .limit(PAGE_SIZE)
      .offset(offsetFor(filters.page));

    const [totals] = await tx.select({ n: count() }).from(a).where(where);
    return { rows, total: Number(totals?.n ?? 0) };
  });
}

/** Read model for the Sending Health panel — recent guardrail denials. */
export async function listGuardrailEvents(
  session: SessionContext,
  filters: { page: number; channel?: string },
) {
  const g = schema.guardrailEvents;
  const where = filters.channel ? eq(g.channel, filters.channel) : undefined;

  return scope(session, async (tx) => {
    const rows = await tx
      .select({
        id: g.id,
        prospectId: g.prospectId,
        prospectName: schema.prospects.fullName,
        campaignId: g.campaignId,
        campaignName: schema.campaigns.name,
        mailboxId: g.mailboxId,
        channel: g.channel,
        rule: g.rule,
        reason: g.reason,
        retryAfter: g.retryAfter,
        createdAt: g.createdAt,
      })
      .from(g)
      .leftJoin(schema.prospects, eq(schema.prospects.id, g.prospectId))
      .leftJoin(schema.campaigns, eq(schema.campaigns.id, g.campaignId))
      .where(where)
      .orderBy(desc(g.createdAt))
      .limit(PAGE_SIZE)
      .offset(offsetFor(filters.page));

    const [totals] = await tx.select({ n: count() }).from(g).where(where);
    return { rows, total: Number(totals?.n ?? 0) };
  });
}

/** Read model for the Spend screen — provider usage and agent cost for the month. */
export async function getSpendSummary(session: SessionContext) {
  return getSpend(session);
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

export async function listActivity(
  session: SessionContext,
  filters: { page: number; type?: string },
) {
  const a = schema.activities;
  const where = filters.type ? sql`${a.type}::text = ${filters.type}` : undefined;


  return scope(session, async (tx) => {
    const rows = await tx
      .select({
        id: a.id,
        type: a.type,
        actor: a.actor,
        summary: a.summary,
        metadata: a.metadata,
        occurredAt: a.occurredAt,
        prospectId: a.prospectId,
        prospectName: schema.prospects.fullName,
        campaignName: schema.campaigns.name,
      })
      .from(a)
      .leftJoin(schema.prospects, eq(schema.prospects.id, a.prospectId))
      .leftJoin(schema.campaigns, eq(schema.campaigns.id, a.campaignId))
      .where(where)
      .orderBy(desc(a.occurredAt))
      .limit(PAGE_SIZE)
      .offset(offsetFor(filters.page));

    const [totals] = await tx.select({ n: count() }).from(a).where(where);
    return { rows, total: Number(totals?.n ?? 0) };
  });
}

export async function listJobs(
  session: SessionContext,
  filters: { page: number; queue?: string; status?: string },
) {
  const j = schema.jobs;
  const conditions = [
    filters.queue ? eq(j.queue, filters.queue) : undefined,
    filters.status ? sql`${j.status}::text = ${filters.status}` : undefined,
  ].filter(Boolean);
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  return scope(session, async (tx) => {
    const rows = await tx
      .select()
      .from(j)
      .where(where)
      .orderBy(desc(j.createdAt))
      .limit(PAGE_SIZE)
      .offset(offsetFor(filters.page));

    const [totals] = await tx.select({ n: count() }).from(j).where(where);

    const byStatus = await tx
      .select({ status: j.status, n: count() })
      .from(j)
      .groupBy(j.status);

    return { rows, total: Number(totals?.n ?? 0), byStatus };
  });
}

export async function listAgentRuns(
  session: SessionContext,
  filters: { page: number; agent?: string },
) {
  const r = schema.agentRuns;
  const where = filters.agent ? eq(r.agent, filters.agent) : undefined;

  return scope(session, async (tx) => {
    const rows = await tx
      .select({
        id: r.id,
        agent: r.agent,
        model: r.model,
        schemaValid: r.schemaValid,
        repairAttempted: r.repairAttempted,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        costUsd: r.costUsd,
        latencyMs: r.latencyMs,
        error: r.error,
        createdAt: r.createdAt,
        prospectId: r.prospectId,
        prospectName: schema.prospects.fullName,
      })
      .from(r)
      .leftJoin(schema.prospects, eq(schema.prospects.id, r.prospectId))
      .where(where)
      .orderBy(desc(r.createdAt))
      .limit(PAGE_SIZE)
      .offset(offsetFor(filters.page));

    const [totals] = await tx.select({ n: count() }).from(r).where(where);
    return { rows, total: Number(totals?.n ?? 0) };
  });
}

/** Spend by provider for the current calendar month, against the configured cap. */
export async function getSpend(session: SessionContext) {
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  return scope(session, async (tx) => {
    const byProvider = await tx
      .select({
        provider: schema.providerUsage.provider,
        units: sql<number>`sum(${schema.providerUsage.units})::int`,
        costUsd: sql<string>`sum(${schema.providerUsage.costUsd})::text`,
      })
      .from(schema.providerUsage)
      .where(gte(schema.providerUsage.period, monthStart.toISOString().slice(0, 10)))
      .groupBy(schema.providerUsage.provider)
      .orderBy(desc(sql`sum(${schema.providerUsage.costUsd})`));

    const [agentCost] = await tx
      .select({ costUsd: sql<string>`coalesce(sum(${schema.agentRuns.costUsd}), 0)::text` })
      .from(schema.agentRuns)
      .where(gte(schema.agentRuns.createdAt, monthStart));

    const [settings] = await tx
      .select({
        monthlySpendCapUsd: schema.settings.monthlySpendCapUsd,
        spendHardCutoff: schema.settings.spendHardCutoff,
      })
      .from(schema.settings)
      .where(eq(schema.settings.orgId, session.orgId))
      .limit(1);

    const total =
      byProvider.reduce((sum, row) => sum + Number(row.costUsd ?? 0), 0) + Number(agentCost?.costUsd ?? 0);

    return {
      byProvider,
      agentCostUsd: Number(agentCost?.costUsd ?? 0),
      totalUsd: total,
      capUsd: settings?.monthlySpendCapUsd ? Number(settings.monthlySpendCapUsd) : null,
      hardCutoff: settings?.spendHardCutoff ?? true,
      monthStart,
    };
  });
}

// ---------------------------------------------------------------------------
// Settings and dashboard
// ---------------------------------------------------------------------------

export async function getSettings(session: SessionContext) {
  return scope(session, async (tx) => {
    const [row] = await tx
      .select()
      .from(schema.settings)
      .where(eq(schema.settings.orgId, session.orgId))
      .limit(1);
    if (!row) throw notFound("Settings");
    return row;
  });
}

export async function listMembers(session: SessionContext) {
  return scope(session, (tx) =>
    tx
      .select({
        userId: schema.orgMembers.userId,
        role: schema.orgMembers.role,
        email: schema.users.email,
        name: schema.users.name,
        lastLoginAt: schema.users.lastLoginAt,
        joinedAt: schema.orgMembers.createdAt,
      })
      .from(schema.orgMembers)
      .innerJoin(schema.users, eq(schema.users.id, schema.orgMembers.userId))
      .orderBy(schema.orgMembers.createdAt),
  );
}

/**
 * The dashboard's numbers.
 *
 * Deliberately counts what exists rather than reporting a rate: a reply rate
 * computed over four sends is noise presented as a metric, and this product's
 * whole argument is against optimizing the number that goes up.
 */
export async function getDashboard(session: SessionContext) {
  const dayAgo = new Date(Date.now() - 86_400_000);
  const weekAgo = new Date(Date.now() - 7 * 86_400_000);

  return scope(session, async (tx) => {
    const [pipeline] = await tx
      .select({
        total: count(),
        needsReview: sql<number>`count(*) FILTER (WHERE ${schema.prospects.status} = 'needs_review')::int`,
        qualified: sql<number>`count(*) FILTER (WHERE ${schema.prospects.status} = 'qualified')::int`,
        contacted: sql<number>`count(*) FILTER (WHERE ${schema.prospects.status} = 'contacted')::int`,
        engaged: sql<number>`count(*) FILTER (WHERE ${schema.prospects.status} = 'engaged')::int`,
        booked: sql<number>`count(*) FILTER (WHERE ${schema.prospects.status} = 'meeting_booked')::int`,
        pausedByReply: sql<number>`count(*) FILTER (WHERE ${schema.prospects.pausedByHumanReply})::int`,
      })
      .from(schema.prospects);

    const [pendingApproval] = await tx
      .select({ n: count() })
      .from(schema.emails)
      .where(eq(schema.emails.state, "pending_approval"));

    const [unhandledReplies] = await tx
      .select({ n: count() })
      .from(schema.emailReplies)
      .where(isNull(schema.emailReplies.handledAt));

    const [sentToday] = await tx
      .select({ n: count() })
      .from(schema.emails)
      .where(and(gte(schema.emails.sentAt, dayAgo), sql`${schema.emails.sentAt} IS NOT NULL`));

    const [callsWeek] = await tx
      .select({ n: count() })
      .from(schema.calls)
      .where(gte(schema.calls.createdAt, weekAgo));

    const [blocksWeek] = await tx
      .select({ n: count() })
      .from(schema.guardrailEvents)
      .where(gte(schema.guardrailEvents.createdAt, weekAgo));

    const [activeCampaigns] = await tx
      .select({ n: count() })
      .from(schema.campaigns)
      .where(eq(schema.campaigns.status, "active"));

    const [icpCount] = await tx.select({ n: count() }).from(schema.icps);
    const [mailboxCount] = await tx.select({ n: count() }).from(schema.mailboxes);

    const dueSoon = await tx
      .select({
        id: schema.prospects.id,
        fullName: schema.prospects.fullName,
        nextActionAt: schema.prospects.nextActionAt,
        nextActionType: schema.prospects.nextActionType,
        companyName: schema.companies.name,
      })
      .from(schema.prospects)
      .leftJoin(schema.companies, eq(schema.companies.id, schema.prospects.companyId))
      .where(sql`${schema.prospects.nextActionAt} IS NOT NULL`)
      .orderBy(schema.prospects.nextActionAt)
      .limit(8);

    const recent = await tx
      .select({
        id: schema.activities.id,
        type: schema.activities.type,
        summary: schema.activities.summary,
        actor: schema.activities.actor,
        occurredAt: schema.activities.occurredAt,
        prospectId: schema.activities.prospectId,
        prospectName: schema.prospects.fullName,
      })
      .from(schema.activities)
      .leftJoin(schema.prospects, eq(schema.prospects.id, schema.activities.prospectId))
      .orderBy(desc(schema.activities.occurredAt))
      .limit(10);

    return {
      pipeline,
      pendingApproval: Number(pendingApproval?.n ?? 0),
      unhandledReplies: Number(unhandledReplies?.n ?? 0),
      sentToday: Number(sentToday?.n ?? 0),
      callsWeek: Number(callsWeek?.n ?? 0),
      blocksWeek: Number(blocksWeek?.n ?? 0),
      activeCampaigns: Number(activeCampaigns?.n ?? 0),
      icpCount: Number(icpCount?.n ?? 0),
      mailboxCount: Number(mailboxCount?.n ?? 0),
      dueSoon,
      recent,
    };
  });
}

/** Every configured data source, keyed by id for the Sources screen. */
export async function listDataSources(session: SessionContext) {
  return scope(session, (tx) => tx.select().from(schema.dataSources).orderBy(desc(schema.dataSources.updatedAt)));
}

/**
 * Real, aggregated `source_performance` history per source name — the actual
 * counts a run reported, not a placeholder. A source with no rows here has
 * simply never run yet, and the caller should say that rather than invent a
 * number for it.
 */
export async function getSourcePerformanceSummary(session: SessionContext) {
  return scope(session, (tx) =>
    tx
      .select({
        source: schema.sourcePerformance.source,
        leadsReturned: sql<number>`sum(${schema.sourcePerformance.leadsReturned})::int`,
        leadsQualified: sql<number>`sum(${schema.sourcePerformance.leadsQualified})::int`,
        avgFitScore: sql<string>`avg(${schema.sourcePerformance.avgFitScore})`,
        avgLatencyMs: sql<number>`avg(${schema.sourcePerformance.latencyMs})::int`,
        costUsd: sql<string>`sum(${schema.sourcePerformance.costUsd})`,
        runs: count(),
        lastRanAt: sql<string>`max(${schema.sourcePerformance.ranAt})`,
      })
      .from(schema.sourcePerformance)
      .groupBy(schema.sourcePerformance.source),
  );
}
