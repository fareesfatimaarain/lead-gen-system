"use client";

import { useActionState } from "react";
import { Input, Select } from "@/components/ui";
import { ActionResult, ConfirmSubmit, SubmitButton } from "@/components/ui-client";
import { IDLE } from "@/lib/action-state";
import { deleteDataSourceAction, saveDataSourceAction, setDataSourceStatusAction } from "./actions";

/**
 * The interactive row controls for one data source.
 *
 * `setDataSourceStatusAction`, `saveDataSourceAction` and `deleteDataSourceAction`
 * all take React's `(prevState, formData)` shape so they can report a real error
 * back through `useActionState` — that means they cannot be bound directly to a
 * plain `<form action={fn}>` (which only ever calls a function with `formData`).
 * These three small client components are the only place that binds them, so
 * the row they control stays server-rendered everywhere else.
 */

export function StatusForm({ id, status, canManage }: { id: string; status: string; canManage: boolean }) {
  const [state, formAction] = useActionState(setDataSourceStatusAction, IDLE);
  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <Select
        name="status"
        defaultValue={status}
        disabled={!canManage}
        aria-label="Source status"
        className="h-6 text-xs"
      >
        <option value="active">Active</option>
        <option value="paused">Paused</option>
        <option value="disabled">Disabled</option>
      </Select>
      {canManage ? (
        <SubmitButton size="sm" pendingLabel="Saving…">
          Save
        </SubmitButton>
      ) : null}
      {state.error ? <ActionResult tone="danger">{state.error}</ActionResult> : null}
    </form>
  );
}

export function WeightForm({
  id,
  name,
  kind,
  status,
  weight,
}: {
  id: string;
  name: string;
  kind: string;
  status: string;
  weight: number;
}) {
  const [state, formAction] = useActionState(saveDataSourceAction, IDLE);
  return (
    <form action={formAction} className="flex items-end gap-2">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="name" value={name} />
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="status" value={status} />
      <label className="flex flex-1 flex-col gap-1">
        <span className="text-2xs text-fg-subtle">Weight</span>
        <Input name="weight" type="number" min={0} max={100} defaultValue={weight} className="h-6 text-xs" />
      </label>
      <SubmitButton size="sm" pendingLabel="Saving…">
        Save
      </SubmitButton>
      {state.error ? <ActionResult tone="danger">{state.error}</ActionResult> : null}
    </form>
  );
}

export function RemoveSourceButton({ id }: { id: string }) {
  const [state, formAction] = useActionState(deleteDataSourceAction, IDLE);
  return (
    <form action={formAction} className="flex flex-col items-end gap-1">
      <input type="hidden" name="id" value={id} />
      <ConfirmSubmit confirmLabel="Confirm remove">Remove</ConfirmSubmit>
      {state.error ? <ActionResult tone="danger">{state.error}</ActionResult> : null}
    </form>
  );
}
