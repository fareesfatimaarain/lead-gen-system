import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assertEncryptionKeyPresent,
  hashPassword,
  hashToken,
  maskSecret,
  newSessionToken,
  open,
  seal,
  verifyPassword,
} from "./crypto";

const ORIGINAL_KEY = process.env.CREDENTIAL_ENCRYPTION_KEY;

beforeAll(() => {
  process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString("base64");
});

afterAll(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.CREDENTIAL_ENCRYPTION_KEY;
  else process.env.CREDENTIAL_ENCRYPTION_KEY = ORIGINAL_KEY;
});

describe("credential vault", () => {
  it("round-trips a secret", () => {
    const secret = "sk-ant-api03-abcdefghijklmnop4f2a";
    expect(open(seal(secret))).toBe(secret);
  });

  it("produces a different ciphertext each time for the same input", () => {
    // A deterministic ciphertext would leak that two orgs use the same key.
    const a = seal("same-secret");
    const b = seal("same-secret");
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
    expect(a.iv.equals(b.iv)).toBe(false);
  });

  it("rejects a tampered ciphertext", () => {
    const sealed = seal("sk-live-important");
    sealed.ciphertext.writeUInt8(sealed.ciphertext.readUInt8(0) ^ 0xff, 0);
    expect(() => open(sealed)).toThrow();
  });

  it("rejects a tampered auth tag", () => {
    const sealed = seal("sk-live-important");
    sealed.tag.writeUInt8(sealed.tag.readUInt8(0) ^ 0xff, 0);
    expect(() => open(sealed)).toThrow();
  });

  it("rejects a swapped IV", () => {
    const a = seal("secret-a");
    const b = seal("secret-b");
    expect(() => open({ ...a, iv: b.iv })).toThrow();
  });

  it("refuses a value sealed under an unknown key version", () => {
    const sealed = seal("secret");
    expect(() => open({ ...sealed, keyVersion: 99 })).toThrow(/key version 99/);
  });

  it("cannot decrypt with a different master key", () => {
    const sealed = seal("secret");
    const previous = process.env.CREDENTIAL_ENCRYPTION_KEY;
    process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    expect(() => open(sealed)).toThrow();
    process.env.CREDENTIAL_ENCRYPTION_KEY = previous;
  });

  it("rejects a malformed master key rather than silently truncating it", () => {
    const previous = process.env.CREDENTIAL_ENCRYPTION_KEY;
    process.env.CREDENTIAL_ENCRYPTION_KEY = Buffer.from("too-short").toString("base64");
    expect(() => assertEncryptionKeyPresent()).toThrow(/must decode to 32 bytes/);
    process.env.CREDENTIAL_ENCRYPTION_KEY = previous;
  });
});

describe("maskSecret", () => {
  it("keeps a recognizable head and tail", () => {
    expect(maskSecret("sk-ant-api03-abcdefghijklmnop4f2a")).toBe("sk-ant…4f2a");
  });

  it("reveals nothing about a short secret", () => {
    expect(maskSecret("abc")).toBe("••••");
    expect(maskSecret("12345678")).toBe("••••");
  });

  it("never returns the full secret", () => {
    const secret = "supersecretvalue1234";
    expect(maskSecret(secret)).not.toBe(secret);
    expect(maskSecret(secret).length).toBeLessThan(secret.length);
  });
});

describe("passwords", () => {
  it("verifies a correct password", () => {
    const hash = hashPassword("correct horse battery staple");
    expect(verifyPassword("correct horse battery staple", hash)).toBe(true);
  });

  it("rejects a wrong password", () => {
    const hash = hashPassword("correct horse battery staple");
    expect(verifyPassword("Correct horse battery staple", hash)).toBe(false);
    expect(verifyPassword("", hash)).toBe(false);
  });

  it("salts, so identical passwords hash differently", () => {
    expect(hashPassword("same")).not.toBe(hashPassword("same"));
  });

  it("rejects a null or malformed stored hash instead of throwing", () => {
    expect(verifyPassword("anything", null)).toBe(false);
    expect(verifyPassword("anything", "")).toBe(false);
    expect(verifyPassword("anything", "not-a-hash")).toBe(false);
    expect(verifyPassword("anything", "bcrypt$1$2$3$4$5")).toBe(false);
  });
});

describe("session tokens", () => {
  it("returns a token whose hash matches", () => {
    const { token, tokenHash } = newSessionToken();
    expect(hashToken(token)).toBe(tokenHash);
  });

  it("does not store the token itself", () => {
    const { token, tokenHash } = newSessionToken();
    expect(tokenHash).not.toContain(token);
    expect(tokenHash).toHaveLength(64); // sha256 hex
  });

  it("produces unique tokens", () => {
    const tokens = new Set(Array.from({ length: 100 }, () => newSessionToken().token));
    expect(tokens.size).toBe(100);
  });
});
