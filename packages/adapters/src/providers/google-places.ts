import { providerError } from "@outreach/shared";
import type { TestResult } from "@outreach/shared";
import type { AdapterCtx, CostEstimate, LeadSource, RawLead, SourceQuery } from "../types";

/**
 * Google Places (New) — Text Search.
 *
 * The broadest business directory in the registry: works anywhere Google Maps
 * has coverage, which includes both USA and UAE with no per-country adapter
 * needed. Real businesses, real phone numbers, real websites — the same
 * "company, not yet a named contact" shape as Overpass, priced per request
 * instead of free.
 *
 * Endpoint, auth, field mask requirement and field names confirmed against
 * developers.google.com/maps/documentation/places/web-service/text-search.
 */

const PLACES_BASE = "https://places.googleapis.com/v1/places:searchText";

// Only what this adapter reads. Google bills a wider "Enterprise" tier the
// moment phone/website fields are requested — asked for anyway, because a
// business record with neither is not something this product can act on.
const FIELD_MASK = [
  "places.displayName",
  "places.formattedAddress",
  "places.internationalPhoneNumber",
  "places.websiteUri",
  "places.location",
  "places.types",
  "places.businessStatus",
  "places.id",
].join(",");

interface GooglePlace {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  internationalPhoneNumber?: string;
  websiteUri?: string;
  location?: { latitude?: number; longitude?: number };
  types?: string[];
  businessStatus?: string;
}

interface TextSearchResponse {
  places?: GooglePlace[];
}

async function textSearch(
  body: Record<string, unknown>,
  ctx: AdapterCtx,
  fieldMask: string,
): Promise<{ status: number; body: unknown; text: string }> {
  const response = await fetch(PLACES_BASE, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": ctx.secret,
      "X-Goog-FieldMask": fieldMask,
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

export const googlePlacesProvider: LeadSource = {
  id: "google_places",
  category: "lead_source",

  /** A minimal, cheap search — one result, no contact fields in the mask — just to prove the key authenticates. */
  async testConnection(ctx: AdapterCtx): Promise<TestResult> {
    const startedAt = Date.now();
    try {
      const { status, body, text } = await textSearch(
        { textQuery: "coffee", pageSize: 1 },
        ctx,
        "places.id,places.displayName",
      );
      const latencyMs = Date.now() - startedAt;

      if (status === 401 || status === 403) {
        return {
          ok: false,
          message: "Google rejected this API key. Check it in Google Cloud Console and confirm the Places API (New) is enabled for it.",
          latencyMs,
        };
      }
      if (status >= 400) {
        return { ok: false, message: `Google Places returned ${status}: ${text.slice(0, 200)}`, latencyMs };
      }

      const places = (body as TextSearchResponse).places ?? [];
      return {
        ok: true,
        message: places.length > 0 ? "Connected." : "Connected, but the test query returned no results.",
        latencyMs,
      };
    } catch {
      return { ok: false, message: "Could not reach places.googleapis.com. Check this server's outbound network access.", latencyMs: Date.now() - startedAt };
    }
  },

  async search(sourceQuery: SourceQuery, ctx: AdapterCtx): Promise<RawLead[]> {
    const filters = (sourceQuery.filters ?? {}) as {
      includedType?: string;
      locationBias?: { south: number; west: number; north: number; east: number };
    };
    const limit = Math.min(sourceQuery.limit ?? 20, 20); // Text Search returns at most 20 per page.

    const body: Record<string, unknown> = { textQuery: sourceQuery.query, pageSize: limit };
    if (filters.includedType) body.includedType = filters.includedType;
    if (filters.locationBias) {
      const b = filters.locationBias;
      body.locationBias = {
        rectangle: {
          low: { latitude: b.south, longitude: b.west },
          high: { latitude: b.north, longitude: b.east },
        },
      };
    }

    const { status, body: respBody, text } = await textSearch(body, ctx, FIELD_MASK);
    if (status >= 400) {
      throw providerError("google_places", `Google Places search failed (${status}): ${text.slice(0, 300)}`);
    }

    const places = (respBody as TextSearchResponse).places ?? [];
    return places
      .filter((p) => p.businessStatus !== "CLOSED_PERMANENTLY")
      .map((p) => ({
        companyName: p.displayName?.text,
        companyDomain: p.websiteUri ? p.websiteUri.replace(/^https?:\/\//, "").replace(/\/.*$/, "") : undefined,
        phone: p.internationalPhoneNumber,
        sourceUrl: p.id ? `https://www.google.com/maps/place/?q=place_id:${p.id}` : undefined,
        raw: { ...p, formattedAddress: p.formattedAddress },
      }));
  },

  /** $32 / 1,000 requests on the Text Search Enterprise SKU (triggered by requesting phone/website) — published list price, not a live quote. */
  estimateCost(sourceQuery: SourceQuery): CostEstimate {
    return { costUsd: 0.032, unit: `search (up to ${Math.min(sourceQuery.limit ?? 20, 20)} results)` };
  },
};
