"use client";

import { useActionState } from "react";
import { ActionResult, SubmitButton } from "@/components/ui-client";
import { IDLE } from "@/lib/action-state";
import { testDataSourceAction } from "./registry-actions";

export function TestSourceButton({ id }: { id: string }) {
  const [state, formAction] = useActionState(testDataSourceAction, IDLE);
  return (
    <form action={formAction} className="flex flex-col items-start gap-1">
      <input type="hidden" name="id" value={id} />
      <SubmitButton size="sm" pendingLabel="Testing…">
        Test
      </SubmitButton>
      {state.error ? <ActionResult tone="danger">{state.error}</ActionResult> : null}
      {!state.error && state.message ? (
        <ActionResult tone={state.ok ? "ok" : "danger"}>{state.message}</ActionResult>
      ) : null}
    </form>
  );
}
