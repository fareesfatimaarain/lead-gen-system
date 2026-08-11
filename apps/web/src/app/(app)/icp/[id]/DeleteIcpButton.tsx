"use client";

import { useActionState } from "react";
import { ActionResult, ConfirmSubmit } from "@/components/ui-client";
import { IDLE } from "@/lib/action-state";
import { deleteIcp } from "../actions";

export function DeleteIcpButton({ id }: { id: string }) {
  const [state, formAction] = useActionState(deleteIcp, IDLE);
  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <ActionResult tone="danger">{state.error}</ActionResult>
      <ConfirmSubmit confirmLabel="Delete ICP">Delete</ConfirmSubmit>
    </form>
  );
}
