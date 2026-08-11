import { providerError } from "@outreach/shared";
import type { TestResult } from "@outreach/shared";
import type { AdapterCtx, CostEstimate, LeadSource, RawLead, SourceQuery } from "../types";

/**
 * OpenStreetMap Overpass lead source.
 *
 * Free and keyless (`requiresCredential: false` on the registry entry). Finds
 * real, place-based businesses — anything tagged in OSM as a shop, office,
 * clinic, etc. — inside a bounding box. This is the one source in the
 * registry that can find a business with no website and no LinkedIn page: it
 * still has a front door and, often, a phone number on the map.
 *
 * Request shape, auth (none, on the public instance), and the `[out:json]`
 * response shape below are confirmed against the Overpass API wiki
 * (wiki.openstreetmap.org/wiki/Overpass_API) and its `/status` companion
 * endpoint (wiki.openstreetmap.org/wiki/Overpass_API/status).
 */

const DEFAULT_ENDPOINT = "https://overpass-api.de/api/interpreter";

interface OverpassConfig {
  endpoint: string;
}

function readConfig(ctx: AdapterCtx): OverpassConfig {
  const c = ctx.config as Record<string, unknown>;
  const endpoint = typeof c.endpoint === "string" && c.endpoint.trim() ? c.endpoint.trim() : DEFAULT_ENDPOINT;
  return { endpoint };
}

interface OverpassElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

interface OverpassResponse {
  elements?: OverpassElement[];
}

/**
 * Builds an Overpass QL query for one OSM tag (`amenity`, `shop`, `office`,
 * ...) matching one value, inside a bounding box. Mapping an ICP industry onto
 * an OSM tag/value pair is the Source Strategist's job, not this adapter's —
 * `filters.tag`/`filters.value` are expected to already be OSM vocabulary.
 */
function buildQuery(query: SourceQuery): string {
  const filters = (query.filters ?? {}) as {
    tag?: string;
    value?: string;
    bbox?: [number, number, number, number]; // south, west, north, east
  };
  const tag = filters.tag ?? "shop";
  const value = filters.value ?? query.query;
  const bbox = filters.bbox;
  const limit = Math.min(query.limit ?? 50, 200);

  if (!bbox) {
    throw providerError(
      "overpass",
      "A bounding box is required to search OpenStreetMap. Set a geography on the ICP with a specific city or region.",
    );
  }
  const [south, west, north, east] = bbox;
  return `[out:json][timeout:25];nwr(${south},${west},${north},${east})["${tag}"="${value}"];out center ${limit};`;
}

async function runQuery(ql: string, ctx: AdapterCtx): Promise<{ status: number; text: string }> {
  const { endpoint } = readConfig(ctx);
  const response = await fetch(endpoint, {
    method: "POST",
    // The wiki asks integrators to identify their app in a User-Agent header
    // so abusive clients can be traced without the whole public instance
    // being throttled for everyone.
    headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "outreach-system/1.0" },
    body: `data=${encodeURIComponent(ql)}`,
    signal: ctx.signal ?? null,
  });
  return { status: response.status, text: await response.text() };
}

function toRawLead(el: OverpassElement): RawLead | null {
  const tags = el.tags ?? {};
  const name = tags.name;
  if (!name) return null; // An untitled node is not a company anyone can be pitched to.

  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;
  const street = [tags["addr:housenumber"], tags["addr:street"]].filter(Boolean).join(" ");

  return {
    companyName: name,
    companyDomain: tags.website ? tags.website.replace(/^https?:\/\//, "").replace(/\/.*$/, "") : undefined,
    phone: tags.phone ?? tags["contact:phone"],
    city: tags["addr:city"],
    sourceUrl: `https://www.openstreetmap.org/${el.type}/${el.id}`,
    raw: { ...tags, lat, lon, address: [street, tags["addr:city"]].filter(Boolean).join(", ") || undefined },
  };
}

export const overpassProvider: LeadSource = {
  id: "overpass",
  category: "lead_source",

  /**
   * `/api/status` is Overpass's own health/quota endpoint — plain text, no
   * query execution, so it costs nothing against the daily quota. Per the
   * wiki, `Rate limit: 0` means this IP has no free concurrent slot right
   * now, not that the service is down, so that case is reported as reachable
   * with a warning rather than a failure.
   */
  async testConnection(ctx: AdapterCtx): Promise<TestResult> {
    const { endpoint } = readConfig(ctx);
    const startedAt = Date.now();
    try {
      const statusUrl = endpoint.replace(/\/interpreter\/?$/, "/status");
      // Without an explicit User-Agent, the public instance's front end
      // returns 406 rather than the status page — observed against the live
      // service while building this adapter, not documented in the wiki.
      const response = await fetch(statusUrl, {
        headers: { "User-Agent": "outreach-system/1.0" },
        signal: ctx.signal ?? null,
      });
      const text = await response.text();
      const latencyMs = Date.now() - startedAt;

      if (!response.ok) {
        return { ok: false, message: `Overpass returned ${response.status}.`, latencyMs };
      }

      const rateMatch = text.match(/Rate limit:\s*(\d+)/i);
      const rateLimit = rateMatch ? Number(rateMatch[1]) : undefined;

      if (rateLimit === 0) {
        return {
          ok: true,
          message:
            "Reachable, but this server currently has no free query slot on the public instance. Runs will queue and retry rather than fail.",
          detail: { rateLimit },
          latencyMs,
        };
      }
      return {
        ok: true,
        message: `Connected to ${new URL(endpoint).host}.${rateLimit !== undefined ? ` ${rateLimit} concurrent query slot(s) available.` : ""}`,
        detail: { rateLimit },
        latencyMs,
      };
    } catch {
      return {
        ok: false,
        message: `Could not reach ${endpoint}. Check this server's outbound network access.`,
        latencyMs: Date.now() - startedAt,
      };
    }
  },

  async search(sourceQuery: SourceQuery, ctx: AdapterCtx): Promise<RawLead[]> {
    const ql = buildQuery(sourceQuery);
    const { status, text } = await runQuery(ql, ctx);

    if (status === 429) {
      throw providerError(
        "overpass",
        "Overpass rate-limited this request. It shares a public quota — wait a moment, or point this source at a different endpoint.",
      );
    }
    if (status >= 400) {
      throw providerError("overpass", `Overpass returned ${status}: ${text.slice(0, 300)}`);
    }

    let parsed: OverpassResponse;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw providerError("overpass", "Overpass returned a response that was not valid JSON.");
    }

    return (parsed.elements ?? []).map(toRawLead).filter((lead): lead is RawLead => lead !== null);
  },

  /** The public instance is free. A licensed or self-hosted mirror is a config choice, not a per-query cost this adapter can see. */
  estimateCost(): CostEstimate {
    return { costUsd: 0, unit: "query" };
  },
};
