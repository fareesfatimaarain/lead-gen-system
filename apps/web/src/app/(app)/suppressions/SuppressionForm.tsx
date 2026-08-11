"use client";

import { useActionState } from "react";
import { Button, Field, Input, Select } from "@/components/ui";
import { addSuppressionAction } from "./actions";

export function SuppressionForm() {
  const [state, formAction, pending] = useActionState(addSuppressionAction, { ok: true });

  return (
    <form action={formAction} className="flex flex-col gap-3">
      {state && !state.ok && state.error ? (
        <div className="rounded border border-danger/30 bg-danger-muted p-2 text-2xs text-danger">
          {state.error}
        </div>
      ) : null}

      <Field label="Target Type">
        <Select name="kind" defaultValue="email">
          <option value="email">Email Address</option>
          <option value="domain">Domain Name (@company.com)</option>
          <option value="phone">Phone Number (E.164)</option>
        </Select>
      </Field>

      <Field label="Value" required>
        <Input name="value" placeholder="prospect@competitor.com or competitor.com" required />
      </Field>

      <Field label="Reason">
        <Input name="reason" placeholder="Existing customer / competitor domain" />
      </Field>

      <Button type="submit" variant="primary" disabled={pending}>
        {pending ? "Adding..." : "Add to Suppression List"}
      </Button>
    </form>
  );
}
