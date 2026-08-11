import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

/**
 * Migration runner.
 *
 * Connects as the **admin** role (DATABASE_ADMIN_URL), which owns the schema and
 * runs DDL. The application connects as a separate, unprivileged role — see
 * `ensureAppRole` below for why that separation is not optional.
 *
 * Order matters and is not negotiable:
 *   1. `sql/0*` — extensions and helper functions. The generated migrations
 *      create trigram indexes, which need pg_trgm to already exist.
 *   2. Drizzle's generated migrations — tables, columns, indexes.
 *   3. `ensureAppRole()` — the runtime role and its grants.
 *   4. `sql/9*` — triggers and RLS policies. Last, because they reference tables
 *      the generated migrations create, and re-running them is how a newly added
 *      table picks up its policy.
 *
 * Steps 1, 3 and 4 are idempotent, so this is safe to re-run.
 */

const here = dirname(fileURLToPath(import.meta.url));
const sqlDir = join(here, "sql");
const migrationsDir = join(here, "..", "migrations");

const APP_ROLE = process.env.APP_DB_USER ?? "outreach_app";

function adminUrl(): string {
  const url = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_ADMIN_URL is not set. Copy .env.example to .env, then run `npm run infra:up`.",
    );
  }
  return url;
}

const client = postgres(adminUrl(), { max: 1, onnotice: () => {} });
const adminDb = drizzle(client);

async function runSqlFiles(matches: (name: string) => boolean): Promise<void> {
  const files = (await readdir(sqlDir)).filter((f) => f.endsWith(".sql") && matches(f)).sort();
  for (const file of files) {
    process.stdout.write(`  ${file} ... `);
    await client.unsafe(await readFile(join(sqlDir, file), "utf8"));
    process.stdout.write("ok\n");
  }
}

/**
 * Create the runtime role.
 *
 * This exists because of a real failure: the default Postgres superuser has
 * BYPASSRLS, and a superuser ignores row-level security **even with FORCE ROW
 * LEVEL SECURITY set**. Every policy was in place and every tenant could still
 * read every other tenant's rows — silently, with no error to notice.
 *
 * So the application must connect as a role that is explicitly NOSUPERUSER and
 * NOBYPASSRLS. The integration tests in `rls.integration.test.ts` are what keep
 * this honest; if they ever pass while connected as a superuser, they are
 * proving nothing.
 */
async function ensureAppRole(): Promise<void> {
  const password = process.env.APP_DB_PASSWORD;
  if (!password) {
    throw new Error(
      "APP_DB_PASSWORD is not set. It is the password for the unprivileged role the app connects as.",
    );
  }

  await client.unsafe(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${APP_ROLE}') THEN
        CREATE ROLE ${APP_ROLE} LOGIN;
      END IF;
    END $$;
  `);

  // Asserted every run, not just at creation: a role that drifts to BYPASSRLS
  // disables tenant isolation everywhere at once.
  await client.unsafe(`ALTER ROLE ${APP_ROLE} NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE LOGIN`);
  await client.unsafe(`ALTER ROLE ${APP_ROLE} PASSWORD ${escapeLiteral(password)}`);

  await client.unsafe(`
    GRANT USAGE ON SCHEMA public, app TO ${APP_ROLE};
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${APP_ROLE};
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${APP_ROLE};
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO ${APP_ROLE};

    -- Tables added by a future migration inherit the same grants automatically,
    -- so a new table is never accidentally unreadable or unprotected.
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${APP_ROLE};
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT USAGE, SELECT ON SEQUENCES TO ${APP_ROLE};
    ALTER DEFAULT PRIVILEGES IN SCHEMA app
      GRANT EXECUTE ON FUNCTIONS TO ${APP_ROLE};
  `);

  const [row] = await client.unsafe<{ rolsuper: boolean; rolbypassrls: boolean }[]>(
    `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = '${APP_ROLE}'`,
  );
  if (row?.rolsuper || row?.rolbypassrls) {
    throw new Error(
      `Role ${APP_ROLE} still has SUPERUSER or BYPASSRLS. Row-level security would not apply — aborting.`,
    );
  }
}

function escapeLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

async function main(): Promise<void> {
  console.log("Applying extensions and helpers");
  await runSqlFiles((f) => f.startsWith("0"));

  console.log("Applying generated migrations");
  try {
    await migrate(adminDb, { migrationsFolder: migrationsDir });
    console.log("  ok");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("ENOENT")) {
      console.log("  no migrations found — run `npm run db:generate` first");
    } else {
      throw err;
    }
  }

  console.log(`Ensuring unprivileged application role (${APP_ROLE})`);
  await ensureAppRole();
  console.log("  ok — NOSUPERUSER, NOBYPASSRLS confirmed");

  console.log("Applying triggers and row-level security");
  await runSqlFiles((f) => f.startsWith("9"));

  console.log("\nMigration complete.");
}

main()
  .catch((err) => {
    console.error("\nMigration failed:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => client.end({ timeout: 5 }));
