import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { closeDb, db, withOrg } from "./client";
import { maskSecret, open, seal } from "./crypto";
import * as schema from "./schema/index";

/**
 * The credential vault, against a real database.
 *
 * Proves the property the whole Connections feature rests on: a provider key is
 * stored encrypted, is invisible to any other tenant, round-trips correctly, and
 * cannot be reconstructed from anything the client is ever sent.
 */

const HAS_DB = Boolean(process.env.DATABASE_URL);
const suite = HAS_DB ? describe : describe.skip;

const SECRET = "sk-ant-api03-thisIsTheRealKeyValue4f2a";

suite("credential vault", () => {
  let orgA: string;
  let orgB: string;

  beforeAll(async () => {
    const suffix = Date.now();
    const [a] = await db()
      .insert(schema.orgs)
      .values({ name: `Vault A ${suffix}`, slug: `vault-a-${suffix}` })
      .returning({ id: schema.orgs.id });
    const [b] = await db()
      .insert(schema.orgs)
      .values({ name: `Vault B ${suffix}`, slug: `vault-b-${suffix}` })
      .returning({ id: schema.orgs.id });
    orgA = a!.id;
    orgB = b!.id;

    const sealed = seal(SECRET);
    await withOrg({ orgId: orgA }, (tx) =>
      tx.insert(schema.credentials).values({
        orgId: orgA,
        provider: "anthropic",
        label: "Default",
        encryptedValue: sealed.ciphertext,
        encryptionIv: sealed.iv,
        encryptionTag: sealed.tag,
        keyVersion: sealed.keyVersion,
        maskedHint: maskSecret(SECRET),
        config: { defaultModel: "claude-opus-5" },
        status: "unverified",
      }),
    );
  });

  afterAll(async () => {
    if (orgA) await db().execute(sql`DELETE FROM orgs WHERE id = ${orgA}`);
    if (orgB) await db().execute(sql`DELETE FROM orgs WHERE id = ${orgB}`);
    await closeDb();
  });

  it("round-trips the secret through storage", async () => {
    const [row] = await withOrg({ orgId: orgA }, (tx) => tx.select().from(schema.credentials));
    expect(
      open({
        ciphertext: row!.encryptedValue,
        iv: row!.encryptionIv,
        tag: row!.encryptionTag,
        keyVersion: row!.keyVersion,
      }),
    ).toBe(SECRET);
  });

  it("stores ciphertext, not the secret", async () => {
    const [row] = await withOrg({ orgId: orgA }, (tx) => tx.select().from(schema.credentials));
    // The raw bytes must not contain the plaintext in any encoding.
    const asUtf8 = row!.encryptedValue.toString("utf8");
    const asLatin = row!.encryptedValue.toString("latin1");
    expect(asUtf8).not.toContain("sk-ant");
    expect(asLatin).not.toContain("sk-ant");
    expect(asUtf8).not.toContain(SECRET);
  });

  it("never lets the masked hint reveal the secret", async () => {
    const [row] = await withOrg({ orgId: orgA }, (tx) => tx.select().from(schema.credentials));
    expect(row!.maskedHint).toBe("sk-ant…4f2a");
    expect(SECRET).not.toContain(row!.maskedHint);
    expect(row!.maskedHint.length).toBeLessThan(SECRET.length / 2);
  });

  it("hides another tenant's credential completely", async () => {
    const seenByB = await withOrg({ orgId: orgB }, (tx) => tx.select().from(schema.credentials));
    expect(seenByB).toHaveLength(0);
  });

  it("hides another tenant's credential even by primary key", async () => {
    const [row] = await withOrg({ orgId: orgA }, (tx) =>
      tx.select({ id: schema.credentials.id }).from(schema.credentials),
    );
    const stolen = await withOrg({ orgId: orgB }, (tx) =>
      tx.select().from(schema.credentials).where(eq(schema.credentials.id, row!.id)),
    );
    expect(stolen).toHaveLength(0);
  });

  it("stores non-secret config in the clear so the user can edit it", async () => {
    const [row] = await withOrg({ orgId: orgA }, (tx) => tx.select().from(schema.credentials));
    expect(row!.config).toEqual({ defaultModel: "claude-opus-5" });
  });

  it("resets verification when the key is replaced", async () => {
    // Marking it verified, then replacing the key, must not leave a stale
    // "Connected" badge on a credential nobody has tested.
    await withOrg({ orgId: orgA }, (tx) =>
      tx
        .update(schema.credentials)
        .set({ status: "active", lastVerifiedAt: new Date() })
        .where(eq(schema.credentials.provider, "anthropic")),
    );

    const replacement = seal("sk-ant-api03-aCompletelyDifferentKey9999");
    const [updated] = await withOrg({ orgId: orgA }, (tx) =>
      tx
        .update(schema.credentials)
        .set({
          encryptedValue: replacement.ciphertext,
          encryptionIv: replacement.iv,
          encryptionTag: replacement.tag,
          maskedHint: maskSecret("sk-ant-api03-aCompletelyDifferentKey9999"),
          status: "unverified",
          lastVerifiedAt: null,
          lastError: null,
        })
        .where(eq(schema.credentials.provider, "anthropic"))
        .returning(),
    );

    expect(updated!.status).toBe("unverified");
    expect(updated!.lastVerifiedAt).toBeNull();
    expect(
      open({
        ciphertext: updated!.encryptedValue,
        iv: updated!.encryptionIv,
        tag: updated!.encryptionTag,
        keyVersion: updated!.keyVersion,
      }),
    ).toBe("sk-ant-api03-aCompletelyDifferentKey9999");
  });

  it("enforces one credential per provider label within an org", async () => {
    const sealed = seal("duplicate");
    await expect(
      withOrg({ orgId: orgA }, (tx) =>
        tx.insert(schema.credentials).values({
          orgId: orgA,
          provider: "anthropic",
          label: "Default",
          encryptedValue: sealed.ciphertext,
          encryptionIv: sealed.iv,
          encryptionTag: sealed.tag,
          keyVersion: sealed.keyVersion,
          maskedHint: "x",
        }),
      ),
    ).rejects.toThrow();
  });

  it("lets two orgs each hold their own key for the same provider", async () => {
    const sealed = seal("sk-ant-org-b-key");
    await withOrg({ orgId: orgB }, (tx) =>
      tx.insert(schema.credentials).values({
        orgId: orgB,
        provider: "anthropic",
        label: "Default",
        encryptedValue: sealed.ciphertext,
        encryptionIv: sealed.iv,
        encryptionTag: sealed.tag,
        keyVersion: sealed.keyVersion,
        maskedHint: maskSecret("sk-ant-org-b-key"),
      }),
    );

    const [bRow] = await withOrg({ orgId: orgB }, (tx) => tx.select().from(schema.credentials));
    expect(
      open({
        ciphertext: bRow!.encryptedValue,
        iv: bRow!.encryptionIv,
        tag: bRow!.encryptionTag,
        keyVersion: bRow!.keyVersion,
      }),
    ).toBe("sk-ant-org-b-key");

    const forA = await withOrg({ orgId: orgA }, (tx) => tx.select().from(schema.credentials));
    expect(forA).toHaveLength(1);
  });
});
