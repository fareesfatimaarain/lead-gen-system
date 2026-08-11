"use client";

import { useActionState } from "react";
import { ActionResult, ConfirmSubmit } from "@/components/ui-client";
import { IDLE } from "@/lib/action-state";
import { cancelDiscoveryRun } from "../actions";

export function CancelRunButton({ id }: { id: string }) {
  const [state, formAction] = useActionState(cancelDiscoveryRun, IDLE);
  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <ActionResult tone="danger">{state.error}</ActionResult>
      <ConfirmSubmit confirmLabel="Confirm cancel">Cancel run</ConfirmSubmit>
    </form>
  );
}
