import { providerError } from "@outreach/shared";
import type { TestResult } from "@outreach/shared";
import type {
  AdapterCtx,
  CrmContact,
  CrmContactPage,
  CrmProvider,
  CrmUpsertResult,
} from "../types";

/**
 * HubSpot CRM — contacts.
 *
 * Authenticated with a Private App access token (`Authorization: Bearer …`),
 * not the retired hapikey query parameter, which HubSpot disabled for new
 * accounts in 2022. Endpoints, request shapes and property names below are
 * written against HubSpot's public CRM v3 reference.
 *
 * TODO(verify): written from published documentation, not confirmed against a
 * live portal — no HubSpot account was available while building this. Run
 * `npm run providers:verify` once a token is saved on the Connections page;
 * that exercises `testConnection` against the real API and is the thing that
 * moves this adapter from "written" to "verified".
 *
 * Upsert is deliberately search-then-write rather than a bare create. HubSpot
 * answers a create whose email already exists with a 409 whose *message string*
 * carries the existing record id; parsing a human-readable error to recover an
 * identifier is the kind of thing that breaks silently when the vendor rewords
 * it. Two requests that each mean what they say are worth more than one that
 * depends on prose.
 */

const HUBSPOT_BASE = "https://api.hubapi.com";

/** Requested explicitly: HubSpot returns only id and a few defaults otherwise. */
const CONTACT_PROPERTIES = [
  "email",
  "firstname",
  "lastname",
  "phone",
  "jobtitle",
  "company",
  "hs_linkedin_url",
  "lifecyclestage",
] as const;

interface HubSpotContact {
  id: string;
  properties?: Record<string, string | null>;
}

