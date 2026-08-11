"use client";

import { useActionState, useState } from "react";
import { Field, Input, Select } from "@/components/ui";
import { createCampaignAction } from "../actions";
import { IDLE } from "@/lib/action-state";
import type { ActionState } from "@/lib/action-state";
import { ActionResult, SubmitButton } from "@/components/ui-client";

interface Props {
  icps: { id: string; name: string }[];
  sequences: { id: string; name: string; stepCount: number }[];
  mailboxes: { id: string; email: string; currentDailyCap: number; status: string }[];
  autoSendUnlocked: boolean;
  gateRequired: number;
  gateApproved: number;
}

export function CampaignForm({
  icps,
  sequences,
  mailboxes,
  autoSendUnlocked,
  gateRequired,
  gateApproved,
}: Props) {
  const [state, formAction] = useActionState<ActionState, FormData>(createCampaignAction, IDLE);
  const [selectedIcp, setSelectedIcp] = useState(icps[0]?.id ?? "");
  const [selectedSequence, setSelectedSequence] = useState(sequences[0]?.id ?? "");

  return (
    <form action={formAction} className="flex flex-col gap-6">
      {state.error ? (
        <div className="rounded border border-danger/30 bg-danger-muted p-3 text-xs text-danger">
          {state.error}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label="Campaign Name" required help="Descriptive name for internal tracking">
          <Input name="name" placeholder="e.g. Q3 Fintech VP Operations Outreach" required />
        </Field>

        <Field label="Target ICP" required help="The target audience profile and value hypothesis">
          <Select
            name="icpId"
            value={selectedIcp}
            onChange={(e) => setSelectedIcp(e.target.value)}
            required
          >
            <option value="" disabled>
              Select an ICP...
            </option>
            {icps.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label="Sequence Workflow" required help="Step cadence for email touchpoints and voice calls">
          <Select
            name="sequenceId"
            value={selectedSequence}
            onChange={(e) => setSelectedSequence(e.target.value)}
            required
          >
            <option value="" disabled>
              Select a sequence...
            </option>
            {sequences.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.stepCount} steps)
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Sending Strategy" help="Channel priority order">
          <label className="mt-1 flex items-center gap-2 text-xs text-fg">
            <input type="checkbox" name="callFirst" value="true" className="rounded border-border-strong" />
            <span>Call-first campaign (dial prospect prior to first email send)</span>
          </label>
        </Field>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium text-fg-muted">Sending Mailboxes</span>
        {mailboxes.length === 0 ? (
          <div className="rounded border border-border bg-surface-muted p-3 text-xs text-fg-subtle">
            No mailboxes connected yet. You can save this campaign draft and attach mailboxes in Deliverability → Mailboxes.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {mailboxes.map((mb) => (
              <label key={mb.id} className="flex items-center gap-2 rounded border border-border p-2.5 hover:bg-surface-hover">
                <input type="checkbox" name="mailboxIds" value={mb.id} defaultChecked className="rounded border-border-strong" />
                <div className="flex flex-col">
                  <span className="text-xs font-medium text-fg">{mb.email}</span>
                  <span className="text-2xs text-fg-subtle">Cap: {mb.currentDailyCap}/day</span>
                </div>
              </label>
            ))}
          </div>
        )}
      </div>

      <div className="rounded border border-border bg-surface p-4">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="text-xs font-semibold text-fg">Auto-Send Mode</h4>
            <p className="text-2xs text-fg-subtle">
              When enabled, messages send automatically once generated. When off, drafts enter the Human Approval Queue.
            </p>
          </div>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              name="autoSendEnabled"
              value="true"
              disabled={!autoSendUnlocked}
              className="rounded border-border-strong disabled:opacity-50"
            />
            <span className={autoSendUnlocked ? "font-medium text-fg" : "text-fg-subtle"}>
              Enable Auto-Send
            </span>
          </label>
        </div>
        {!autoSendUnlocked ? (
          <div className="mt-2 text-2xs text-warn">
            Approval Gate Locked: {gateApproved} / {gateRequired} drafts manually approved. You must approve {gateRequired - gateApproved} more drafts before auto-send can be unlocked.
          </div>
        ) : null}
      </div>

      <div className="flex items-center gap-2">
        <SubmitButton pendingLabel="Creating...">Save Campaign</SubmitButton>
        <ActionResult tone="ok">{state.ok ? "Saved." : null}</ActionResult>
      </div>
    </form>
  );
}
