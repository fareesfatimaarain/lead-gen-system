import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import postgres from "postgres";
import * as schema from "./schema/index";

export type Database = ReturnType<typeof drizzle<typeof schema>>;

/**
 * A transaction handle. Everything that writes takes one of these rather than
 * the pool, so a caller can compose several writes — and the job that acts on
 * them — into one atomic unit.
 */
export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

let _sql: postgres.Sql | undefined;
let _db: Database | undefined;

function connectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env, then run `npm run infra:up`.",
    );
  }
  return url;
}

/**
 * The raw connection.
 *
 * Every org-scoped table has FORCE ROW LEVEL SECURITY, so this handle sees no
 * tenant rows until `app.org_id` is set on the transaction. Use `withOrg()` for
 * anything touching customer data; this handle is for auth, migrations, and
 * genuinely cross-tenant maintenance.
 */
export function db(): Database {
  if (!_db) {
    _sql = postgres(connectionString(), {
      max: Number(process.env.DB_POOL_MAX ?? 10),
      idle_timeout: 30,
      // Timestamps come back as Date; numerics stay strings so money never
      // round-trips through a float.
      types: {},
      onnotice: () => {},
    });
    _db = drizzle(_sql, { schema });
  }
  return _db;
}

export function rawSql(): postgres.Sql {
  db();
  return _sql!;
}

export async function closeDb(): Promise<void> {
  if (_sql) {
    await _sql.end({ timeout: 5 });
    _sql = undefined;
    _db = undefined;
  }
}

export interface TenantContext {
  orgId: string;
  userId?: string;
}

/**
 * Run a callback inside a transaction scoped to one org.
 *
 * `set_config(..., true)` makes the setting transaction-local, so it cannot leak
 * to the next borrower of a pooled connection. This is the only sanctioned way
 * to read or write tenant data: the org id comes from the server-side session,
 * never from a header or request body, and RLS enforces it in the database
 * rather than relying on every query remembering its WHERE clause.
 */
export async function withOrg<T>(
  ctx: TenantContext,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db().transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.org_id', ${ctx.orgId}, true)`);
    await tx.execute(sql`SELECT set_config('app.user_id', ${ctx.userId ?? ""}, true)`);
    return fn(tx);
  });
}

/**
 * Run a callback with only a user claim set — no org.
 *
 * For the sign-in and org-picker paths, which have to resolve a user's
 * memberships before an active org exists. Tenant tables are invisible here.
 */
export async function withUser<T>(
  userId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db().transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
    return fn(tx);
  });
}

export { schema };
