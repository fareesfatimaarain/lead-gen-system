import { providerError } from "@outreach/shared";
import type { TestResult } from "@outreach/shared";
import type { AdapterCtx, CostEstimate, LeadSource, RawLead, SourceQuery } from "../types";

/**
 * Dubai Land Department transactions — via Dubai Pulse (the emirate's official
 * open-data platform). Real, government-sourced property transaction records:
 * who transacted, where, and for how much — a live-market signal Bayut/PF
 * listings do not give.
 *
 * OAuth flow and the transactions endpoint are confirmed against
 * dubaipulse.gov.ae's published developer instructions. The exact column
 * names in a transaction record are NOT confirmed — no test account was
 * available while building this — so `search()` returns the raw record
 * untouched in `raw` rather than guessing which key is the counterparty name.
 * TODO(verify): once a Dubai Pulse grant exists, inspect one real response and
 * fill in `pickName`/`pickArea` below with the real field names.
 */

const TOKEN_URL = "https://api.dubaipulse.gov.ae/oauth/client_credential/accesstoken?grant_type=client_credentials";
const TRANSACTIONS_URL = "https://api.dubaipulse.gov.ae/open/dld/dld_transactions-open-api";

interface DubaiPulseConfig {
  clientId: string;
}

function readConfig(ctx: AdapterCtx): DubaiPulseConfig {
  const clientId = typeof (ctx.config as Record<string, unknown>).clientId === "string" ? ((ctx.config as Record<string, unknown>).clientId as string) : "";
  if (!clientId) throw providerError("dubai_pulse", "The Dubai Pulse API Key (client id) is not set. Add it on the Connections page.");
  return { clientId };
}

async function getAccessToken(ctx: AdapterCtx): Promise<string> {
  const { clientId } = readConfig(ctx);
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(ctx.secret)}`,
    signal: ctx.signal ?? null,
  });
  if (!response.ok) {
    throw providerError("dubai_pulse", `Dubai Pulse rejected these credentials (${response.status}). Check the API Key and Secret from the grant email.`);
  }
  const body = (await response.json()) as { access_token?: string };
  if (!body.access_token) throw providerError("dubai_pulse", "Dubai Pulse did not return an access token.");
  return body.access_token;
}

/** Best-effort — DLD's exact column names are unconfirmed; tries the plausible candidates, falls through to undefined. */
function pick(record: Record<string, unknown>, candidates: string[]): string | undefined {
  for (const key of candidates) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return undefined;
}

export const dubaiPulseProvider: LeadSource = {
  id: "dubai_pulse",
  category: "lead_source",

  async testConnection(ctx: AdapterCtx): Promise<TestResult> {
    const startedAt = Date.now();
    try {
      await getAccessToken(ctx);
      return { ok: true, message: "Connected to Dubai Pulse.", latencyMs: Date.now() - startedAt };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : "Could not authenticate with Dubai Pulse.", latencyMs: Date.now() - startedAt };
    }
  },

  async search(sourceQuery: SourceQuery, ctx: AdapterCtx): Promise<RawLead[]> {
    const filters = (sourceQuery.filters ?? {}) as { areaNameEn?: string };
    const token = await getAccessToken(ctx);

    const url = new URL(TRANSACTIONS_URL);
    if (filters.areaNameEn) url.searchParams.set("filter", `area_name_en=${filters.areaNameEn}`);
    url.searchParams.set("limit", String(Math.min(sourceQuery.limit ?? 20, 50)));

    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: ctx.signal ?? null });
    if (!response.ok) {
      throw providerError("dubai_pulse", `Dubai Pulse transactions query failed (${response.status}).`);
    }

    const body = (await response.json()) as { data?: Record<string, unknown>[]; result?: Record<string, unknown>[] } | Record<string, unknown>[];
    const records = Array.isArray(body) ? body : (body.data ?? body.result ?? []);

    return records.map((record) => ({
      companyName: pick(record, ["party_name_en", "buyer_name_en", "owner_name_en", "developer_name_en"]),
      city: pick(record, ["area_name_en", "master_project_en"]) ?? "Dubai",
      country: "United Arab Emirates",
      raw: record,
    }));
  },

  /** Dubai Pulse bills per API package purchased, not per call — no meaningful per-record figure to report. */
  estimateCost(): CostEstimate {
    return { costUsd: 0, unit: "query (billed via Dubai Pulse package)" };
  },
};
