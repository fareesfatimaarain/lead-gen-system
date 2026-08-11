import { and, eq, isNull, schema } from "@outreach/db";
import type { Tx } from "@outreach/db";
import { normalizeDomain } from "@outreach/shared";

/**
 * Turns one raw lead — from a CSV row, an Overpass node, a Hunter or Apollo
 * result — into `companies` and `prospects` rows, or explains why it did not.
 *
 * This is the one place that logic lives. It used to be duplicated inside the
 * CSV import action; every source that finds leads (manual upload or an
 * adapter a worker calls) goes through this instead, so the suppression check
 * and the dedup rules cannot drift between the two paths.
 *
 * Deliberately mirrors the subset of `RawLead` (from `@outreach/adapters`)
 * this needs, rather than importing it — a handful of string fields does not
 * justify pulling the adapter package's dependencies into every caller.
 */
export interface IngestableLead {
  fullName?: string;
  firstName?: string;
  lastName?: string;
  title?: string;
  email?: string;
  phone?: string;
  linkedinUrl?: string;
  companyName?: string;
  companyDomain?: string;
  country?: string;
  city?: string;
  timezone?: string;
  sourceUrl?: string;
}

export interface IngestParams {
  orgId: string;
  lead: IngestableLead;
  /** Adapter registry id or a manual source name — stored on the row for attribution. */
  source: string;
  discoveryRunId?: string;
  campaignId?: string | null;
}

export type IngestOutcome =
  | { kind: "suppressed" }
  | { kind: "duplicate_prospect"; companyId: string | null; prospectId: string }
  | { kind: "duplicate_company"; companyId: string }
  | { kind: "prospect_created"; companyId: string | null; prospectId: string; companyCreated: boolean }
  | { kind: "company_created"; companyId: string };

/**
 * A lead with no email is still worth storing if it names a company (a
 * place-based source like OpenStreetMap) or a person (a property-records
 * source, which gives an owner's name and mailing address but never an email
 * or phone). Both land as real rows — a company-only row, or a prospect with
 * no contact method yet — left for a later enrichment pass to complete rather
 * than discarded for being incomplete today.
 */
export async function ingestLead(tx: Tx, params: IngestParams): Promise<IngestOutcome> {
  const { orgId, lead, source } = params;
  const email = lead.email?.toLowerCase().trim() || null;
  const domain = normalizeDomain(lead.companyDomain) ?? (email ? email.split("@")[1] ?? null : null);
  const fullName = lead.fullName || [lead.firstName, lead.lastName].filter(Boolean).join(" ") || null;

  if (email) {
    const [suppressedByEmail] = await tx
      .select({ id: schema.suppressions.id })
      .from(schema.suppressions)
      .where(and(eq(schema.suppressions.kind, "email"), eq(schema.suppressions.value, email)))
      .limit(1);
    if (suppressedByEmail) return { kind: "suppressed" };
  }
  if (domain) {
    const [suppressedByDomain] = await tx
      .select({ id: schema.suppressions.id })
      .from(schema.suppressions)
      .where(and(eq(schema.suppressions.kind, "domain"), eq(schema.suppressions.value, domain)))
      .limit(1);
    if (suppressedByDomain) return { kind: "suppressed" };
  }

  if (email) {
    const [existingProspect] = await tx
      .select({ id: schema.prospects.id, companyId: schema.prospects.companyId })
      .from(schema.prospects)
      .where(eq(schema.prospects.email, email))
      .limit(1);
    if (existingProspect) {
      return { kind: "duplicate_prospect", companyId: existingProspect.companyId, prospectId: existingProspect.id };
    }
  }

  const { companyId, companyCreated } = await resolveCompany(tx, orgId, lead, source, domain);

  if (!email && !fullName) {
    return companyCreated && companyId
      ? { kind: "company_created", companyId }
      : { kind: "duplicate_company", companyId: companyId! };
  }

  if (!email && fullName) {
    // No unique index can cover a nullable email, so a named-but-emailless
    // lead (e.g. a property owner) is deduped in code: same name at the same
    // company (or the same name with no company at all) is the same person.
    const existing = await tx
      .select({ id: schema.prospects.id, companyId: schema.prospects.companyId })
      .from(schema.prospects)
      .where(
        companyId
          ? and(isNull(schema.prospects.email), eq(schema.prospects.fullName, fullName), eq(schema.prospects.companyId, companyId))
          : and(isNull(schema.prospects.email), eq(schema.prospects.fullName, fullName), isNull(schema.prospects.companyId)),
      )
      .limit(1);
    if (existing[0]) {
      return { kind: "duplicate_prospect", companyId: existing[0].companyId, prospectId: existing[0].id };
    }
  }

  const [prospect] = await tx
    .insert(schema.prospects)
    .values({
      orgId,
      companyId,
      campaignId: params.campaignId ?? null,
      firstName: lead.firstName || null,
      lastName: lead.lastName || null,
      fullName,
      title: lead.title || null,
      email,
      emailSource: source,
      phone: lead.phone || null,
      linkedinUrl: lead.linkedinUrl || null,
      country: lead.country || null,
      city: lead.city || null,
      timezone: lead.timezone || null,
      status: "discovered",
      source,
      sourceUrl: lead.sourceUrl || null,
      discoveryRunId: params.discoveryRunId ?? null,
    })
    .returning({ id: schema.prospects.id });

  return { kind: "prospect_created", companyId, prospectId: prospect!.id, companyCreated };
}

async function resolveCompany(
  tx: Tx,
  orgId: string,
  lead: IngestableLead,
  source: string,
  domain: string | null,
): Promise<{ companyId: string | null; companyCreated: boolean }> {
  if (!domain && !lead.companyName) return { companyId: null, companyCreated: false };

  if (domain) {
    const [existing] = await tx
      .select({ id: schema.companies.id })
      .from(schema.companies)
      .where(eq(schema.companies.domain, domain))
      .limit(1);
    if (existing) return { companyId: existing.id, companyCreated: false };
  } else if (lead.sourceUrl) {
    // No domain to dedup on (place-based sources rarely have a website) — the
    // source's own id for this record is the next best key, so a re-run
    // updates the same row instead of creating a duplicate business.
    const [existing] = await tx
      .select({ id: schema.companies.id })
      .from(schema.companies)
      .where(and(eq(schema.companies.source, source), eq(schema.companies.externalId, lead.sourceUrl)))
      .limit(1);
    if (existing) return { companyId: existing.id, companyCreated: false };
  }

  const [created] = await tx
    .insert(schema.companies)
    .values({
      orgId,
      name: lead.companyName || domain || "Unnamed company",
      domain,
      country: lead.country || null,
      city: lead.city || null,
      phone: lead.phone || null,
      source,
      externalId: domain ? null : lead.sourceUrl || null,
      sourceUrl: lead.sourceUrl || null,
    })
    .onConflictDoNothing()
    .returning({ id: schema.companies.id });

  if (created) return { companyId: created.id, companyCreated: true };

  // Lost a race with a concurrent insert of the same domain/externalId — look
  // it up rather than treat it as a failure.
  const [raced] = domain
    ? await tx.select({ id: schema.companies.id }).from(schema.companies).where(eq(schema.companies.domain, domain)).limit(1)
    : await tx
        .select({ id: schema.companies.id })
        .from(schema.companies)
        .where(and(eq(schema.companies.source, source), eq(schema.companies.externalId, lead.sourceUrl ?? "")))
        .limit(1);

  return { companyId: raced?.id ?? null, companyCreated: false };
}
