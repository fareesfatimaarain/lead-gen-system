import { describe, expect, it } from "vitest";
import { isValidE164, maskPhone, normalizePhone } from "./phone";

describe("normalizePhone", () => {
  it("keeps an already-international number", () => {
    expect(normalizePhone("+923001234567", "92")).toBe("+923001234567");
    expect(normalizePhone("+1 (415) 555-0132", "92")).toBe("+14155550132");
  });

  it("converts a 00 prefix to +", () => {
    expect(normalizePhone("00923001234567", "92")).toBe("+923001234567");
  });

  it("expands a national number with a leading zero", () => {
    expect(normalizePhone("03001234567", "92")).toBe("+923001234567");
  });

  it("prefixes bare digits with the default country", () => {
    expect(normalizePhone("3001234567", "92")).toBe("+923001234567");
  });

  it("does not double-prefix a number that already starts with the country code", () => {
    expect(normalizePhone("923001234567", "92")).toBe("+923001234567");
  });

  it("strips punctuation and whitespace", () => {
    expect(normalizePhone("  0300-123 4567 ", "92")).toBe("+923001234567");
  });

  it("returns null for empty or unusable input", () => {
    expect(normalizePhone(null, "92")).toBeNull();
    expect(normalizePhone(undefined, "92")).toBeNull();
    expect(normalizePhone("", "92")).toBeNull();
    expect(normalizePhone("   ", "92")).toBeNull();
    expect(normalizePhone("n/a", "92")).toBeNull();
  });

  it("returns null when a national number has no country to expand against", () => {
    // Silently guessing a country here would dial a real stranger.
    expect(normalizePhone("3001234567", "")).toBeNull();
    expect(normalizePhone("03001234567", "")).toBeNull();
  });

  it("still handles international input with no default country", () => {
    expect(normalizePhone("+14155550132", "")).toBe("+14155550132");
    expect(normalizePhone("0014155550132", "")).toBe("+14155550132");
  });
});

describe("isValidE164", () => {
  it("accepts well-formed numbers", () => {
    expect(isValidE164("+923001234567")).toBe(true);
    expect(isValidE164("+14155550132")).toBe(true);
  });

  it("rejects malformed numbers", () => {
    expect(isValidE164("923001234567")).toBe(false); // no +
    expect(isValidE164("+0923001234")).toBe(false); // leading zero after +
    expect(isValidE164("+123")).toBe(false); // too short
    expect(isValidE164("+1234567890123456")).toBe(false); // too long
    expect(isValidE164("")).toBe(false);
    expect(isValidE164(null)).toBe(false);
  });
});

describe("maskPhone", () => {
  it("masks the middle of a valid number", () => {
    expect(maskPhone("+923001234567")).toBe("+92 300 ••• ••67");
  });

  it("passes through anything not E.164 rather than mangling it", () => {
    expect(maskPhone("not a phone")).toBe("not a phone");
  });
});
