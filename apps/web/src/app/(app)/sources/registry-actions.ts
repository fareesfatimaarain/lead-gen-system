"use server";

import { revalidatePath } from "next/cache";
import { eq, open, schema, withOrg } from "@outreach/db";
import { requireProvider, SOURCE_CATEGORIES } from "@outreach/adapters/registry";
import type { AdapterCtx } from "@outreach/adapters";
import { notFound, validationFailed } from "@outreach/shared";
import { action, str } from "@/lib/action";
import type { ActionState } from "@/lib/action";

/**
 * Turns a registry provider into an active data source for this org.
 *
 * Connections owns the credential; this owns whether and how heavily
 * discovery uses it. A keyless provider (`requiresCredential: false`) needs
 * no credential row at all — its context is built straight from `config` at
 * call time, never from the vault.
 */
export async function addRegistrySourceAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return action("write", async (session) => {
    const providerId = str(form, "provider");
    const credentialId = str(form, "credentialId") || null;

    const provider = requireProvider(providerId);
    if (!SOURCE_CATEGORIES.includes(provider.category)) {
      throw validationFailed("That provider is not a data source.");
    }

    await withOrg({ orgId: session.orgId, userId: session.userId }, async (tx) => {
      if (provider.requiresCredential !== false && !credentialId) {
        throw validationFailed(`Connect ${provider.name} on the Connections page first.`);
      }

      if (credentialId) {
        const [credential] = await tx
          .select({ id: schema.credentials.id, provider: schema.credentials.provider })
          .from(schema.credentials)
          .where(eq(schema.credentials.id, credentialId))
          .limit(1);
        if (!credential || credential.provider !== provider.id) {
          throw validationFailed("That credential does not match this provider.");
        }
      }

      const [existing] = await tx
        .select({ id: schema.dataSources.id })
        .from(schema.dataSources)
        .where(eq(schema.dataSources.provider, provider.id))
        .limit(1);

      if (existing) {
        // Already added — re-running this just rebinds the credential (the
        // user replaced a key on Connections) and reactivates it.
        await tx
          .update(schema.dataSources)
          .set({ credentialId, status: "active", updatedAt: new Date() })
          .where(eq(schema.dataSources.id, existing.id));
        return;
      }

      await tx.insert(schema.dataSources).values({
        orgId: session.orgId,
        name: provider.name,
        kind: provider.category,
        provider: provider.id,
        credentialId,
        status: "active",
        weight: 50,
        createdBy: session.userId,
      });
    });

    revalidatePath("/sources");
    return { ok: true, message: `${provider.name} added.` };
  });
}

/**
 * Runs the provider's real `testConnection` for one data source instance and
 * records the outcome. Requires `manage_credentials` because, for a keyed
 * provider, this decrypts the secret and calls out as the customer — the same
 * privilege boundary the Connections test button enforces.
 */
export async function testDataSourceAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return action("manage_credentials", async (session) => {
    const id = str(form, "id");
    if (!id) throw validationFailed("Select a source to test.");

    const result = await withOrg({ orgId: session.orgId, userId: session.userId }, async (tx) => {
      const [row] = await tx.select().from(schema.dataSources).where(eq(schema.dataSources.id, id)).limit(1);
      if (!row) throw notFound("Data source");
      if (!row.provider) throw validationFailed("This is a manually tracked source; there is nothing to test.");

      const provider = requireProvider(row.provider);
      let ctx: AdapterCtx;

      if (provider.requiresCredential === false) {
        ctx = { orgId: session.orgId, secret: "", config: row.config ?? {} };
      } else {
        if (!row.credentialId) throw validationFailed(`No credential is attached. Connect ${provider.name} on the Connections page.`);
        const [credential] = await tx
          .select()
          .from(schema.credentials)
          .where(eq(schema.credentials.id, row.credentialId))
          .limit(1);
        if (!credential) throw validationFailed("The connected credential no longer exists. Reconnect it on the Connections page.");
        ctx = {
          orgId: session.orgId,
          secret: open({
            ciphertext: credential.encryptedValue,
            iv: credential.encryptionIv,
            tag: credential.encryptionTag,
            keyVersion: credential.keyVersion,
          }),
          config: { ...credential.config, ...row.config },
        };
      }

      let outcome;
      try {
        outcome = await provider.adapter.testConnection(ctx);
      } catch (err) {
        outcome = { ok: false, message: err instanceof Error ? err.message : "The connection test failed." };
      }

      await tx
        .update(schema.dataSources)
        .set({ lastTestedAt: new Date(), lastTestOk: outcome.ok, lastTestMessage: outcome.message, updatedAt: new Date() })
        .where(eq(schema.dataSources.id, id));

      return outcome;
    });

    revalidatePath("/sources");
    return { ok: result.ok, message: result.message };
  });
}
