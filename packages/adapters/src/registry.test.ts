import { describe, expect, it } from "vitest";
import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  getProvider,
  PROVIDERS,
  providersByCategory,
  publicRegistry,
  requireProvider,
} from "./registry";

/**
 * The registry is the contract between the adapter layer and the Connections
 * UI. These tests are what let "add a provider = one entry + one adapter" stay
 * true — they catch a malformed entry at test time rather than as a broken form.
 */

describe("registry integrity", () => {
  it("has unique provider ids", () => {
    const ids = PROVIDERS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every provider a category that has a label and a position", () => {
    for (const p of PROVIDERS) {
      expect(CATEGORY_LABELS[p.category], `label for ${p.category}`).toBeTruthy();
      expect(CATEGORY_ORDER, `order for ${p.category}`).toContain(p.category);
    }
  });

  it("gives every provider a docs link and a summary", () => {
    for (const p of PROVIDERS) {
      expect(p.docsUrl, p.id).toMatch(/^https:\/\//);
      expect(p.summary.length, p.id).toBeGreaterThan(10);
    }
  });

  it("wires every provider to an adapter whose id and category match its entry", () => {
    for (const p of PROVIDERS) {
      expect(p.adapter.id, `${p.id} adapter id`).toBe(p.id);
      expect(p.adapter.category, `${p.id} adapter category`).toBe(p.category);
      expect(typeof p.adapter.testConnection, `${p.id} testConnection`).toBe("function");
    }
  });

  it("gives every credentialed provider exactly one secret field", () => {
    for (const p of PROVIDERS) {
      if (p.requiresCredential === false) {
        expect(p.secretField, p.id).toBeUndefined();
        continue;
      }
      expect(p.secretField?.label, p.id).toBeTruthy();
      // The secret is never a config field — config is stored in plaintext.
      expect(p.configFields.map((f) => f.name)).not.toContain("secret");
      expect(p.configFields.map((f) => f.name)).not.toContain("apiKey");
    }
  });

  it("gives every select field its options", () => {
    for (const p of PROVIDERS) {
      for (const f of p.configFields) {
        if (f.type === "select") {
          expect(f.options?.length, `${p.id}.${f.name}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it("validates a well-formed config for each provider", () => {
    const valid: Record<string, Record<string, unknown>> = {
      anthropic: { defaultModel: "claude-opus-5" },
      vapi: {
        phoneNumberId: "pn_1",
        assistantId: "as_1",
        webhookSecret: "a-secret-at-least-16-chars",
      },
      smtp: { host: "smtp.example.com", port: 587, user: "u@example.com", fromEmail: "u@example.com" },
      resend: { fromEmail: "u@example.com" },
      overpass: { endpoint: "https://overpass-api.de/api/interpreter" },
      hunter_domain_search: { seniority: "senior" },
      hunter_verifier: {},
      apollo: {},
      google_places: {},
      yelp: {},
      sec_edgar: {},
      rentcast: {},
      dubai_pulse: { clientId: "id_123" },
      bayut: { mode: "rapidapi" },
      propertyfinder: { mode: "rapidapi", rapidApiHost: "example.p.rapidapi.com" },
    };

    for (const p of PROVIDERS) {
      const result = p.configSchema.safeParse(valid[p.id]);
      expect(result.success, `${p.id}: ${result.success ? "" : JSON.stringify(result.error.issues)}`).toBe(true);
    }
  });

  it("rejects a config missing a required field", () => {
    expect(requireProvider("smtp").configSchema.safeParse({ port: 587 }).success).toBe(false);
    expect(requireProvider("vapi").configSchema.safeParse({ phoneNumberId: "pn_1" }).success).toBe(false);
  });

  it("rejects a too-short Vapi webhook secret", () => {
    // A weak shared secret is the difference between authenticated call results
    // and anyone who guesses the tunnel URL forging them.
    const result = requireProvider("vapi").configSchema.safeParse({
      phoneNumberId: "pn_1",
      assistantId: "as_1",
      webhookSecret: "short",
    });
    expect(result.success).toBe(false);
  });

  it("marks unproven adapters as unverified", () => {
    // Resend was written from public docs and has not been run against a live
    // account from this repo. That distinction has to reach the UI.
    expect(requireProvider("resend").verified).toBe(false);
    expect(requireProvider("smtp").verified).toBe(true);
  });
});

describe("lookup", () => {
  it("finds a known provider", () => {
    expect(getProvider("vapi")?.name).toBe("Vapi");
  });

  it("returns undefined for an unknown provider", () => {
    expect(getProvider("nope")).toBeUndefined();
  });

  it("throws with the id when required", () => {
    expect(() => requireProvider("nope")).toThrow(/nope/);
  });
});

describe("providersByCategory", () => {
  it("groups in the declared order and drops empty groups", () => {
    const groups = providersByCategory();
    const categories = groups.map((g) => g.category);
    expect(categories[0]).toBe("llm");
    for (const g of groups) expect(g.providers.length).toBeGreaterThan(0);
  });

  it("includes every provider exactly once", () => {
    const flattened = providersByCategory().flatMap((g) => g.providers.map((p) => p.id));
    expect(flattened.sort()).toEqual(PROVIDERS.map((p) => p.id).sort());
  });
});

describe("publicRegistry", () => {
  it("strips the adapter and the schema", () => {
    for (const entry of publicRegistry()) {
      expect(entry).not.toHaveProperty("adapter");
      expect(entry).not.toHaveProperty("configSchema");
    }
  });

  it("survives JSON serialization, since it crosses the wire", () => {
    const serialized = JSON.parse(JSON.stringify(publicRegistry()));
    expect(serialized).toHaveLength(PROVIDERS.length);
    expect(serialized[0].id).toBe(PROVIDERS[0]!.id);
  });

  it("carries no secret values", () => {
    const blob = JSON.stringify(publicRegistry());
    expect(blob).not.toMatch(/sk-ant-api03-[A-Za-z0-9]/);
    expect(blob).not.toMatch(/"secret"\s*:/);
  });
});
