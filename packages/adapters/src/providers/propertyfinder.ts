import { providerError } from "@outreach/shared";
import type { TestResult } from "@outreach/shared";
import type { AdapterCtx, CostEstimate, LeadSource, RawLead, SourceQuery } from "../types";

/**
 * Property Finder (propertyfinder.ae) — two modes, same shape as `bayut.ts`.
 *
 * - `enterprise`: Property Finder's official API. Docs are behind a
 *   partner-only password wall (api-docs.propertyfinder.net/enterprise-api) —
 *   not accessible while building this. Stubbed, not guessed.
 * - `rapidapi`: unofficial. UNLIKE Bayut's, no single RapidAPI product for
 *   Property Finder's own data could be confirmed while building this — the
 *   marketplace has several similarly-named listings and at least one
 *   ("uae-real-estate2") turned out on inspection to be Bayut data despite
 *   its name. Rather than guess a host and silently return wrong data, the
 *   host is a required config field: paste in whichever product's host you
 *   actually subscribed to on RapidAPI, from that listing's own "Endpoints"
 *   tab. The request/response handling below is generic and defensive
 *   (candidate field names, raw record kept) because it was written without
 *   a live account to confirm the exact shape against.
 */

interface PfConfig {
  mode?: "rapidapi" | "enterprise";
  rapidApiHost?: string;
}

function readConfig(ctx: AdapterCtx): PfConfig {
  return ctx.config as PfConfig;
}

function pick(record: Record<string, unknown>, candidates: string[]): string | undefined {
  for (const key of candidates) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return undefined;
}

async function rapidapiSearch(sourceQuery: SourceQuery, ctx: AdapterCtx): Promise<RawLead[]> {
  const cfg = readConfig(ctx);
  const host = cfg.rapidApiHost?.trim();
  if (!host) {
    throw providerError("propertyfinder", "No RapidAPI host is set for this source. Add the host from your RapidAPI subscription's Endpoints tab in the source's config.");
  }

  const filters = (sourceQuery.filters ?? {}) as { purpose?: string; category?: string; location?: string };
  const url = new URL(`https://${host}/properties/search`);
  url.searchParams.set("purpose", filters.purpose ?? "for-sale");
  if (filters.category) url.searchParams.set("category", filters.category);
  if (filters.location) url.searchParams.set("location", filters.location);

  const response = await fetch(url, {
    headers: { "x-rapidapi-key": ctx.secret, "x-rapidapi-host": host },
    signal: ctx.signal ?? null,
  });

  if (response.status === 401 || response.status === 403) {
    throw providerError("propertyfinder", "This RapidAPI key was rejected. Check it at rapidapi.com under your subscribed apps.");
  }
  if (!response.ok) {
    throw providerError("propertyfinder", `Property Finder (RapidAPI, host: ${host}) search failed (${response.status}). Confirm this is the right endpoint path for the product you subscribed to.`);
  }

  const body = (await response.json()) as { results?: Record<string, unknown>[]; data?: Record<string, unknown>[] } | Record<string, unknown>[];
  const records = Array.isArray(body) ? body : (body.results ?? body.data ?? []);
  const limit = Math.min(sourceQuery.limit ?? 20, 50);

  return records.slice(0, limit).map((r) => ({
    companyName: pick(r, ["agency_name", "agencyName", "broker_name"]),
    fullName: pick(r, ["agent_name", "agentName"]),
    phone: pick(r, ["phone", "phone_number", "contact_number"]),
    city: pick(r, ["location", "area", "community"]) ?? "Dubai",
    country: "United Arab Emirates",
    sourceUrl: pick(r, ["url", "share_url"]),
    raw: r,
  }));
}

async function enterpriseSearch(): Promise<RawLead[]> {
  throw providerError(
    "propertyfinder",
    "Property Finder's Enterprise API reference is partner-gated and has not been verified in this codebase. Switch this source back to \"Unofficial (RapidAPI)\" mode, or share the Enterprise API docs to have this mode implemented.",
  );
}

export const propertyFinderProvider: LeadSource = {
  id: "propertyfinder",
  category: "lead_source",

  async testConnection(ctx: AdapterCtx): Promise<TestResult> {
    const cfg = readConfig(ctx);
    if (cfg.mode === "enterprise") {
      return { ok: false, message: "Enterprise mode is not implemented yet — see this source's summary for why." };
    }
    if (!cfg.rapidApiHost?.trim()) {
      return { ok: false, message: "Set the RapidAPI host from your subscription's Endpoints tab first." };
    }
    const startedAt = Date.now();
    try {
      const leads = await rapidapiSearch({ query: "", limit: 1 }, ctx);
      return { ok: true, message: `Connected to ${cfg.rapidApiHost}. ${leads.length} sample result(s).`, latencyMs: Date.now() - startedAt };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : "The connection test failed.", latencyMs: Date.now() - startedAt };
    }
  },

  async search(sourceQuery: SourceQuery, ctx: AdapterCtx): Promise<RawLead[]> {
    return readConfig(ctx).mode === "enterprise" ? enterpriseSearch() : rapidapiSearch(sourceQuery, ctx);
  },

  estimateCost(): CostEstimate {
    return { costUsd: 0, unit: "search (plan quota)" };
  },
};
