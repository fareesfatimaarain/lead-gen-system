"use client";

import { useActionState } from "react";
import { ActionResult, SubmitButton } from "@/components/ui-client";
import { Input } from "@/components/ui";
import { IDLE } from "@/lib/action-state";
import { setPatientValueAction } from "./actions";

/**
 * Inline capture for the one figure the Acquisition screen cannot infer.
 *
 * Rendered where the number is missing rather than behind a link to Settings —
 * a field you have to go looking for is a field that stays unset.
 */
export function PatientValueForm({ current }: { current: number | null }) {
  const [state, formAction] = useActionState(setPatientValueAction, IDLE);

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1">
        <span className="text-2xs font-medium uppercase tracking-wider text-fg-subtle">
          Value of one booked consultation
        </span>
        <Input
          name="patientValueUsd"
          inputMode="decimal"
          defaultValue={current ?? ""}
          placeholder="4775"
          className="w-40"
        />
      </label>
      <SubmitButton>Save</SubmitButton>
      <ActionResult tone={state.error ? "danger" : "ok"}>{state.error ?? state.message}</ActionResult>
    </form>
  );
}
