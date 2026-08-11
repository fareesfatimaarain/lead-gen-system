import { Card, Notice, PageHeader, Stat, StatRow } from "@/components/ui";
import { getSpendSummary } from "@/lib/data";
import { formatUsd } from "@/lib/format";
import { requirePageSession } from "@/lib/session";

export default async function SpendPage() {
  const session = await requirePageSession();
  const summary = await getSpendSummary(session);

  const capUsd = summary.capUsd;
  const percentage =
    capUsd !== null && capUsd > 0
      ? Math.min(100, Math.round((summary.totalUsd / capUsd) * 100))
      : null;

  return (
    <>
      <PageHeader
        title="Spend & Cost Caps"
        description="Monitor provider usage and hard monthly spend limits to guarantee zero budget overruns."
      />

      <div className="flex flex-col gap-6 p-4">
        <StatRow>
          <Stat label="Spend This Month" value={formatUsd(summary.totalUsd)} tone="accent" />
          <Stat
            label="Agent Runs"
            value={formatUsd(summary.agentCostUsd)}
            hint="LLM calls across agents"
          />
          <Stat
            label="Monthly Hard Limit"
            value={capUsd !== null ? formatUsd(capUsd) : "Not set"}
            hint={capUsd !== null && summary.hardCutoff ? "Hard cutoff — sends stop at this cap" : undefined}
          />
          <Stat
            label="Cap Utilization"
            value={percentage !== null ? `${percentage}%` : "—"}
            tone={percentage !== null && percentage > 80 ? "warn" : "ok"}
          />
        </StatRow>

        {capUsd === null ? (
          <Notice tone="warn">
            No monthly spend cap is configured. Acceptable while nothing is sending — but set one in
            Settings before a campaign goes live, because the cap is the thing that stops the system.
          </Notice>
        ) : null}

        {capUsd !== null && percentage !== null ? (
          <Card className="p-4 flex flex-col gap-3">
            <div className="flex justify-between text-xs">
              <span className="font-semibold text-fg">Budget Consumption</span>
              <span className="font-mono text-fg-subtle">
                {formatUsd(summary.totalUsd)} / {formatUsd(capUsd)}
              </span>
            </div>
            <div className="h-2 w-full rounded-full bg-surface-muted overflow-hidden border border-border">
              <div
                className={`h-full ${
                  percentage > 90 ? "bg-danger" : percentage > 75 ? "bg-warn" : "bg-accent"
                }`}
                style={{ width: `${percentage}%` }}
              />
            </div>
          </Card>
        ) : null}

        <Card className="p-4 flex flex-col gap-3">
          <h3 className="text-xs font-semibold text-fg">Spend by Provider</h3>
          {summary.byProvider.length === 0 ? (
            <p className="text-sm text-fg-muted">
              No provider usage recorded this month. Usage appears here only when an agent or
              adapter runs — no estimates, no projected numbers.
            </p>
          ) : (
            <div className="flex flex-col gap-2 text-xs">
              {summary.byProvider.map((row) => (
                <div key={row.provider} className="flex justify-between border-b border-border pb-1">
                  <span className="text-fg-subtle">{row.provider}</span>
                  <span className="font-mono text-fg">
                    {formatUsd(row.costUsd)} · {row.units} calls
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
