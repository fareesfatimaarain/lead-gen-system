import { describe, expect, it } from "vitest";
import { normalizeDomain } from "./domain";

describe("normalizeDomain", () => {
  it("strips scheme, www, path and trailing slash to the same apex", () => {
    const variants = [
      "acme.com",
      "https://acme.com",
      "http://acme.com/",
      "https://www.acme.com",
      "www.acme.com/pricing",
      "ACME.COM",
      "  acme.com  ",
    ];
    for (const v of variants) expect(normalizeDomain(v)).toBe("acme.com");
  });

  it("strips a port", () => {
    expect(normalizeDomain("acme.com:8080")).toBe("acme.com");
  });

  it("returns null for empty or missing input", () => {
    expect(normalizeDomain(null)).toBeNull();
    expect(normalizeDomain(undefined)).toBeNull();
    expect(normalizeDomain("")).toBeNull();
    expect(normalizeDomain("   ")).toBeNull();
  });

  it("does not collapse two different domains", () => {
    expect(normalizeDomain("acme.com")).not.toBe(normalizeDomain("acme.co"));
  });
});
