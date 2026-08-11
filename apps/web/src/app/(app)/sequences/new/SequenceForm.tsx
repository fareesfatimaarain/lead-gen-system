"use client";

import { useActionState } from "react";
import { Button, Field, Input } from "@/components/ui";
import { createSequenceAction } from "../actions";

export function SequenceForm() {
  const [state, formAction, pending] = useActionState(createSequenceAction, { ok: true });

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {state && !state.ok && state.error ? (
        <div className="rounded border border-danger/30 bg-danger-muted p-2 text-xs text-danger">
          {state.error}
        </div>
      ) : null}

      <Field label="Sequence Name" required help="e.g. Standard 4-Touch Multichannel Sequence">
        <Input name="name" placeholder="e.g. Enterprise 3-Touch Email + Voice" required />
      </Field>

      <div className="flex justify-end gap-2 pt-2">
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Creating..." : "Create Sequence & Add Steps"}
        </Button>
      </div>
    </form>
  );
}
