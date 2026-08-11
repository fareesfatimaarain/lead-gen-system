import Link from "next/link";
import type { PublicProviderDefinition } from "@outreach/adapters/registry";
import type { schema } from "@outreach/db";
import { Badge, StatusDot } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { AddSourceButton } from "./AddSourceButton";
import { RemoveSourceButton, StatusForm, WeightForm } from "./SourceRowControls";
import { TestSourceButton } from "./TestSourceButton";

type DataSourceRow = typeof schema.dataSources.$inferSelect;
interface CredentialRow {
  id: string;
  provider: string;
  status: "unverified" | "active" | "failing" | "revoked";
  maskedHint: string;
}

/**
 * Registry-driven half of the Sources screen.
 *
 * Every card here is a real adapter, not a freeform label — the id posted by
 * "Add to sources" is the same id `requireProvider()` resolves at run time.
 * Whether a card needs a credential first is read off the provider
 * definition, not hardcoded per provider.
 */
export function SourceRegistryGrid({
  groups,
  registry,
  credentials,
  dataSources,
  canManage,
  canTest,
}: {
  groups: { category: string; label: string; providerIds: string[] }[];
  registry: PublicProviderDefinition[];
  credentials: CredentialRow[];
  dataSources: DataSourceRow[];
  canManage: boolean;
  canTest: boolean;
}) {
  const byId = new Map(registry.map((p) => [p.id, p]));
  const credByProvider = new Map(credentials.map((c) => [c.provider, c]));
  const sourceByProvider = new Map(dataSources.filter((d) => d.provider).map((d) => [d.provider as string, d]));

  return (
    <div className="flex flex-col gap-6">
      {groups.map((group) => (
        <section key={group.category}>
          <h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-fg-subtle">{group.label}</h2>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {group.providerIds.map((id) => {
              const provider = byId.get(id);
              if (!provider) return null;
              const credential = credByProvider.get(id);
              const dataSource = sourceByProvider.get(id);
              const needsCredential = provider.requiresCredential !== false;

              return (
                <div key={id} className="flex flex-col rounded border border-border bg-surface">
                  <div className="px-3 pb-2 pt-2.5">
                    <div className="flex items-center gap-1.5">
                      <h3 className="truncate text-base font-medium text-fg">{provider.name}</h3>
                      {!provider.verified ? (
                        <span
                          title="Written from the provider's public documentation but not yet exercised against a live account from this codebase."
                          className="cursor-help"
                        >
                          <Badge tone="warn">unverified</Badge>
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-0.5 text-sm text-fg-muted">{provider.summary}</p>
                  </div>

                  <div className="border-t border-border px-3 py-2 text-xs">
                    {!needsCredential ? (
                      <span className="text-fg-subtle">No credential needed — built in.</span>
                    ) : credential ? (
                      <span className="flex items-center gap-1.5 text-fg-subtle">
                        <StatusDot tone={credential.status === "active" ? "ok" : credential.status === "failing" ? "danger" : "warn"} />
                        {credential.maskedHint}
                      </span>
                    ) : (
                      <Link href="/connections" className="motion-ok text-accent hover:underline">
                        Connect on Connections page →
                      </Link>
                    )}
                  </div>

                  {dataSource ? (
                    <div className="flex flex-col gap-2 border-t border-border px-3 py-2.5">
                      <StatusForm id={dataSource.id} status={dataSource.status} canManage={canManage} />

                      {canManage ? (
                        <WeightForm
                          id={dataSource.id}
                          name={dataSource.name}
                          kind={dataSource.kind}
                          status={dataSource.status}
                          weight={dataSource.weight}
                        />
                      ) : null}

                      {dataSource.lastTestedAt ? (
                        <p className="flex items-center gap-1.5 text-2xs text-fg-subtle">
                          <StatusDot tone={dataSource.lastTestOk ? "ok" : "danger"} />
                          {dataSource.lastTestMessage ?? (dataSource.lastTestOk ? "Connected" : "Failed")} · {formatDateTime(dataSource.lastTestedAt, new Date())}
                        </p>
                      ) : null}

                      <div className="flex items-center gap-2 pt-0.5">
                        {canTest ? <TestSourceButton id={dataSource.id} /> : null}
                        {canManage ? (
                          <div className="ml-auto">
                            <RemoveSourceButton id={dataSource.id} />
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 border-t border-border px-3 py-2">
                      {canManage && (!needsCredential || credential) ? (
                        <AddSourceButton provider={id} credentialId={credential?.id} />
                      ) : (
                        <span className="text-xs text-fg-subtle">{needsCredential ? "Connect a credential to add this." : "—"}</span>
                      )}
                      <a
                        href={provider.docsUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="motion-ok ml-auto text-xs text-fg-subtle hover:text-fg-muted"
                      >
                        Docs
                      </a>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
