import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

/**
 * Credential vault primitives and password hashing.
 *
 * AES-256-GCM for credentials, scrypt for passwords. Both use Node's built-in
 * crypto — no native modules, nothing to compile, nothing to keep patched.
 */

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12; // 96-bit nonce, the GCM standard
const KEY_BYTES = 32;

export const CURRENT_KEY_VERSION = 1;

export interface SealedValue {
  ciphertext: Buffer;
  iv: Buffer;
  tag: Buffer;
  keyVersion: number;
}

function masterKey(): Buffer {
  const raw = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "CREDENTIAL_ENCRYPTION_KEY is not set. Generate one with:\n" +
        '  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `CREDENTIAL_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes, got ${key.length}. ` +
        "It should be base64 of 32 random bytes.",
    );
  }
  return key;
}

/** Fails fast at boot rather than at the first credential write. */
export function assertEncryptionKeyPresent(): void {
  masterKey();
}

export function seal(plaintext: string): SealedValue {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, masterKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return { ciphertext, iv, tag: cipher.getAuthTag(), keyVersion: CURRENT_KEY_VERSION };
}

/**
 * Decrypt. Throws if the auth tag does not verify — which means the row was
 * tampered with, truncated, or sealed under a different master key. There is no
 * "best effort" mode: a credential we cannot prove is intact is not used.
 */
export function open(sealed: SealedValue): string {
  if (sealed.keyVersion !== CURRENT_KEY_VERSION) {
    throw new Error(
      `Credential was sealed with key version ${sealed.keyVersion}, but the server has ` +
        `version ${CURRENT_KEY_VERSION}. Re-enter the credential on the Connections page.`,
    );
  }
  const decipher = createDecipheriv(ALGORITHM, masterKey(), sealed.iv);
  decipher.setAuthTag(sealed.tag);
  return Buffer.concat([decipher.update(sealed.ciphertext), decipher.final()]).toString("utf8");
}

/**
 * The only representation of a secret that may leave the server.
 * `sk-ant-api03-abcdef...4f2a` -> `sk-ant…4f2a`
 */
export function maskSecret(secret: string): string {
  const s = secret.trim();
  if (s.length <= 8) return "••••";
  const head = s.slice(0, Math.min(6, Math.floor(s.length / 4)));
  return `${head}…${s.slice(-4)}`;
}

// ---------------------------------------------------------------------------
// Passwords
// ---------------------------------------------------------------------------

const SCRYPT_N = 16384;
const SCRYPT_r = 8;
const SCRYPT_p = 1;
const SCRYPT_KEYLEN = 64;
// scrypt needs roughly 128 * N * r bytes; the default 32MB cap rejects N=16384.
const SCRYPT_MAXMEM = 64 * 1024 * 1024;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_r,
    p: SCRYPT_p,
    maxmem: SCRYPT_MAXMEM,
  });
  return [
    "scrypt",
    SCRYPT_N,
    SCRYPT_r,
    SCRYPT_p,
    salt.toString("base64"),
    hash.toString("base64"),
  ].join("$");
}

export function verifyPassword(password: string, stored: string | null): boolean {
  if (!stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const [, nStr, rStr, pStr, saltB64, hashB64] = parts as [string, string, string, string, string, string];
  const salt = Buffer.from(saltB64, "base64");
  const expected = Buffer.from(hashB64, "base64");

  let actual: Buffer;
  try {
    actual = scryptSync(password, salt, expected.length, {
      N: Number(nStr),
      r: Number(rStr),
      p: Number(pStr),
      maxmem: SCRYPT_MAXMEM,
    });
  } catch {
    return false;
  }

  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// ---------------------------------------------------------------------------
// Session tokens
// ---------------------------------------------------------------------------

/**
 * A session token and the hash to store.
 *
 * Only the hash goes in the database, so a database leak yields no usable
 * sessions. The plaintext exists only in the cookie.
 */
export function newSessionToken(): { token: string; tokenHash: string } {
  const token = `${randomUUID()}.${randomBytes(32).toString("base64url")}`;
  return { token, tokenHash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
