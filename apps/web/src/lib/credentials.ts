import "server-only";
import { and, desc, eq, maskSecret, open, schema, seal, withOrg } from "@outreach/db";
import { requireProvider } from "@outreach/adapters/registry";
import type { AdapterCtx } from "@outreach/adapters";
import { notFound, providerUnconfigured, validationFailed } from "@outreach/shared";
import type { CredentialStatus, TestResult } from "@outreach/shared";
import type { SessionContext } from "./session";

/**
 * Credential vault service.
 *
 * The one rule: plaintext secrets exist only inside this module and inside the
 * adapter they are handed to. Nothing here returns a secret to a caller that
 * could pass it to a React component, a log line, or a JSON response.
 */

export interface CredentialSummary {
  id: string;
  provider: string;
  label: string;
  maskedHint: string;
  config: Record<string, unknown>;
  status: CredentialStatus;
  lastVerifiedAt: Date | null;
  lastError: string | null;
  createdAt: Date;
}

/** Everything the Connections page needs, and nothing it does not. */
export async function listCredentials(session: SessionContext): Promise<CredentialSummary[]> {
  return withOrg({ orgId: session.orgId, userId: session.userId }, (tx) =>
    tx
      .select({
        id: schema.credentials.id,
        provider: schema.credentials.provider,
        label: schema.credentials.label,
        maskedHint: schema.credentials.maskedHint,
        config: schema.credentials.config,
        status: schema.credentials.status,
        lastVerifiedAt: schema.credentials.lastVerifiedAt,
        lastError: schema.credentials.lastError,
        createdAt: schema.credentials.createdAt,
      })
      .from(schema.credentials)
      .orderBy(desc(schema.credentials.createdAt)),
  );
}

export interface SaveCredentialInput {
  provider: string;
  label: string;
  secret: string;
  config: Record<string, unknown>;
}

/**
 * Create or replace a credential.
 *
 * The config is validated against the provider's registry schema before
 * anything is written, so a half-configured provider never reaches the adapter
 * and fails obscurely later.
 */
export async function saveCredential(
  session: SessionContext,
  input: SaveCredentialInput,
): Promise<CredentialSummary> {
  const provider = requireProvider(input.provider);
  if (!provider.secretField) {
    throw validationFailed(`${provider.name} needs no credential — it is configured on the Sources page instead.`);
  }

  const secret = input.secret.trim();
  if (!secret) {
    throw validationFailed(`${provider.secretField.label} is required.`);
  }

  const parsed = provider.configSchema.safeParse(input.config);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    // Zod's default for a missing key is the bare word "Required", which tells
    // the user nothing on a form with six fields. Name the field.
    const fieldName = String(first?.path[0] ?? "");
    const label = provider.configFields.find((f) => f.name === fieldName)?.label ?? fieldName;
    const message =
      first?.message === "Required" && label
        ? `${label} is required.`
        : (first?.message ?? "Check the provider settings.");

    throw validationFailed(message, parsed.error.issues);
  }

  const sealed = seal(secret);
  const label = input.label.trim() || "Default";

  const [row] = await withOrg({ orgId: session.orgId, userId: session.userId }, async (tx) => {
    const result = await tx
      .insert(schema.credentials)
      .values({
        orgId: session.orgId,
        provider: provider.id,
        label,
        encryptedValue: sealed.ciphertext,
        encryptionIv: sealed.iv,
        encryptionTag: sealed.tag,
        keyVersion: sealed.keyVersion,
        maskedHint: maskSecret(secret),
        config: parsed.data,
        status: "unverified",
        lastError: null,
        lastVerifiedAt: null,
        createdBy: session.userId,
      })
      .onConflictDoUpdate({
        target: [schema.credentials.orgId, schema.credentials.provider, schema.credentials.label],
        set: {
          encryptedValue: sealed.ciphertext,
          encryptionIv: sealed.iv,
          encryptionTag: sealed.tag,
          keyVersion: sealed.keyVersion,
          maskedHint: maskSecret(secret),
          config: parsed.data,
          // Replacing the secret invalidates any previous verification.
          status: "unverified",
          lastError: null,
          lastVerifiedAt: null,
          updatedAt: new Date(),
        },
      })
      .returning();

    await tx.insert(schema.auditLog).values({
      orgId: session.orgId,
      userId: session.userId,
      action: "credential.save",
      entity: "credentials",
      entityId: result[0]!.id,
      // The value is never recorded — only that it changed, and by whom.
      after: { provider: provider.id, label },
    });

    return result;
  });

  return toSummary(row!);
}

