"use client";

import { useActionState } from "react";
import { Card, Field, InlineError, Input, Notice, SectionHeading, Select } from "@/components/ui";
import { SubmitButton } from "@/components/ui-client";
import { IDLE } from "@/lib/action-state";
import { startDiscoveryRun } from "../actions";

export function NewRunForm({
  icps,
  campaigns,
  defaultIcpId,
}: {
  icps: { id: string; name: string }[];
  campaigns: { id: string; name: string }[];
  defaultIcpId?: string;
}) {
  const [state, formAction] = useActionState(startDiscoveryRun, IDLE);

  return (
    <form action={formAction} className="flex max-w-2xl flex-col gap-4 p-6">
      <InlineError>{state.error}</InlineError>

      <Card>
        <SectionHeading title="Run settings" />
        <div className="grid gap-3 px-4 py-3">
          <Field label="ICP" required help="The profile the strategist plans its sources from.">
            <Select name="icpId" defaultValue={defaultIcpId ?? icps[0]?.id} required>
              {icps.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Maximum prospects"
            required
            help="A ceiling, not a target. The run stops here even if more matches exist."
          >
            <Input name="targetCount" type="number" min={1} max={500} defaultValue={50} required />
          </Field>

          <Field
            label="Campaign"
            help="Optional. Assigning now saves a step later; nothing is sent either way."
          >
            <Select name="campaignId" defaultValue="">
              <option value="">Leave unassigned</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Card>

      <Notice>
        Discovery only finds and stores people. It does not enrich, message, or dial anyone — every
        prospect it creates lands unqualified and unscheduled, and nothing leaves this workspace
        until a campaign is activated and its drafts are approved.
      </Notice>

      <div>
        <SubmitButton pendingLabel="Queueing…">Start run</SubmitButton>
      </div>
    </form>
  );
}
