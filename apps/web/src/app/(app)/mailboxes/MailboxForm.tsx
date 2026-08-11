"use client";

import { useActionState } from "react";
import { Button, Field, Input } from "@/components/ui";
import { createMailboxAction } from "./actions";

export function MailboxForm() {
  const [state, formAction, pending] = useActionState(createMailboxAction, { ok: true });

  return (
    <form action={formAction} className="flex flex-col gap-3">
      {state && !state.ok && state.error ? (
        <div className="rounded border border-danger/30 bg-danger-muted p-2 text-2xs text-danger">
          {state.error}
        </div>
      ) : null}

      <Field label="Mailbox Email" required>
        <Input name="email" type="email" placeholder="alex@company.com" required />
      </Field>

      <Field label="Initial Daily Cap" help="Ramps over 4 weeks (default 40)">
        <Input name="initialDailyCap" type="number" defaultValue={40} min={5} max={500} />
      </Field>

      <Button type="submit" variant="primary" disabled={pending}>
        {pending ? "Adding..." : "Connect Mailbox"}
      </Button>
    </form>
  );
}
