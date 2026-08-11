import { providerError } from "@outreach/shared";
import type { TestResult } from "@outreach/shared";
import type { AdapterCtx, CostEstimate, LeadSource, RawLead, SourceQuery } from "../types";

/**
 * SEC EDGAR full text search.
 *
 * Free, keyless, USA only — public companies and their filed subsidiaries.
 * Narrow coverage (only SEC-reporting companies, not the private SMBs most
 * ICPs actually target) but real, free, and useful for an ICP that
 * specifically targets public or newly-public companies. Registered
 * `requiresCredential: false`, the same as Overpass.
 *
 * SEC.gov requires every request to carry an identifying User-Agent — a
 * generic library default gets a 403, confirmed while building this adapter.
 * Endpoint and field names confirmed live against efts.sec.gov.
 */

const EDGAR_SEARCH_BASE = "https://efts.sec.gov/LATEST/search-index";
const USER_AGENT = "outreach-system/1.0 (self-hosted outbound tool; contact via project owner)";

interface EdgarHit {
  _source?: {
    display_names?: string[];
    ciks?: string[];
    sics?: string[];
    biz_locations?: string[];
    biz_states?: string[];
    form?: string;
    file_date?: string;
    adsh?: string;
  };
}

interface EdgarSearchResponse {
  hits?: { total?: { value?: number }; hits?: EdgarHit[] };
}

async function edgarFetch(params: Record<string, string>, ctx: AdapterCtx): Promise<{ status: number; body: unknown; text: string }> {
  const url = new URL(EDGAR_SEARCH_BASE);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const response = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: ctx.signal ?? null });
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

/** `CIK0000320193` -> `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0000320193` */
function filerUrl(cik: string): string {
  const digits = cik.replace(/\D/g, "").padStart(10, "0");
  return `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${digits}`;
}

export const secEdgarProvider: LeadSource = {
  id: "sec_edgar",
  category: "lead_source",

  async testConnection(ctx: AdapterCtx): Promise<TestResult> {
    const startedAt = Date.now();
    try {
      const { status, body, text } = await edgarFetch({ q: '"annual report"', forms: "10-K" }, ctx);
      const latencyMs = Date.now() - startedAt;

      if (status === 403) {
        return { ok: false, message: "SEC EDGAR returned 403 — it requires a real identifying User-Agent, which this adapter sends automatically. Try again in a moment.", latencyMs };
      }
      if (status >= 400) {
        return { ok: false, message: `SEC EDGAR returned ${status}: ${text.slice(0, 200)}`, latencyMs };
      }

      const total = (body as EdgarSearchResponse).hits?.total?.value ?? 0;
      return { ok: true, message: `Connected. ${total.toLocaleString()}+ filings match the test query.`, latencyMs };
    } catch {
      return { ok: false, message: "Could not reach efts.sec.gov. Check this server's outbound network access.", latencyMs: Date.now() - startedAt };
    }
  },

  async search(sourceQuery: SourceQuery, ctx: AdapterCtx): Promise<RawLead[]> {
    const filters = (sourceQuery.filters ?? {}) as { forms?: string; sic?: string };
    const params: Record<string, string> = { q: `"${sourceQuery.query}"` };
    if (filters.forms) params.forms = filters.forms;

    const { status, body, text } = await edgarFetch(params, ctx);
    if (status >= 400) {
      throw providerError("sec_edgar", `SEC EDGAR search failed (${status}): ${text.slice(0, 300)}`);
    }

    const hits = (body as EdgarSearchResponse).hits?.hits ?? [];
    const limit = Math.min(sourceQuery.limit ?? 20, 40);
    const seen = new Set<string>();
    const leads: RawLead[] = [];

    for (const hit of hits) {
      const src = hit._source;
      const name = src?.display_names?.[0];
      const cik = src?.ciks?.[0];
      if (!name || !cik || seen.has(cik)) continue;
      if (filters.sic && !src?.sics?.includes(filters.sic)) continue;
      seen.add(cik);

      leads.push({
        companyName: name.replace(/\s*\(CIK \d+\)\s*$/, ""),
        city: src?.biz_locations?.[0]?.split(",")[0]?.trim(),
        country: src?.biz_states?.[0] ? "United States" : undefined,
        sourceUrl: filerUrl(cik),
        raw: { cik, sic: src?.sics?.[0], form: src?.form, fileDate: src?.file_date },
      });
      if (leads.length >= limit) break;
    }

    return leads;
  },

  estimateCost(): CostEstimate {
    return { costUsd: 0, unit: "search" };
  },
};