async function hubspotFetch(
  path: string,
  init: { method?: string; body?: unknown; query?: Record<string, string> },
  ctx: AdapterCtx,
): Promise<{ status: number; body: unknown }> {
  const url = new URL(`${HUBSPOT_BASE}${path}`);
  for (const [k, v] of Object.entries(init.query ?? {})) url.searchParams.set(k, v);

  const response = await fetch(url, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${ctx.secret}`,
      ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
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
  return { status: response.status, body };
}

export function hubspotErrorMessage(status: number, body: unknown, fallback: string): string {
  if (status === 401) {
    return "HubSpot rejected this token. Check it under Settings → Integrations → Private Apps.";
  }
  if (status === 403) {
    return "This HubSpot token is valid but missing a required scope. It needs crm.objects.contacts.read and crm.objects.contacts.write.";
  }
  if (status === 429) {
    return "HubSpot's rate limit was reached for this portal. It will recover on its own.";
  }
  const message = (body as { message?: string })?.message;
  return message ? `HubSpot: ${message}` : fallback;
}

/** Map HubSpot's property names onto ours. Exported for tests. */
export function toCrmContact(record: HubSpotContact): CrmContact {
  const p = record.properties ?? {};
  const value = (key: string): string | undefined => {
    const v = p[key];
    return typeof v === "string" && v.trim() ? v.trim() : undefined;
  };
  return {
    email: value("email") ?? "",
    firstName: value("firstname"),
    lastName: value("lastname"),
    phone: value("phone"),
    title: value("jobtitle"),
    companyName: value("company"),
    linkedinUrl: value("hs_linkedin_url"),
    lifecycleStage: value("lifecyclestage"),
    externalId: record.id,
    raw: record as unknown as Record<string, unknown>,
  };
}

/** Map ours onto HubSpot's, dropping anything absent. Exported for tests. */
export function toHubSpotProperties(contact: CrmContact): Record<string, string> {
  const out: Record<string, string> = {};
  const set = (key: string, v: string | undefined): void => {
    if (v && v.trim()) out[key] = v.trim();
  };
  set("email", contact.email);
  set("firstname", contact.firstName);
  set("lastname", contact.lastName);
  set("phone", contact.phone);
  set("jobtitle", contact.title);
  set("company", contact.companyName);
  set("hs_linkedin_url", contact.linkedinUrl);
  return out;
}

async function findContactIdByEmail(email: string, ctx: AdapterCtx): Promise<string | null> {
  const { status, body } = await hubspotFetch(
    "/crm/v3/objects/contacts/search",
    {
      method: "POST",
      body: {
        filterGroups: [{ filters: [{ propertyName: "email", operator: "EQ", value: email }] }],
        properties: ["email"],
        limit: 1,
      },
    },
    ctx,
  );

  if (status !== 200) {
    throw providerError("hubspot", hubspotErrorMessage(status, body, `HubSpot contact search failed (${status}).`));
  }
  const results = (body as { results?: HubSpotContact[] }).results ?? [];
  return results[0]?.id ?? null;
}

export const hubspotProvider: CrmProvider = {
  id: "hubspot",
  category: "crm",

  async testConnection(ctx: AdapterCtx): Promise<TestResult> {
    const startedAt = Date.now();
    try {
      // One contact, one property. Proves the token authenticates AND carries
      // the contacts read scope — a token that merely exists is not a
      // connection.
      const { status, body } = await hubspotFetch(
        "/crm/v3/objects/contacts",
        { query: { limit: "1", properties: "email" } },
        ctx,
      );
      if (status !== 200) {
        return {
          ok: false,
          message: hubspotErrorMessage(status, body, `HubSpot returned ${status}.`),
          latencyMs: Date.now() - startedAt,
        };
      }
      const total = (body as { total?: number }).total;
      return {
        ok: true,
        message:
          typeof total === "number"
            ? `Connected. ${total.toLocaleString()} contact(s) in this portal.`
            : "Connected to HubSpot.",
        latencyMs: Date.now() - startedAt,
      };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : "The connection test failed.",
        latencyMs: Date.now() - startedAt,
      };
    }
  },

  async upsertContact(contact: CrmContact, ctx: AdapterCtx): Promise<CrmUpsertResult> {
    const email = contact.email?.trim();
    if (!email) {
      throw providerError("hubspot", "A contact needs an email address before it can be sent to HubSpot.");
    }

    const properties = toHubSpotProperties({ ...contact, email });
    const existingId = await findContactIdByEmail(email, ctx);

    if (existingId) {
      const { status, body } = await hubspotFetch(
        `/crm/v3/objects/contacts/${encodeURIComponent(existingId)}`,
        { method: "PATCH", body: { properties } },
        ctx,
      );
      if (status !== 200) {
        throw providerError("hubspot", hubspotErrorMessage(status, body, `Updating the HubSpot contact failed (${status}).`));
      }
      return { externalId: existingId, created: false };
    }

    const { status, body } = await hubspotFetch(
      "/crm/v3/objects/contacts",
      { method: "POST", body: { properties } },
      ctx,
    );
    // HubSpot documents 201 for a create; accept 200 too rather than reject a
    // successful write over a status code.
    if (status !== 201 && status !== 200) {
      throw providerError("hubspot", hubspotErrorMessage(status, body, `Creating the HubSpot contact failed (${status}).`));
    }
    const id = (body as HubSpotContact).id;
    if (!id) {
      throw providerError("hubspot", "HubSpot accepted the contact but returned no record id.");
    }
    return { externalId: id, created: true };
  },

  async listContacts(cursor: string | undefined, ctx: AdapterCtx): Promise<CrmContactPage> {
    const { status, body } = await hubspotFetch(
      "/crm/v3/objects/contacts",
      {
        query: {
          limit: "100",
          properties: CONTACT_PROPERTIES.join(","),
          ...(cursor ? { after: cursor } : {}),
        },
      },
      ctx,
    );
    if (status !== 200) {
      throw providerError("hubspot", hubspotErrorMessage(status, body, `Listing HubSpot contacts failed (${status}).`));
    }

    const parsed = body as { results?: HubSpotContact[]; paging?: { next?: { after?: string } } };
    return {
      // A CRM contact with no email cannot be matched against a prospect or a
      // suppression entry, so it is dropped rather than carried as a blank key.
      contacts: (parsed.results ?? []).map(toCrmContact).filter((c) => c.email !== ""),
      nextCursor: parsed.paging?.next?.after,
    };
  },
};
