import { afterEach, describe, expect, it, vi } from "vitest";
import { hubspotErrorMessage, hubspotProvider, toCrmContact, toHubSpotProperties } from "./hubspot";
import type { AdapterCtx, CrmContact } from "../types";

/**
 * The adapter is written against HubSpot's published reference without a live
 * portal, so these tests pin the two things that are ours rather than theirs:
 * the property-name mapping in both directions, and the request sequence upsert
 * performs. A live call proves the endpoint exists; only these prove we send
 * and read the right fields.
 */

const ctx: AdapterCtx = { orgId: "org-1", secret: "pat-na1-test", config: {} };

function mockFetch(responses: { status: number; body: unknown }[]): ReturnType<typeof vi.fn> {
  const fn = vi.fn();
  for (const r of responses) {
    fn.mockResolvedValueOnce({ status: r.status, text: async () => JSON.stringify(r.body) });
  }
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("toHubSpotProperties", () => {
  it("maps our field names onto HubSpot's", () => {
    expect(
      toHubSpotProperties({
        email: "jane@acme.com",
        firstName: "Jane",
        lastName: "Doe",
        phone: "+971500000000",
        title: "Head of Ops",
        companyName: "Acme",
        linkedinUrl: "https://linkedin.com/in/jane",
        raw: {},
      }),
    ).toEqual({
      email: "jane@acme.com",
      firstname: "Jane",
      lastname: "Doe",
      phone: "+971500000000",
      jobtitle: "Head of Ops",
      company: "Acme",
      hs_linkedin_url: "https://linkedin.com/in/jane",
    });
  });

  it("omits absent and blank fields rather than sending empty strings", () => {
    // Sending "" would overwrite a real value already in the CRM with nothing.
    expect(toHubSpotProperties({ email: "a@b.com", firstName: "  ", lastName: undefined, raw: {} })).toEqual({
      email: "a@b.com",
    });
  });
});

describe("toCrmContact", () => {
  it("maps HubSpot's property names back onto ours and keeps the record id", () => {
    const c = toCrmContact({
      id: "701",
      properties: {
        email: "jane@acme.com",
        firstname: "Jane",
        lastname: "Doe",
        jobtitle: "Head of Ops",
        company: "Acme",
        lifecyclestage: "customer",
        phone: null,
      },
    });
    expect(c.email).toBe("jane@acme.com");
    expect(c.firstName).toBe("Jane");
    expect(c.title).toBe("Head of Ops");
    expect(c.companyName).toBe("Acme");
    expect(c.lifecycleStage).toBe("customer");
    expect(c.phone).toBeUndefined();
    expect(c.externalId).toBe("701");
  });

  it("survives a record with no properties at all", () => {
    expect(toCrmContact({ id: "1" }).email).toBe("");
  });
});

describe("hubspotErrorMessage", () => {
  it("separates a bad token from a missing scope", () => {
    expect(hubspotErrorMessage(401, {}, "x")).toMatch(/rejected this token/);
    expect(hubspotErrorMessage(403, {}, "x")).toMatch(/missing a required scope/);
  });

  it("names the rate limit as recoverable", () => {
    expect(hubspotErrorMessage(429, {}, "x")).toMatch(/rate limit/);
  });

  it("surfaces HubSpot's own message when it sends one", () => {
    expect(hubspotErrorMessage(400, { message: "Property X does not exist" }, "fallback")).toBe(
      "HubSpot: Property X does not exist",
    );
  });
});

describe("upsertContact", () => {
  const contact: CrmContact = { email: "jane@acme.com", firstName: "Jane", raw: {} };

  it("creates when the search finds nothing", async () => {
    const fetchMock = mockFetch([
      { status: 200, body: { results: [] } },
      { status: 201, body: { id: "9001" } },
    ]);

    expect(await hubspotProvider.upsertContact(contact, ctx)).toEqual({ externalId: "9001", created: true });

    const [, createInit] = fetchMock.mock.calls[1] as [URL, RequestInit];
    expect(createInit.method).toBe("POST");
    expect(JSON.parse(String(createInit.body))).toEqual({
      properties: { email: "jane@acme.com", firstname: "Jane" },
    });
  });

  it("updates the existing record when the search finds one", async () => {
    const fetchMock = mockFetch([
      { status: 200, body: { results: [{ id: "700" }] } },
      { status: 200, body: { id: "700" } },
    ]);

    expect(await hubspotProvider.upsertContact(contact, ctx)).toEqual({ externalId: "700", created: false });

    const [patchUrl, patchInit] = fetchMock.mock.calls[1] as [URL, RequestInit];
    expect(patchInit.method).toBe("PATCH");
    expect(String(patchUrl)).toContain("/crm/v3/objects/contacts/700");
  });

  it("refuses a contact with no email instead of creating an unmatchable record", async () => {
    const fetchMock = mockFetch([]);
    await expect(hubspotProvider.upsertContact({ email: "  ", raw: {} }, ctx)).rejects.toThrow(/needs an email/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports a missing scope rather than a bare status code", async () => {
    mockFetch([{ status: 403, body: {} }]);
    await expect(hubspotProvider.upsertContact(contact, ctx)).rejects.toThrow(/missing a required scope/);
  });

  it("fails loudly if a create is accepted but returns no id", async () => {
    mockFetch([
      { status: 200, body: { results: [] } },
      { status: 201, body: {} },
    ]);
    await expect(hubspotProvider.upsertContact(contact, ctx)).rejects.toThrow(/returned no record id/);
  });
});

describe("listContacts", () => {
  it("maps a page, drops emailless records, and returns the cursor", async () => {
    mockFetch([
      {
        status: 200,
        body: {
          results: [
            { id: "1", properties: { email: "a@b.com", lifecyclestage: "customer" } },
            { id: "2", properties: { firstname: "No Email" } },
          ],
          paging: { next: { after: "cursor-2" } },
        },
      },
    ]);

    const page = await hubspotProvider.listContacts(undefined, ctx);
    expect(page.contacts).toHaveLength(1);
    expect(page.contacts[0]?.email).toBe("a@b.com");
    expect(page.contacts[0]?.lifecycleStage).toBe("customer");
    expect(page.nextCursor).toBe("cursor-2");
  });

  it("passes the cursor back as `after` and omits it on the first page", async () => {
    const fetchMock = mockFetch([
      { status: 200, body: { results: [] } },
      { status: 200, body: { results: [] } },
    ]);

    await hubspotProvider.listContacts(undefined, ctx);
    expect(String((fetchMock.mock.calls[0] as [URL])[0])).not.toContain("after=");

    await hubspotProvider.listContacts("cursor-2", ctx);
    expect(String((fetchMock.mock.calls[1] as [URL])[0])).toContain("after=cursor-2");
  });

  it("has no next cursor on the last page", async () => {
    mockFetch([{ status: 200, body: { results: [] } }]);
    expect((await hubspotProvider.listContacts(undefined, ctx)).nextCursor).toBeUndefined();
  });
});

describe("testConnection", () => {
  it("reports the portal contact count on success", async () => {
    mockFetch([{ status: 200, body: { results: [], total: 1234 } }]);
    const result = await hubspotProvider.testConnection(ctx);
    expect(result.ok).toBe(true);
    expect(result.message).toContain("1,234");
  });

  it("returns a failure rather than throwing when the token is rejected", async () => {
    mockFetch([{ status: 401, body: {} }]);
    const result = await hubspotProvider.testConnection(ctx);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/rejected this token/);
  });

  it("returns a failure rather than throwing when the network is down", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const result = await hubspotProvider.testConnection(ctx);
    expect(result.ok).toBe(false);
    expect(result.message).toBe("ECONNREFUSED");
  });
});
