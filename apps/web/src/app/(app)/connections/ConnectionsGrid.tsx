"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { PublicProviderDefinition } from "@outreach/adapters/registry";
import type { CredentialStatus, TestResult } from "@outreach/shared";
import {
  Badge,
  Button,
  Card,
  Checkbox,
  cx,
  Field,
  InlineError,
  Input,
  ProgressBar,
  Select,
  StatusDot,
} from "@/components/ui";

interface CredentialRow {
  id: string;
  provider: string;
  label: string;
  maskedHint: string;
  config: Record<string, unknown>;
  status: CredentialStatus;
  lastVerifiedAt: string | null;
  lastError: string | null;
  createdAt: string;
}

export function ConnectionsGrid({
  registry,
  groups,
  credentials,
  canManage,
}: {
  registry: PublicProviderDefinition[];
  groups: { category: string; label: string; providerIds: string[] }[];
  credentials: CredentialRow[];
  canManage: boolean;
}) {
  const byId = new Map(registry.map((p) => [p.id, p]));
  const credByProvider = new Map(credentials.map((c) => [c.provider, c]));
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div className="p-6">
      {!canManage ? (
        <p className="mb-4 rounded border border-border bg-surface px-3 py-2 text-sm text-fg-muted">
          Only an owner can add or remove credentials. You can see what is connected and its health.
        </p>
      ) : null}

      <div className="flex flex-col gap-6">
        {groups.map((group) => (
          <section key={group.category}>
            <h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-fg-subtle">
              {group.label}
            </h2>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {group.providerIds.map((id) => {
                const provider = byId.get(id);
                if (!provider) return null;
                return (
                  <ProviderCard
                    key={id}
                    provider={provider}
                    credential={credByProvider.get(id)}
                    canManage={canManage}
                    expanded={expanded === id}
                    onToggle={() => setExpanded((cur) => (cur === id ? null : id))}
                  />
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

const STATUS_META: Record<CredentialStatus, { tone: "ok" | "danger" | "warn" | "neutral"; label: string }> = {
  active: { tone: "ok", label: "Connected" },
  failing: { tone: "danger", label: "Failing" },
  unverified: { tone: "warn", label: "Not tested" },
  revoked: { tone: "neutral", label: "Revoked" },
};

function ProviderCard({
  provider,
  credential,
  canManage,
  expanded,
  onToggle,
}: {
  provider: PublicProviderDefinition;
  credential?: CredentialRow;
  canManage: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  const status = credential ? STATUS_META[credential.status] : null;

  async function submit(formData: FormData) {
    setError(null);
    setTestResult(null);
    setBusy(true);

    const config: Record<string, unknown> = {};
    for (const field of provider.configFields) {
      const raw = formData.get(field.name);
      if (field.type === "boolean") config[field.name] = raw === "on";
      else if (raw !== null && String(raw).length > 0) config[field.name] = raw;
    }

    try {
      const response = await fetch("/api/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: provider.id,
          label: "Default",
          secret: formData.get("__secret"),
          config,
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body?.error?.message ?? "Could not save this credential.");
        return;
      }
      startTransition(() => router.refresh());
      onToggle();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    if (!credential) return;
    setBusy(true);
    setError(null);
    setTestResult(null);
    try {
      const response = await fetch(`/api/credentials/${credential.id}/test`, { method: "POST" });
      const body = await response.json();
      if (!response.ok) {
        setError(body?.error?.message ?? "The test could not run.");
        return;
      }
      setTestResult(body as TestResult);
      startTransition(() => router.refresh());
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!credential) return;
    setBusy(true);
    try {
      await fetch(`/api/credentials/${credential.id}`, { method: "DELETE" });
      setTestResult(null);
      startTransition(() => router.refresh());
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col">
      <ProgressBar active={busy || pending} />

      <div className="flex items-start gap-2 px-3 pb-2 pt-2.5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h3 className="truncate text-base font-medium text-fg">{provider.name}</h3>
            {!provider.verified ? (
              <span
                title="This adapter was written from the provider's documentation but has not been run against a live account from this codebase."
                className="cursor-help"
              >
                <Badge tone="warn">unverified</Badge>
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 text-sm text-fg-muted">{provider.summary}</p>
        </div>
        {status ? (
          <span className="flex shrink-0 items-center gap-1.5 pt-0.5">
            <StatusDot tone={status.tone} />
            <span className="text-xs text-fg-muted">{status.label}</span>
          </span>
        ) : null}
      </div>

      {credential ? (
        <div className="border-t border-border px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <span className="mono text-xs text-fg-subtle">{credential.maskedHint}</span>
            <span className="text-xs text-fg-subtle">
              {credential.lastVerifiedAt
                ? `Verified ${new Date(credential.lastVerifiedAt).toLocaleDateString()}`
                : "Never tested"}
            </span>
          </div>
          {credential.lastError && !testResult ? (
            <p className="mt-1.5 text-sm text-danger">{credential.lastError}</p>
          ) : null}
        </div>
      ) : null}

      {testResult ? (
        <div
          className={cx(
            "border-t border-border px-3 py-2 text-sm",
            testResult.ok ? "text-ok" : "text-danger",
          )}
        >
          <p>{testResult.message}</p>
          {testResult.latencyMs !== undefined ? (
            <p className="mt-0.5 text-xs text-fg-subtle tabular">{testResult.latencyMs} ms</p>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <div className="px-3 py-2">
          <InlineError>{error}</InlineError>
        </div>
      ) : null}

      {expanded ? (
        <form
          action={submit}
          className="flex flex-col gap-3 border-t border-border px-3 py-3"
          key={provider.id}
        >
          {provider.secretField ? (
            <Field label={provider.secretField.label} help={provider.secretField.help} required>
              <Input
                name="__secret"
                type="password"
                autoComplete="off"
                placeholder={provider.secretField.placeholder}
                required
              />
            </Field>
          ) : null}

          {provider.configFields.map((field) => {
            const current = credential?.config?.[field.name];
            const defaultValue = (current ?? field.default ?? "") as string | number;

            if (field.type === "boolean") {
              return (
                <Checkbox
                  key={field.name}
                  name={field.name}
                  label={field.label}
                  defaultChecked={Boolean(current ?? field.default)}
                />
              );
            }
            if (field.type === "select") {
              return (
                <Field key={field.name} label={field.label} help={field.help} required={field.required}>
                  <Select name={field.name} defaultValue={String(defaultValue)}>
                    {field.options?.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                </Field>
              );
            }
            return (
              <Field key={field.name} label={field.label} help={field.help} required={field.required}>
                <Input
                  name={field.name}
                  type={field.type === "number" ? "number" : field.type === "email" ? "email" : "text"}
                  placeholder={field.placeholder}
                  defaultValue={String(defaultValue)}
                  required={field.required}
                />
              </Field>
            );
          })}

          <div className="flex items-center gap-2 pt-0.5">
            <Button type="submit" variant="primary" size="sm" disabled={busy}>
              {credential ? "Replace key" : "Connect"}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={onToggle}>
              Cancel
            </Button>
            <a
              href={provider.docsUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="motion-ok ml-auto text-xs text-fg-subtle hover:text-fg-muted"
            >
              Where to find this
            </a>
          </div>
        </form>
      ) : (
        <div className="mt-auto flex items-center gap-2 border-t border-border px-3 py-2">
          {credential ? (
            <>
              <Button size="sm" onClick={test} disabled={busy}>
                Test connection
              </Button>
              {canManage ? (
                <>
                  <Button size="sm" variant="ghost" onClick={onToggle}>
                    Edit
                  </Button>
                  <Button size="sm" variant="danger" className="ml-auto" onClick={disconnect} disabled={busy}>
                    Disconnect
                  </Button>
                </>
              ) : null}
            </>
          ) : (
            <Button size="sm" variant="primary" onClick={onToggle} disabled={!canManage}>
              Connect
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}
