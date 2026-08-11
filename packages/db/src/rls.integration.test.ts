import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import postgres from "postgres";
import { closeDb, db, withOrg } from "./client";
import * as schema from "./schema/index";

/**
 * Row-level security, against a real database.
 *
 * This is the test that matters most in the whole package: it proves tenant
 * isolation is enforced by Postgres rather than by every query remembering its
 * WHERE clause. Unit tests cannot establish that — only a real connection can.
 *
 * Requires `npm run infra:up` and `npm run db:migrate`. Skipped when DATABASE_URL
 * is unset so the default `npm test` stays runnable with no infrastructure.
 */

const HAS_DB = Boolean(process.env.DATABASE_URL);
const suite = HAS_DB ? describe : describe.skip;

/**
 * Every message in an error's cause chain.
 *
 * Drizzle raises its own error and hangs the driver's underneath, so the
 * Postgres text is not on the message we are handed. Matching the whole chain
 * keeps these assertions pinned to *why* a write was refused: a statement
 * rejected for some unrelated reason would otherwise satisfy a bare `toThrow`
 * and hide a genuine hole.
 */
function causeChain(error: unknown): string {
  const messages: string[] = [];
  for (let e = error, depth = 0; e instanceof Error && depth < 5; e = e.cause, depth++) {
    messages.push(e.message);
  }
  return messages.join(" | ");
}

suite("row-level security", () => {
  let orgA: string;
  let orgB: string;
  /**
   * The schema-owning connection. Used only to seed and clean up things a
   * tenant is not permitted to write, so the tests exercise the same
   * unprivileged role the application uses for everything else.
   */
  let admin: postgres.Sql;

  beforeAll(async () => {
    admin = postgres(process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL!, {
      max: 1,
      onnotice: () => {},
    });
    const suffix = Date.now();
    const [a] = await db()
      .insert(schema.orgs)
      .values({ name: `RLS A ${suffix}`, slug: `rls-a-${suffix}` })
      .returning({ id: schema.orgs.id });
    const [b] = await db()
      .insert(schema.orgs)
      .values({ name: `RLS B ${suffix}`, slug: `rls-b-${suffix}` })
      .returning({ id: schema.orgs.id });

    orgA = a!.id;
    orgB = b!.id;

    await withOrg({ orgId: orgA }, (tx) =>
      tx.insert(schema.companies).values({ orgId: orgA, name: "Acme A", domain: `a-${suffix}.test` }),
    );
    await withOrg({ orgId: orgB }, (tx) =>
      tx.insert(schema.companies).values({ orgId: orgB, name: "Acme B", domain: `b-${suffix}.test` }),
    );
  });

  afterAll(async () => {
    // Deleting the orgs cascades to every tenant row created above.
    if (orgA) await db().execute(sql`DELETE FROM orgs WHERE id = ${orgA}`);
    if (orgB) await db().execute(sql`DELETE FROM orgs WHERE id = ${orgB}`);
    await admin?.end({ timeout: 5 });
    await closeDb();
  });

  it("shows an org only its own rows", async () => {
    const seenByA = await withOrg({ orgId: orgA }, (tx) => tx.select().from(schema.companies));
    expect(seenByA).toHaveLength(1);
    expect(seenByA[0]!.name).toBe("Acme A");

    const seenByB = await withOrg({ orgId: orgB }, (tx) => tx.select().from(schema.companies));
    expect(seenByB).toHaveLength(1);
    expect(seenByB[0]!.name).toBe("Acme B");
  });

  it("returns nothing when no org claim is set — fails closed, not open", async () => {
    // The connection is the table owner, so this is what FORCE ROW LEVEL
    // SECURITY buys: without a claim, a forgotten WHERE returns zero rows
    // rather than every customer's data.
    const rows = await db().select().from(schema.companies);
    expect(rows).toHaveLength(0);
  });

  it("refuses to write a row belonging to another org", async () => {
    // Even with the other org's id in hand, the WITH CHECK clause rejects it.
    await expect(
      withOrg({ orgId: orgA }, (tx) =>
        tx.insert(schema.companies).values({ orgId: orgB, name: "Smuggled" }),
      ),
    ).rejects.toThrow();
  });

  it("cannot read another org's row by its primary key", async () => {
    const [target] = await withOrg({ orgId: orgB }, (tx) =>
      tx.select({ id: schema.companies.id }).from(schema.companies),
    );

    const stolen = await withOrg({ orgId: orgA }, (tx) =>
      tx.select().from(schema.companies).where(sql`id = ${target!.id}`),
    );
    expect(stolen).toHaveLength(0);
  });

  it("cannot update or delete another org's row", async () => {
    const [target] = await withOrg({ orgId: orgB }, (tx) =>
      tx.select({ id: schema.companies.id }).from(schema.companies),
    );

    const updated = await withOrg({ orgId: orgA }, (tx) =>
      tx
        .update(schema.companies)
        .set({ name: "Hijacked" })
        .where(sql`id = ${target!.id}`)
        .returning({ id: schema.companies.id }),
    );
    expect(updated).toHaveLength(0);

    const deleted = await withOrg({ orgId: orgA }, (tx) =>
      tx.delete(schema.companies).where(sql`id = ${target!.id}`).returning({ id: schema.companies.id }),
    );
    expect(deleted).toHaveLength(0);

    const stillThere = await withOrg({ orgId: orgB }, (tx) => tx.select().from(schema.companies));
    expect(stillThere[0]!.name).toBe("Acme B");
  });

  it("does not leak the claim to the next transaction on a pooled connection", async () => {
    // set_config(..., true) is transaction-local. If it were session-local, the
    // next borrower of this connection would inherit org A's claim.
    await withOrg({ orgId: orgA }, (tx) => tx.select().from(schema.companies));
    const afterwards = await db().select().from(schema.companies);
    expect(afterwards).toHaveLength(0);
  });

  it("refuses to let a tenant write a global suppression", async () => {
    // Global rows are national DNC lists and platform-wide opt-outs. A tenant
    // that could write one could suppress a competitor's prospects everywhere.
    const refusal = await withOrg({ orgId: orgA }, (tx) =>
      tx.insert(schema.suppressions).values({
        orgId: null,
        scope: "global",
        kind: "email",
        value: `escalation-${Date.now()}@example.com`,
        reason: "should be rejected",
      }),
    ).then(
      () => null,
      (error: unknown) => error,
    );

    expect(refusal, "the global suppression write was allowed").not.toBeNull();
    expect(causeChain(refusal)).toMatch(/row-level security/i);
  });

  it("lets every org see global suppressions but not each other's", async () => {
    const value = `blocked-${Date.now()}@example.com`;

    // Seeded through the admin connection, because that is the only path that
    // may create a global row — the assertion above proves tenants cannot.
    await admin.unsafe(
      `INSERT INTO suppressions (org_id, scope, kind, value, reason)
       VALUES (NULL, 'global', 'email', $1, 'test global')`,
      [value],
    );

    await withOrg({ orgId: orgA }, (tx) =>
      tx.insert(schema.suppressions).values({
        orgId: orgA,
        scope: "org",
        kind: "email",
        value: `orga-${value}`,
        reason: "test org",
      }),
    );

    const forB = await withOrg({ orgId: orgB }, (tx) =>
      tx.select({ value: schema.suppressions.value }).from(schema.suppressions),
    );
    const values = forB.map((r) => r.value);

    expect(values).toContain(value); // global reaches every org
    expect(values).not.toContain(`orga-${value}`); // org A's stays private

    await admin.unsafe(`DELETE FROM suppressions WHERE value = $1`, [value]);
  });
});
