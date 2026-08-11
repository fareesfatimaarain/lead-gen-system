import { providerError } from "@outreach/shared";
import type { TestResult } from "@outreach/shared";
import type { AdapterCtx, CostEstimate, LeadSource, RawLead, SourceQuery } from "../types";

/**
 * Bayut — UAE property listings, in two modes:
 *
 * - `rapidapi` (default): an unofficial third-party API ("uae-real-estate2" on
 *   RapidAPI) that republishes Bayut's listing data. It is NOT authorized by
 *   Bayut — using it carries real ToS/legal exposure, which is why it is
 *   labeled as unofficial everywhere it appears in this product, not just
 *   here. Request shape (host, endpoint, auth headers, body params) is
 *   confirmed against the product's own published docs. The response's exact
 *   field names are not confirmed — no test account was available — so
 *   parsing below tries the plausible candidates and keeps the raw record.
 * - `enterprise`: Bayut's official Enterprise API. Its reference is
 *   partner-gated and was not accessible while building this — calling this
 *   mode fails with a clear message instead of guessing an endpoint. Whoever
 *   has partner access can fill in `searchEnterprise` below without touching
 *   anything else in the system — every caller goes through the same
 *   `LeadSource` interface regardless of mode.
 */

interface BayutConfig {
  mode?: "rapidapi" | "enterprise";
}

function mode(ctx: AdapterCtx): "rapidapi" | "enterprise" {
  const m = (ctx.config as BayutConfig).mode;
  return m === "enterprise" ? "enterprise" : "rapidapi";
}

const RAPIDAPI_HOST = "uae-real-estate2.p.rapidapi.com";

function pick(record: Record<string, unknown>, candidates: string[]): string | undefined {
  for (const key of candidates) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return undefined;
}

async function rapidapiSearch(sourceQuery: SourceQuery, ctx: AdapterCtx): Promise<RawLead[]> {
  const filters = (sourceQuery.filters ?? {}) as { purpose?: string; categories?: string[]; locationsIds?: number[] };

  const response = await fetch(`https://${RAPIDAPI_HOST}/properties_search`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-rapidapi-key": ctx.secret,
      "x-rapidapi-host": RAPIDAPI_HOST,
    },
    body: JSON.stringify({
      purpose: filters.purpose ?? "for-sale",
      ...(filters.categories ? { categories: filters.categories } : {}),
      ...(filters.locationsIds ? { locations_ids: filters.locationsIds } : {}),
    }),
    signal: ctx.signal ?? null,
  });

  if (response.status === 401 || response.status === 403) {
    throw providerError("bayut", "This RapidAPI key was rejected. Check it at rapidapi.com under your subscribed apps.");
  }
  if (!response.ok) {
    throw providerError("bayut", `Bayut (RapidAPI) search failed (${response.status}).`);
  }

  const body = (await response.json()) as { hits?: Record<string, unknown>[]; results?: Record<string, unknown>[] } | Record<string, unknown>[];
  const records = Array.isArray(body) ? body : (body.hits ?? body.results ?? []);
  const limit = Math.min(sourceQuery.limit ?? 20, 50);

  return records.slice(0, limit).map((r) => ({
    companyName: pick(r, ["agency_name", "agencyName", "title"]),
    fullName: pick(r, ["agent_name", "agentName", "contactName"]),
    phone: pick(r, ["phone_number", "phoneNumber", "contact_number"]),
    city: pick(r, ["location_name", "locationName", "area"]) ?? "Dubai",
    country: "United Arab Emirates",
    sourceUrl: pick(r, ["external_id", "share_url", "url"]),
    raw: r,
  }));
}

async function enterpriseSearch(): Promise<RawLead[]> {
  throw providerError(
    "bayut",
    "Bayut's Enterprise API reference is partner-gated and has not been verified in this codebase. Switch this source back to \"Unofficial (RapidAPI)\" mode, or share the Enterprise API docs to have this mode implemented.",
  );
}

export const bayutProvider: LeadSource = {
  id: "bayut",
  category: "lead_source",

  async testConnection(ctx: AdapterCtx): Promise<TestResult> {
    if (mode(ctx) === "enterprise") {
      return { ok: false, message: "Enterprise mode is not implemented yet — see this source's summary for why." };
    }
    const startedAt = Date.now();
    try {
      const leads = await rapidapiSearch({ query: "", limit: 1, filters: { purpose: "for-sale" } }, ctx);
      return { ok: true, message: `Connected (unofficial RapidAPI source). ${leads.length} sample result(s).`, latencyMs: Date.now() - startedAt };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : "The connection test failed.", latencyMs: Date.now() - startedAt };
    }
  },

  async search(sourceQuery: SourceQuery, ctx: AdapterCtx): Promise<RawLead[]> {
    return mode(ctx) === "enterprise" ? enterpriseSearch() : rapidapiSearch(sourceQuery, ctx);
  },

  /** RapidAPI plans for these listings are typically a flat monthly quota, not per-call billing — no meaningful per-record figure. */
  estimateCost(): CostEstimate {
    return { costUsd: 0, unit: "search (plan quota)" };
  },
};
