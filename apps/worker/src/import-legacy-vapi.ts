/**
 * Import the Vapi credential from the frozen legacy MVP into the vault.
 *
 *   npm run legacy:import-vapi                 first org in the database
 *   npm run legacy:import-vapi -- --org=<id>
 *   npm run legacy:import-vapi -- --dry-run
 *
 * The legacy calling MVP (`legacy/`) reads its keys from its own `.env` and was
 * placing real calls long before this system existed. The rewrite moved
 * credentials into an encrypted table, and nothing carried the old values
 * across — so a working Vapi account looked, from the new UI, exactly like an
 * account that had never been connected.
 *
 * Repeatable on purpose. This database is demo-seeded and has been rebuilt
 * before; the keys living in a git-ignored file one directory away should not
 * have to be re-typed from a dashboard each time.
 *
 * Secrets are never printed — only which fields were found.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import { requireProvider } from "@outreach/adapters";
import { closeDb, db, maskSecret, schema, seal, withOrg } from "@outreach/db";

const LEGACY_ENV = join(process.cwd(), "..", "..", "legacy", ".env");
const LABEL = "legacy-mvp";

function arg(name: string): string | undefined {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit?.split("=").slice(1).join("=") || undefined;
}
const DRY_RUN = process.argv.slice(2).includes("--dry-run");

/** Minimal dotenv reader: KEY=VALUE, ignoring comments, blanks and surrounding quotes. */
function readEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) out[key] = value;
  }
  return out;
}

async function main(): Promise<void> {
  let env: Record<string, string>;
  try {
    env = readEnvFile(LEGACY_ENV);
  } catch {
    console.error(`Could not read ${LEGACY_ENV}. Run this from the repo, with the legacy folder still present.`);
    process.exitCode = 1;
    return;
  }

  const apiKey = (env.VAPI_API_KEY ?? "").trim();
  const config = {
    assistantId: (env.VAPI_ASSISTANT_ID ?? "").trim(),
    publicKey: (env.VAPI_PUBLIC_KEY ?? "").trim(),
    phoneNumberId: (env.VAPI_PHONE_NUMBER_ID ?? "").trim(),
    // The legacy MVP had no shared webhook secret — it predates signed call
    // results. Generate one rather than import an absence; the operator pastes
    // the same value into Vapi when they wire webhooks up.
    webhookSecret: (env.VAPI_WEBHOOK_SECRET ?? "").trim() || crypto.randomUUID().replace(/-/g, ""),
  };

  console.log("Found in legacy/.env:");
  console.log(`  VAPI_API_KEY          ${apiKey ? "present" : "MISSING"}`);
  console.log(`  VAPI_ASSISTANT_ID     ${config.assistantId ? "present" : "MISSING"}`);
  console.log(`  VAPI_PUBLIC_KEY       ${config.publicKey ? "present" : "missing (browser test calls need this)"}`);
  console.log(`  VAPI_PHONE_NUMBER_ID  ${config.phoneNumberId ? "present" : "empty (browser calls only)"}`);

  if (!apiKey || !config.assistantId) {
    console.error("\nA private API key and an assistant ID are the minimum. Nothing was written.");
    process.exitCode = 1;
    return;
  }

  // Validate through the registry rather than trusting the file: this is the
  // same schema the Connections form enforces, so an import cannot create a
  // credential the UI would have rejected.
  const provider = requireProvider("vapi");
  const parsed = provider.configSchema.safeParse(config);
  if (!parsed.success) {
    console.error("\nThe imported config is not valid for this provider:");
    console.error(JSON.stringify(parsed.error.flatten().fieldErrors, null, 2));
    process.exitCode = 1;
    return;
  }

  const orgId = arg("org") ?? (await db().select({ id: schema.orgs.id }).from(schema.orgs).limit(1))[0]?.id;
  if (!orgId) {
    console.error("No org found. Seed the database first.");
    process.exitCode = 1;
    return;
  }

  if (DRY_RUN) {
    console.log(`\nDry run — would write a "${LABEL}" Vapi credential to org ${orgId}.`);
    return;
  }

  const sealed = seal(apiKey);
  await withOrg({ orgId }, async (tx) => {
    const existing = await tx
      .select({ id: schema.credentials.id })
      .from(schema.credentials)
      .where(and(eq(schema.credentials.provider, "vapi"), eq(schema.credentials.label, LABEL)))
      .limit(1);

    const values = {
      encryptedValue: sealed.ciphertext,
      encryptionIv: sealed.iv,
      encryptionTag: sealed.tag,
      keyVersion: sealed.keyVersion,
      maskedHint: maskSecret(apiKey),
      config: parsed.data,
      // Re-importing a key says nothing about whether it still works. Leaving it
      // unverified means the Connections page shows "Not tested" until something
      // actually calls Vapi.
      status: "unverified" as const,
      lastVerifiedAt: null,
      lastError: null,
      updatedAt: new Date(),
    };

    if (existing[0]) {
      await tx.update(schema.credentials).set(values).where(eq(schema.credentials.id, existing[0].id));
      console.log(`\nUpdated the existing "${LABEL}" Vapi credential.`);
    } else {
      await tx.insert(schema.credentials).values({ orgId, provider: "vapi", label: LABEL, ...values });
      console.log(`\nCreated a "${LABEL}" Vapi credential.`);
    }

    await tx.insert(schema.auditLog).values({
      orgId,
      action: "credential.import",
      entity: "credentials",
      after: { provider: "vapi", label: LABEL, source: "legacy/.env" },
    });
  });

  console.log("Next: run `npm run providers:verify -- --provider=vapi` to confirm the key still works.");
}

// See verify-providers.ts: calling process.exit while the postgres pool still
// holds open handles trips a libuv assertion on Windows, reporting a crash after
// a run that actually succeeded. Set the code, close the pool, let node exit.
main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
