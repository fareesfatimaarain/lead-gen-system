import { providerError } from "@outreach/shared";
import type { TestResult } from "@outreach/shared";
import type { AdapterCtx, CostEstimate, LeadSource, RawLead, SourceQuery } from "../types";

/**
 * RentCast — US property records.
 *
 * The "property portal" source: for an ICP that sells to landlords, property
 * investors, or home-service buyers, this is who actually owns the building.
 * USA only — RentCast's coverage does not extend to the UAE.
 *
 * It returns an owner *name* and mailing address, never an email or phone —
 * property records don't carry contact details. Leads come back with no
 * `email`, which `ingestLead` (`@outreach/ingest`) stores as a real prospect
 * with a known name and an unknown contact method, not a discarded row: the
 * intended next step is a skip-trace or enrichment pass this codebase does
 * not build yet.
 *
 * Endpoint, auth header and field names confirmed against
 * developers.rentcast.io/reference/property-records.
 */

const RENTCAST_BASE = "https://api.rentcast.io/v1/properties";

interface RentCastProperty {
  formattedAddress?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  propertyType?: string;
  owner?: {
    names?: string[];
    mailingAddress?: { formattedAddress?: string; city?: string; state?: string };
  };
  ownerOccupied?: boolean;
  id?: string;
}

async function rentcastFetch(params: Record<string, string>, ctx: AdapterCtx): Promise<{ status: number; body: unknown; text: string }> {
  const url = new URL(RENTCAST_BASE);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const response = await fetch(url, { headers: { "X-Api-Key": ctx.secret }, signal: ctx.signal ?? null });
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

export const rentcastProvider: LeadSource = {
  id: "rentcast",
  category: "lead_source",

  async testConnection(ctx: AdapterCtx): Promise<TestResult> {
    const startedAt = Date.now();
    try {
      const { status, body, text } = await rentcastFetch({ city: "Austin", state: "TX", limit: "1" }, ctx);
      const latencyMs = Date.now() - startedAt;

      if (status === 401 || status === 403) {
        return { ok: false, message: "RentCast rejected this API key. Check it at app.rentcast.io/app/api.", latencyMs };
      }
      if (status === 429) {
        return { ok: false, message: "RentCast's free-tier quota is used up for this billing period.", latencyMs };
      }
      if (status >= 400) {
        return { ok: false, message: `RentCast returned ${status}: ${text.slice(0, 200)}`, latencyMs };
      }

      const results = Array.isArray(body) ? body : [];
      return { ok: true, message: "Connected.", detail: { sampleResults: results.length }, latencyMs };
    } catch {
      return { ok: false, message: "Could not reach api.rentcast.io. Check this server's outbound network access.", latencyMs: Date.now() - startedAt };
    }
  },

  async search(sourceQuery: SourceQuery, ctx: AdapterCtx): Promise<RawLead[]> {
    const filters = (sourceQuery.filters ?? {}) as { city?: string; state?: string; zipCode?: string; propertyType?: string };
    if (!filters.city && !filters.zipCode) {
      throw providerError("rentcast", "A city+state or zip code is required to search RentCast.");
    }

    const params: Record<string, string> = { limit: String(Math.min(sourceQuery.limit ?? 20, 50)) };
    if (filters.city) params.city = filters.city;
    if (filters.state) params.state = filters.state;
    if (filters.zipCode) params.zipCode = filters.zipCode;
    if (filters.propertyType) params.propertyType = filters.propertyType;

    const { status, body, text } = await rentcastFetch(params, ctx);
    if (status >= 400) {
      throw providerError("rentcast", `RentCast search failed (${status}): ${text.slice(0, 300)}`);
    }

    const properties = (Array.isArray(body) ? body : []) as RentCastProperty[];
    return properties
      .filter((p) => p.owner?.names?.length && !p.ownerOccupied) // An owner-occupied home is a resident, not a prospect for a B2B pitch.
      .map((p) => ({
        fullName: p.owner!.names![0],
        city: p.city,
        country: "United States",
        sourceUrl: p.id ? `https://app.rentcast.io/app/properties/${p.id}` : undefined,
        raw: { propertyAddress: p.formattedAddress, propertyType: p.propertyType, ownerMailingAddress: p.owner?.mailingAddress?.formattedAddress },
      }));
  },

  /** $0.06–$0.20 per property record depending on plan tier; treated as an estimate, not a bill. */
  estimateCost(sourceQuery: SourceQuery): CostEstimate {
    return { costUsd: 0.1 * Math.min(sourceQuery.limit ?? 20, 50), unit: "property record" };
  },
};
