import { providerError } from "@outreach/shared";
import type { TestResult } from "@outreach/shared";
import type { AdapterCtx, CostEstimate, LeadSource, RawLead, SourceQuery } from "../types";

/**
 * Apollo lead source.
 *
 * TODO(verify): written from Apollo's public API reference (docs.apollo.io)
 * with no paid Apollo account available in this codebase to run it against —
 * `verified: false` on the registry entry reflects that. Two things in
 * particular need confirming against a live account before this is trusted:
 * (1) the exact 403-vs-200 behavior of `mixed_people/api_search` across plan
 * tiers, which several third-party integration guides report as inconsistent
 * with the docs, and (2) that `reveal_personal_emails` on the enrichment call
 * behaves as documented rather than silently omitting the email for
 * GDPR-region people (which the docs say it will, by design — that case is
 * handled below by simply dropping the lead, not guessing at an address).
 *
 * Two calls, because Apollo's search endpoint deliberately does not return
 * contact details — People Search finds candidates, People Enrichment reveals
 * one person's email/phone and is billed separately. This adapter enriches
 * every candidate up to the requested limit, so the cost estimate has to
 * account for both calls, not just the search.
 */

const APOLLO_BASE = "https://api.apollo.io/api/v1";

async function apolloFetch(
  path: string,
  body: Record<string, unknown>,
  ctx: AdapterCtx,
): Promise<{ status: number; body: unknown; text: string }> {
  const response = await fetch(`${APOLLO_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-cache",
      "X-Api-Key": ctx.secret,
    },
    body: JSON.stringify(body),
    signal: ctx.signal ?? null,
  });
  const text = await response.text();
  let parsed: unknown = {};
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { raw: text };
    }
  }
  return { status: response.status, body: parsed, text };
}

interface ApolloSearchPerson {
  id: string;
  first_name?: string;
  title?: string;
  organization?: { name?: string; primary_domain?: string };
}

interface ApolloSearchResponse {
  people?: ApolloSearchPerson[];
  total_entries?: number;
}

interface ApolloEnrichedPerson {
  id?: string;
  first_name?: string;
  last_name?: string;
  title?: string;
  email?: string;
  phone_numbers?: { raw_number?: string }[];
  linkedin_url?: string;
  city?: string;
  country?: string;
  organization?: { name?: string; primary_domain?: string };
}

export const apolloProvider: LeadSource = {
  id: "apollo",
  category: "lead_source",

  /**
   * A search for zero results with a nonsense title still proves the key
   * authenticates and the account can call the search endpoint at all,
   * without spending an enrichment credit.
   */
  async testConnection(ctx: AdapterCtx): Promise<TestResult> {
    const startedAt = Date.now();
    try {
      const { status, body, text } = await apolloFetch(
        "/mixed_people/api_search",
        { person_titles: ["zzz-outreach-system-connectivity-check"], per_page: 1 },
        ctx,
      );
      const latencyMs = Date.now() - startedAt;

      if (status === 401 || status === 403) {
        return { ok: false, message: "Apollo rejected this API key, or this plan cannot call People Search. Check it in Apollo → Settings → API Keys.", latencyMs };
      }
      if (status >= 400) {
        return { ok: false, message: `Apollo returned ${status}: ${text.slice(0, 200)}`, latencyMs };
      }

      const data = body as ApolloSearchResponse;
      return {
        ok: true,
        message: "Connected to Apollo.",
        detail: { totalEntries: data.total_entries ?? 0 },
        latencyMs,
      };
    } catch {
      return { ok: false, message: "Could not reach api.apollo.io. Check this server's outbound network access.", latencyMs: Date.now() - startedAt };
    }
  },

  async search(sourceQuery: SourceQuery, ctx: AdapterCtx): Promise<RawLead[]> {
    const filters = (sourceQuery.filters ?? {}) as {
      titles?: string[];
      seniorities?: string[];
      locations?: string[];
    };
    const titles = filters.titles?.length ? filters.titles : [sourceQuery.query];
    const perPage = Math.min(sourceQuery.limit ?? 25, 50);

    const { status, body, text } = await apolloFetch(
      "/mixed_people/api_search",
      {
        person_titles: titles,
        ...(filters.seniorities?.length ? { person_seniorities: filters.seniorities } : {}),
        ...(filters.locations?.length ? { organization_locations: filters.locations } : {}),
        per_page: perPage,
        page: 1,
      },
      ctx,
    );
    if (status >= 400) {
      throw providerError("apollo", `Apollo search failed (${status}): ${text.slice(0, 300)}`);
    }

    const candidates = (body as ApolloSearchResponse).people ?? [];
    const leads: RawLead[] = [];

    // Enrichment is billed per person, so it runs only for the candidates this
    // call actually asked for — never beyond `sourceQuery.limit`.
    for (const person of candidates.slice(0, perPage)) {
      const enriched = await enrichPerson(person.id, ctx);
      if (!enriched?.email) continue; // No verified path to an address; do not guess one.

      leads.push({
        firstName: enriched.first_name,
        lastName: enriched.last_name,
        fullName: [enriched.first_name, enriched.last_name].filter(Boolean).join(" ") || undefined,
        title: enriched.title ?? person.title,
        email: enriched.email,
        phone: enriched.phone_numbers?.[0]?.raw_number,
        linkedinUrl: enriched.linkedin_url,
        companyName: enriched.organization?.name ?? person.organization?.name,
        companyDomain: enriched.organization?.primary_domain ?? person.organization?.primary_domain,
        country: enriched.country,
        city: enriched.city,
        sourceUrl: `https://app.apollo.io/#/people/${person.id}`,
        raw: enriched as unknown as Record<string, unknown>,
      });
    }

    return leads;
  },

  /**
   * Apollo's published credit pricing varies by plan and is not exposed per
   * call; this is a rough estimate for the spend dashboard, not a bill —
   * one search credit plus one enrichment credit per requested lead.
   */
  estimateCost(sourceQuery: SourceQuery): CostEstimate {
    const count = Math.min(sourceQuery.limit ?? 25, 50);
    return { costUsd: 0.01 + count * 0.05, unit: "search+enrichment" };
  },
};

async function enrichPerson(personId: string, ctx: AdapterCtx): Promise<ApolloEnrichedPerson | null> {
  const { status, body } = await apolloFetch(
    "/people/match",
    { id: personId, reveal_personal_emails: true, reveal_phone_number: false },
    ctx,
  );
  if (status >= 400) return null;
  const person = (body as { person?: ApolloEnrichedPerson }).person;
  return person ?? null;
}
