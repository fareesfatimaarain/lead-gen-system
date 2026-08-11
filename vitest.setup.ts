import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Load the root .env for tests.
 *
 * Integration tests that need Postgres key off DATABASE_URL and skip themselves
 * when it is absent, so this loader is what decides whether they run. Unit tests
 * are unaffected either way.
 */
const rootEnv = join(dirname(fileURLToPath(import.meta.url)), ".env");

try {
  for (const line of readFileSync(rootEnv, "utf8").split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = rawValue.replace(/^["']|["']$/g, "");
  }
} catch {
  // No .env — integration tests will skip.
}