export async function deleteCredential(session: SessionContext, id: string): Promise<void> {
  await withOrg({ orgId: session.orgId, userId: session.userId }, async (tx) => {
    const deleted = await tx
      .delete(schema.credentials)
      .where(eq(schema.credentials.id, id))
      .returning({ id: schema.credentials.id, provider: schema.credentials.provider });

    if (deleted.length === 0) throw notFound("Credential");

    await tx.insert(schema.auditLog).values({
      orgId: session.orgId,
      userId: session.userId,
      action: "credential.delete",
      entity: "credentials",
      entityId: id,
      before: { provider: deleted[0]!.provider },
    });
  });
}

/**
 * Run the provider's real test call and persist the outcome.
 *
 * Decryption happens here and the plaintext is handed straight to the adapter;
 * it is never returned, logged, or stored. The result the user sees is whatever
 * the provider actually said.
 */
export async function testCredential(session: SessionContext, id: string): Promise<TestResult> {
  const ctx = await loadAdapterCtxById(session, id);
  const provider = requireProvider(ctx.provider);

  let result: TestResult;
  try {
    result = await provider.adapter.testConnection(ctx.adapterCtx);
  } catch (err) {
    result = {
      ok: false,
      message: err instanceof Error ? err.message : "The connection test failed.",
    };
  }

  await withOrg({ orgId: session.orgId, userId: session.userId }, (tx) =>
    tx
      .update(schema.credentials)
      .set({
        status: result.ok ? "active" : "failing",
        lastVerifiedAt: result.ok ? new Date() : null,
        lastError: result.ok ? null : result.message,
        updatedAt: new Date(),
      })
      .where(eq(schema.credentials.id, id)),
  );

  return result;
}

/**
 * Build an adapter context for a provider, by id.
 *
 * This is the only decryption path in the application. Business logic asks for
 * "the Vapi adapter for this org" and gets a ready-to-use context — it never
 * sees, holds, or passes a raw key.
 */
export async function loadAdapterCtx(
  orgId: string,
  providerId: string,
  label?: string,
): Promise<AdapterCtx> {
  const rows = await withOrg({ orgId }, (tx) =>
    tx
      .select()
      .from(schema.credentials)
      .where(
        label
          ? and(eq(schema.credentials.provider, providerId), eq(schema.credentials.label, label))
          : eq(schema.credentials.provider, providerId),
      )
      .orderBy(desc(schema.credentials.lastVerifiedAt))
      .limit(1),
  );

  const row = rows[0];
  if (!row) throw providerUnconfigured(requireProvider(providerId).name);

  return {
    orgId,
    secret: open({
      ciphertext: row.encryptedValue,
      iv: row.encryptionIv,
      tag: row.encryptionTag,
      keyVersion: row.keyVersion,
    }),
    config: row.config,
  };
}

async function loadAdapterCtxById(
  session: SessionContext,
  id: string,
): Promise<{ provider: string; adapterCtx: AdapterCtx }> {
  const rows = await withOrg({ orgId: session.orgId, userId: session.userId }, (tx) =>
    tx.select().from(schema.credentials).where(eq(schema.credentials.id, id)).limit(1),
  );

  const row = rows[0];
  if (!row) throw notFound("Credential");

  return {
    provider: row.provider,
    adapterCtx: {
      orgId: session.orgId,
      secret: open({
        ciphertext: row.encryptedValue,
        iv: row.encryptionIv,
        tag: row.encryptionTag,
        keyVersion: row.keyVersion,
      }),
      config: row.config,
    },
  };
}

function toSummary(row: typeof schema.credentials.$inferSelect): CredentialSummary {
  return {
    id: row.id,
    provider: row.provider,
    label: row.label,
    maskedHint: row.maskedHint,
    config: row.config,
    status: row.status,
    lastVerifiedAt: row.lastVerifiedAt,
    lastError: row.lastError,
    createdAt: row.createdAt,
  };
}
