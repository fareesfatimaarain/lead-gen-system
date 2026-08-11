"use client";

import { useActionState } from "react";
import { Field, Input, InlineError } from "@/components/ui";
import { ActionResult, SubmitButton } from "@/components/ui-client";
import { IDLE } from "@/lib/action-state";
import { importCsvAction } from "./csv-actions";

export function CsvImportForm() {
  const [state, formAction] = useActionState(importCsvAction, IDLE);
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <InlineError>{state.error}</InlineError>
      <Field
        label="CSV file"
        required
        help="Needs at least a name and an email column — most common header spellings are recognized automatically."
      >
        <Input name="file" type="file" accept=".csv,text/csv" required />
      </Field>
      <div>
        <SubmitButton pendingLabel="Importing…">Import</SubmitButton>
      </div>
      {!state.error && state.message ? <ActionResult tone={state.ok ? "ok" : "danger"}>{state.message}</ActionResult> : null}
    </form>
  );
}
