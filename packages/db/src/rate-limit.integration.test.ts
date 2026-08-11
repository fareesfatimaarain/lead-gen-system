import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { clearRateLimit, closeDb, consumeRateLimit, db, pruneRateLimits } from "./index";

/**
 * Rate limiting, against a real database.
 *
 * The concurrency guarantee is the whole point of putting the counter in
 * Postgres, and it cannot be tested without Postgres — an in-process fake would
 * serialize the very calls the test is trying to overlap.
 *
 * Requires `npm run infra:up` and `npm run db:migrate`. Skipped when DATABASE_URL
 * is unset so the default `npm test` stays runnable with no infrastructure.
 */

const HAS_DB = Boolean(process.env.DATABASE_URL);
const suite = HAS_DB ? describe : describe.skip;

suite("rate limiting", () => {
  let key: string;

  beforeEach(async () => {
    key = `test:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    // Emptied rather than filtered: keys are stored hashed, so a test cannot
    // write a WHERE clause for its own row, and two of these tests backdate
    // every window to simulate time passing.
    await db().execute(sql`DELETE FROM rate_limits`);
  });

  afterAll(async () => {
    await closeDb();
  });

  it("allows attempts up to the limit and refuses the next one", async () => {
    const policy = { key, limit: 3, windowSeconds: 60 };

    for (let i = 1; i <= 3; i++) {
      const result = await consumeRateLimit(policy);
      expect(result.allowed, `attempt ${i} should be allowed`).toBe(true);
      expect(result.attempts).toBe(i);
    }

    const blocked = await consumeRateLimit(policy);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it("counts concurrent attempts exactly once each", async () => {
    // Ten requests racing on one key. If the read and the write were separate
    // statements, several would read the same count and all be allowed — which
    // is precisely how a limiter gets bypassed under the load it exists for.
    const policy = { key, limit: 4, windowSeconds: 60 };
    const results = await Promise.all(Array.from({ length: 10 }, () => consumeRateLimit(policy)));

    expect(results.filter((r) => r.allowed)).toHaveLength(4);
    expect(results.map((r) => r.attempts).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("starts a fresh window once the old one has passed", async () => {
    const policy = { key, limit: 1, windowSeconds: 60 };
    expect((await consumeRateLimit(policy)).allowed).toBe(true);
    expect((await consumeRateLimit(policy)).allowed).toBe(false);

    // Backdating the window is how the passage of time is simulated; waiting out
    // a real window would make this test take a minute to prove one branch.
    await db().execute(sql`UPDATE rate_limits SET window_start = now() - interval '61 seconds'`);

    const afterWindow = await consumeRateLimit(policy);
    expect(afterWindow.allowed).toBe(true);
    expect(afterWindow.attempts).toBe(1);
  });

  it("separates counters that differ only by key", async () => {
    const other = `${key}:other`;
    await consumeRateLimit({ key, limit: 1, windowSeconds: 60 });
    await consumeRateLimit({ key, limit: 1, windowSeconds: 60 });

    const untouched = await consumeRateLimit({ key: other, limit: 1, windowSeconds: 60 });
    expect(untouched.allowed).toBe(true);
    await clearRateLimit(other);
  });

  it("clears a counter so a successful sign-in resets the budget", async () => {
    const policy = { key, limit: 2, windowSeconds: 60 };
    await consumeRateLimit(policy);
    await consumeRateLimit(policy);
    expect((await consumeRateLimit(policy)).allowed).toBe(false);

    await clearRateLimit(key);
    expect((await consumeRateLimit(policy)).allowed).toBe(true);
  });

  it("stores no plaintext subject", async () => {
    // The key is a real email address here, which is the case that matters: the
    // table must not become a list of who has an account.
    await consumeRateLimit({ key: "signin:email:victim@example.com", limit: 5, windowSeconds: 60 });

    const rows = await db().execute(
      sql`SELECT key FROM rate_limits WHERE key LIKE '%victim%' OR key LIKE '%example.com%'`,
    );
    expect(rows as unknown as unknown[]).toHaveLength(0);

    await clearRateLimit("signin:email:victim@example.com");
  });

  it("prunes only rows whose window has closed", async () => {
    await consumeRateLimit({ key, limit: 5, windowSeconds: 60 });
    expect(await pruneRateLimits(60)).toBe(0);

    await db().execute(sql`UPDATE rate_limits SET window_start = now() - interval '2 hours'`);
    expect(await pruneRateLimits(60)).toBeGreaterThan(0);
  });
});
