import { providerError } from "@outreach/shared";
import type { TestResult } from "@outreach/shared";
import type {
  AdapterCtx,
  CostEstimate,
  EmailVerificationResult,
  EmailVerifier,
  LeadSource,
  RawLead,
  SourceQuery,
} from "../types";

/**
 * Hunter.io: Domain Search (lead source) and Email Verifier (verification).
 *
 * Two registry entries sharing one implementation file and one account, because
 * they satisfy two different adapter contracts. Endpoints, params and response
 * field names below are confirmed against hunter.io/api-documentation/v2.
 *
 * TODO(verify): `/v2/account`, used only by `testConnection`, is Hunter's
 * documented account-info endpoint by convention; its response fields were not
 * confirmed from the public docs page fetched for this adapter. The check
 * below only depends on the request succeeding with 200, which is enough to
 * prove the key is valid — do not read a field from that response elsewhere
 * without confirming it against a live account first.
 */

const HUNTER_BASE = "https://api.hunter.io/v2";

async function hunterFetch(
  path: string,
  params: Record<string, string>,
  ctx: AdapterCtx,
): Promise<{ status: number; body: unknown; text: string }> {
  const url = new URL(`${HUNTER_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("api_key", ctx.secret);

  const response = await fetch(url, { signal: ctx.signal ?? null });
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

function hunterErrorMessage(status: number, body: unknown, fallback: string): string {
  if (status === 401 || status === 403) return "Hunter rejected this API key. Check it at hunter.io → API.";
  if (status === 429) return "Hunter's rate limit or monthly quota was reached for this account.";
  const detail = (body as { errors?: { details?: string }[] })?.errors?.[0]?.details;
  return detail ? `Hunter: ${detail}` : fallback;
}

async function testHunterAccount(ctx: AdapterCtx): Promise<TestResult> {
  const startedAt = Date.now();
  try {
    const { status, body, text } = await hunterFetch("/account", {}, ctx);
    const latencyMs = Date.now() - startedAt;
    if (status >= 400) {
      return { ok: false, message: hunterErrorMessage(status, body, `Hunter returned ${status}: ${text.slice(0, 200)}`), latencyMs };
    }
    const data = (body as { data?: { plan_name?: string; email?: string } }).data ?? {};
    return {
      ok: true,
      message: data.plan_name ? `Connected. ${data.plan_name} plan.` : "Connected to Hunter.",
      detail: data as Record<string, unknown>,
      latencyMs,
    };
  } catch {
    return { ok: false, message: "Could not reach api.hunter.io. Check this server's outbound network access.", latencyMs: Date.now() - startedAt };
  }
}

interface HunterEmailEntry {
  value: string;
  first_name?: string;
  last_name?: string;
  position?: string;
  phone_number?: string;
  linkedin?: string;
}

interface HunterDomainSearchResponse {
  data?: { domain?: string; organization?: string; emails?: HunterEmailEntry[] };
}

export const hunterDomainSearchProvider: LeadSource = {
  id: "hunter_domain_search",
  category: "lead_source",

  testConnection: testHunterAccount,

  async search(sourceQuery: SourceQuery, ctx: AdapterCtx): Promise<RawLead[]> {
    const filters = (sourceQuery.filters ?? {}) as { domain?: string; seniority?: string; department?: string };
    const domain = filters.domain ?? sourceQuery.query;
    if (!domain) throw providerError("hunter_domain_search", "A company domain is required to search Hunter.");

    const params: Record<string, string> = { domain, limit: String(Math.min(sourceQuery.limit ?? 25, 100)) };
    const configSeniority = (ctx.config as Record<string, unknown>).seniority;
    const seniority = filters.seniority || (typeof configSeniority === "string" ? configSeniority : "");
    if (seniority) params.seniority = seniority;
    if (filters.department) params.department = filters.department;

    const { status, body, text } = await hunterFetch("/domain-search", params, ctx);
    if (status >= 400) {
      throw providerError("hunter_domain_search", hunterErrorMessage(status, body, `Hunter returned ${status}: ${text.slice(0, 300)}`));
    }

    const data = (body as HunterDomainSearchResponse).data;
    return (data?.emails ?? [])
      .filter((e) => e.value)
      .map((e) => ({
        firstName: e.first_name,
        lastName: e.last_name,
        fullName: [e.first_name, e.last_name].filter(Boolean).join(" ") || undefined,
        title: e.position,
        email: e.value,
        phone: e.phone_number,
        linkedinUrl: e.linkedin || undefined,
        companyDomain: data?.domain ?? domain,
        companyName: data?.organization,
        sourceUrl: `https://hunter.io/verify/${encodeURIComponent(e.value)}`,
        raw: e as unknown as Record<string, unknown>,
      }));
  },

  /** Hunter's Starter plan lists roughly $49/1,000 searches; carried here as an estimate, never a bill. */
  estimateCost(sourceQuery: SourceQuery): CostEstimate {
    return { costUsd: 0.049 * Math.min(sourceQuery.limit ?? 25, 100), unit: "search" };
  },
};

export const hunterVerifierProvider: EmailVerifier = {
  id: "hunter_verifier",
  category: "verification",

  testConnection: testHunterAccount,

  async verify(email: string, ctx: AdapterCtx): Promise<EmailVerificationResult> {
    const { status, body, text } = await hunterFetch("/email-verifier", { email }, ctx);

    // Per Hunter's docs, verification can run up to ~20s server-side; a still-
    // processing check returns 202 rather than a result to poll for.
    if (status === 202) {
      throw providerError("hunter_verifier", "Hunter is still verifying this address. Retry in a few seconds.");
    }
    if (status >= 400) {
      throw providerError("hunter_verifier", hunterErrorMessage(status, body, `Hunter returned ${status}: ${text.slice(0, 300)}`));
    }

    const data = (body as { data?: { status?: string; score?: number } }).data ?? {};
    return { email, result: mapStatus(data.status), score: data.score, raw: data as Record<string, unknown> };
  },
};

/** Hunter's five-value status onto the four-value result the rest of this codebase gates sending on. */
function mapStatus(status: string | undefined): EmailVerificationResult["result"] {
  switch (status) {
    case "valid":
      return "valid";
    case "invalid":
      return "invalid";
    case "accept_all":
      return "catch_all";
    case "disposable":
    case "webmail":
      return "risky";
    default:
      return "unknown";
  }
}
