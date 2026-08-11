import { providersByCategory, PROVIDERS, publicRegistry } from "@outreach/adapters/registry";
import { PageHeader } from "@/components/ui";
import { listCredentials } from "@/lib/credentials";
import { requirePageSession } from "@/lib/session";
import { ConnectionsGrid } from "./ConnectionsGrid";

/**
 * Connections.
 *
 * Rendered entirely from the adapter registry — there is no per-provider markup
 * anywhere in this file. Adding a provider is a registry entry plus an adapter,
 * and this page picks it up with no change.
 */
export default async function ConnectionsPage() {
  const session = await requirePageSession();
  const credentials = await listCredentials(session);

  // A keyless provider (`requiresCredential: false`) has nothing for this page
  // to manage — it never has a key to store, mask, rotate or test here. It
  // still appears on the Sources page, which is what enables and ranks it.
  const groups = providersByCategory(PROVIDERS.filter((p) => p.requiresCredential !== false)).map((g) => ({
    category: g.category,
    label: g.label,
    providerIds: g.providers.map((p) => p.id),
  }));

  return (
    <>
      <PageHeader
        title="Connections"
        description="Keys are encrypted before they are stored and are never shown again. Test writes nothing and sends nothing."
      />
      <ConnectionsGrid
        registry={publicRegistry()}
        groups={groups}
        credentials={credentials.map((c) => ({
          ...c,
          lastVerifiedAt: c.lastVerifiedAt?.toISOString() ?? null,
          createdAt: c.createdAt.toISOString(),
        }))}
        canManage={session.role === "owner"}
      />
    </>
  );
}
