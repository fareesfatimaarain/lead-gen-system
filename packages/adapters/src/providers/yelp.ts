import { providerError } from "@outreach/shared";
import type { TestResult } from "@outreach/shared";
import type { AdapterCtx, CostEstimate, LeadSource, RawLead, SourceQuery } from "../types";

/**
 * Yelp Fusion — Business Search.
 *
 * Strongest for USA local businesses; Yelp's UAE coverage is thin, so this is
 * registered as a USA-oriented source rather than a global one like Overpass
 * or Google Places. Free tier is real (no card required at signup) which
 * makes it a reasonable second opinion next to Google Places rather than a
 * pure duplicate.
 *
 * Endpoint, auth and field names confirmed against
 * docs.developer.yelp.com/reference/v3_business_search.
 */

const YELP_BASE = "https://api.yelp.com/v3/businesses/search";

interface YelpBusiness {
  name?: string;
  phone?: string;
  url?: string;
  location?: { display_address?: string[]; city?: string; state?: string; country?: string };
  categories?: { alias?: string; title?: string }[];
  alias?: string;
}

interface YelpSearchResponse {
  businesses?: YelpBusiness[];
  total?: number;
}

async function yelpFetch(params: Record<string, string>, ctx: AdapterCtx): Promise<{ status: number; body: unknown; text: string }> {
  const url = new URL(YELP_BASE);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${ctx.secret}` },
    signal: ctx.signal ?? null,
  });
  const text = await response.text();
  let body: unknown = {};
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text };
    }
  }
  return { status: response.status, body, text };
}

export const yelpProvider: LeadSource = {
  id: "yelp",
  category: "lead_source",

  async testConnection(ctx: AdapterCtx): Promise<TestResult> {
    const startedAt = Date.now();
    try {
      const { status, body, text } = await yelpFetch({ term: "coffee", location: "New York, NY", limit: "1" }, ctx);
      const latencyMs = Date.now() - startedAt;

      if (status === 401) {
        return { ok: false, message: "Yelp rejected this API key. Check it at yelp.com/developers/v3/manage_app.", latencyMs };
      }
      if (status >= 400) {
        return { ok: false, message: `Yelp returned ${status}: ${text.slice(0, 200)}`, latencyMs };
      }

      const data = body as YelpSearchResponse;
      return { ok: true, message: `Connected. ${data.total ?? 0} results for the test query.`, latencyMs };
    } catch {
      return { ok: false, message: "Could not reach api.yelp.com. Check this server's outbound network access.", latencyMs: Date.now() - startedAt };
    }
  },

  async search(sourceQuery: SourceQuery, ctx: AdapterCtx): Promise<RawLead[]> {
    const filters = (sourceQuery.filters ?? {}) as { location?: string; categories?: string };
    if (!filters.location) {
      throw providerError("yelp", "A location (city, state) is required to search Yelp.");
    }

    const params: Record<string, string> = {
      term: sourceQuery.query,
      location: filters.location,
      limit: String(Math.min(sourceQuery.limit ?? 20, 50)),
    };
    if (filters.categories) params.categories = filters.categories;

    const { status, body, text } = await yelpFetch(params, ctx);
    if (status >= 400) {
      throw providerError("yelp", `Yelp search failed (${status}): ${text.slice(0, 300)}`);
    }

    const businesses = (body as YelpSearchResponse).businesses ?? [];
    return businesses
      .filter((b) => b.name)
      .map((b) => ({
        companyName: b.name,
        phone: b.phone || undefined,
        city: b.location?.city,
        country: b.location?.country,
        sourceUrl: b.url,
        raw: { categories: b.categories?.map((c) => c.title), address: b.location?.display_address },
      }));
  },

  /** Business Search is billed per call on Yelp's paid tiers beyond the free monthly quota; treat as a placeholder until a plan is on file. */
  estimateCost(): CostEstimate {
    return { costUsd: 0, unit: "search (within free tier)" };
  },
};
