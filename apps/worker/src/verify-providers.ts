/**
 * Live provider verification.
 *
 * Runs each provider's `testConnection` against the real API using the
 * credentials actually saved for an org, and prints a table of what passed.
 *
 *   npm run providers:verify              every org, every saved credential
 *   npm run providers:verify -- --org=<id>  one org
 *   npm run providers:verify -- --provider=hubspot
 *
 * Why this exists: `registry.verified` claims a provider has been exercised
 * against a live account. Until now that flag was maintained by hand, which
 * makes it a comment rather than a fact. This is the command that produces the
 * evidence — and it writes the result back to `credentials.status`, so the
 * Connections page reflects a real call rather than the last thing someone
 * assumed.
 *
 * It cannot verify a provider nobody has a key for. Those are reported as
 * "no credential", which is the honest state: not broken, not proven.
 */
import { and, desc, eq } from "drizzle-orm";
import { PROVIDERS, requireProvider } from "@outreach/adapters";
import type { TestResult } from "@outreach/shared";
import { closeDb, db, open, schema, withOrg } from "@outreach/db";

interface Outcome {
  orgName: string;
  providerId: string;
  label: string | null;
  state: "pass" | "fail" | "error";
  message: string;
  latencyMs?: number;
}

function arg(name: string): string | undefined {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit?.split("=").slice(1).join("=") || undefined;
}

async function verifyOne(
  orgId: string,
  row: typeof schema.credentials.$inferSelect,
): Promise<{ state: Outcome["state"]; result: TestResult }> {
  const provider = requireProvider(row.provider);

  let secret: string;
  try {
    secret = open({
      ciphertext: row.encryptedValue,
      iv: row.encryptionIv,
      tag: row.encryptionTag,
      keyVersion: row.keyVersion,
    });
  } catch (err) {
    // A credential that cannot be decrypted is a different failure from one the
    // vendor rejected — usually a rotated CREDENTIAL_ENCRYPTION_KEY — and
    // reporting it as "the API said no" would send someone hunting the wrong bug.
    return {
      state: "error",
      result: { ok: false, message: `Could not decrypt: ${err instanceof Error ? err.message : "unknown"}` },
    };
  }

  // 30s ceiling. A provider that hangs must not hang the whole sweep.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const result = await provider.adapter.testConnection({
      orgId,
      secret,
      config: row.config,
      signal: controller.signal,
    });
    return { state: result.ok ? "pass" : "fail", result };
  } catch (err) {
    return {
      state: "error",
      result: { ok: false, message: err instanceof Error ? err.message : "threw a non-Error" },
    };
  } finally {
    clearTimeout(timer);
  }
}

async function main(): Promise<void> {
  const onlyOrg = arg("org");
  const onlyProvider = arg("provider");
  if (onlyProvider) requireProvider(onlyProvider); // fail fast on a typo

  const orgs = await db()
    .select({ id: schema.orgs.id, name: schema.orgs.name })
    .from(schema.orgs);
  const targets = onlyOrg ? orgs.filter((o) => o.id === onlyOrg) : orgs;

  if (targets.length === 0) {
    console.log(onlyOrg ? `No org with id ${onlyOrg}.` : "No orgs in this database.");
    process.exitCode = 1;
    return;
  }

  const outcomes: Outcome[] = [];
  const seenProviders = new Set<string>();

  // Keyless providers first. They have nothing in `credentials` to iterate, so
  // a credential-driven sweep would skip them forever and report them as
  // untestable — when in fact they are the only ones testable with no setup at
  // all. One org id is enough; there is no per-org secret to vary.
  const keyless = PROVIDERS.filter(
    (p) => p.requiresCredential === false && (onlyProvider ? p.id === onlyProvider : true),
  );
  for (const p of keyless) {
    seenProviders.add(p.id);
    process.stdout.write(`  testing ${p.id} (keyless) … `);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    let state: Outcome["state"];
    let result: TestResult;
    try {
      result = await p.adapter.testConnection({
        orgId: targets[0]?.id ?? "",
        secret: "",
        config: {},
        signal: controller.signal,
      });
      state = result.ok ? "pass" : "fail";
    } catch (err) {
      state = "error";
      result = { ok: false, message: err instanceof Error ? err.message : "threw a non-Error" };
    } finally {
      clearTimeout(timer);
    }
    console.log(state.toUpperCase());
    outcomes.push({
      orgName: "—",
      providerId: p.id,
      label: "keyless",
      state,
      message: result.message,
      latencyMs: result.latencyMs,
    });
  }

  for (const org of targets) {
    const rows = await withOrg({ orgId: org.id }, (tx) =>
      tx
        .select()
        .from(schema.credentials)
        .where(
          onlyProvider
            ? and(eq(schema.credentials.orgId, org.id), eq(schema.credentials.provider, onlyProvider))
            : eq(schema.credentials.orgId, org.id),
        )
        .orderBy(desc(schema.credentials.updatedAt)),
    );

    for (const row of rows) {
      seenProviders.add(row.provider);
      process.stdout.write(`  testing ${org.name} / ${row.provider}${row.label ? ` (${row.label})` : ""} … `);
      const { state, result } = await verifyOne(org.id, row);
      console.log(state.toUpperCase());

      outcomes.push({
        orgName: org.name,
        providerId: row.provider,
        label: row.label,
        state,
        message: result.message,
        latencyMs: result.latencyMs,
      });

      // Same write the Connections page's Test button performs, so a sweep and a
      // click leave the system in the same state.
      await withOrg({ orgId: org.id }, (tx) =>
        tx
          .update(schema.credentials)
          .set({
            status: state === "pass" ? "active" : "failing",
            lastVerifiedAt: state === "pass" ? new Date() : null,
            lastError: state === "pass" ? null : result.message,
            updatedAt: new Date(),
          })
          .where(eq(schema.credentials.id, row.id)),
      );
    }
  }

  console.log("\n=== Results ===");
  if (outcomes.length === 0) {
    console.log("No credentials are saved, so nothing could be verified.");
  }
  for (const o of outcomes) {
    const mark = o.state === "pass" ? "PASS" : o.state === "fail" ? "FAIL" : "ERR ";
    const ms = o.latencyMs === undefined ? "" : ` ${o.latencyMs}ms`;
    console.log(`  ${mark}  ${o.providerId}${o.label ? ` (${o.label})` : ""}${ms} — ${o.message}`);
  }

  // The point of the report: which providers remain claims rather than facts.
  const unproven = PROVIDERS.filter(
    (p) => !seenProviders.has(p.id) && (onlyProvider ? p.id === onlyProvider : true),
  );
  if (unproven.length > 0) {
    console.log("\n=== No credential on file — cannot be verified ===");
    for (const p of unproven) {
      const flag = p.requiresCredential === false ? " (keyless)" : "";
      console.log(`  ----  ${p.id}${flag}${p.verified ? "" : "  [registry says unverified]"}`);
    }
  }

  const failed = outcomes.filter((o) => o.state !== "pass").length;
  console.log(
    `\n${outcomes.length - failed}/${outcomes.length} verified, ${unproven.length} untestable without a credential.`,
  );
  // Non-zero only for a credential that exists and did not work. Missing keys
  // are not a failure — they are the normal state of an unconfigured provider,
  // and failing CI over one would make the command useless in CI.
  process.exitCode = failed > 0 ? 1 : 0;
}

// `process.exit` while the postgres pool still holds open handles aborts the
// process with a libuv assertion on Windows — which reports a crash even when
// every check passed. Set the code, close the pool, let node exit on its own.
main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
