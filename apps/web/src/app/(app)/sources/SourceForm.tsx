"use client";

import { useActionState } from "react";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";
import { saveDataSourceAction } from "./actions";

export function SourceForm() {
  const [state, formAction, pending] = useActionState(saveDataSourceAction, { ok: true });

  return (
    <form action={formAction} className="flex flex-col gap-3">
      {state && !state.ok && state.error ? (
        <div className="rounded border border-danger/30 bg-danger-muted p-2 text-2xs text-danger">
          {state.error}
        </div>
      ) : null}

      <Field label="Source Name" required>
        <Input name="name" placeholder="Apollo" required />
      </Field>

      <Field label="Type" required>
        <Select name="kind" defaultValue="lead_source">
          <option value="lead_source">Lead source</option>
          <option value="enrichment">Enrichment</option>
          <option value="verification">Verification</option>
          <option value="search">Search</option>
          <option value="crm">CRM</option>
        </Select>
      </Field>

      <Field label="Status" required>
        <Select name="status" defaultValue="active">
          <option value="active">Active</option>
          <option value="paused">Paused</option>
          <option value="disabled">Disabled</option>
        </Select>
      </Field>

      <Field label="Priority Weight" help="Higher weight wins in the ranking heuristic.">
        <Input name="weight" type="number" min={0} max={100} defaultValue={50} />
      </Field>

      <Field label="Notes">
        <Textarea name="notes" placeholder="Used for SaaS ops roles in North America." rows={3} />
      </Field>

      <Button type="submit" variant="primary" disabled={pending}>
        {pending ? "Saving..." : "Add source"}
      </Button>
    </form>
  );
}
