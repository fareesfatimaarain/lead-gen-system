"use client";

import { useActionState } from "react";
import { ActionResult, SubmitButton } from "@/components/ui-client";
import { IDLE } from "@/lib/action-state";
import { addRegistrySourceAction } from "./registry-actions";

export function AddSourceButton({ provider, credentialId }: { provider: string; credentialId?: string }) {
  const [state, formAction] = useActionState(addRegistrySourceAction, IDLE);
  return (
    <form action={formAction} className="flex flex-col items-start gap-1">
      <input type="hidden" name="provider" value={provider} />
      {credentialId ? <input type="hidden" name="credentialId" value={credentialId} /> : null}
      <SubmitButton variant="primary" size="sm" pendingLabel="Adding…">
        Add to sources
      </SubmitButton>
      {state.error ? <ActionResult tone="danger">{state.error}</ActionResult> : null}
    </form>
  );
}
