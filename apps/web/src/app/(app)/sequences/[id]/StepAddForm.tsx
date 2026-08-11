"use client";

import { useState, useTransition } from "react";
import { Button, Field, Input, Select } from "@/components/ui";
import { addSequenceStepAction } from "../actions";

export function StepAddForm({ sequenceId }: { sequenceId: string }) {
  const [type, setType] = useState<"email" | "call" | "wait">("email");
  const [delayHours, setDelayHours] = useState(48);
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      await addSequenceStepAction(sequenceId, type, delayHours);
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-end gap-3">
      <Field label="Step Type">
        <Select
          value={type}
          onChange={(e) => setType(e.target.value as "email" | "call" | "wait")}
        >
          <option value="email">Email Touchpoint</option>
          <option value="call">AI Voice Call</option>
          <option value="wait">Wait Delay Only</option>
        </Select>
      </Field>

      <Field label="Delay (Hours)" help="Time to wait after previous step">
        <Input
          type="number"
          min={0}
          value={delayHours}
          onChange={(e) => setDelayHours(Number(e.target.value))}
        />
      </Field>

      <Button type="submit" variant="primary" disabled={pending}>
        {pending ? "Adding..." : "Add Step"}
      </Button>
    </form>
  );
}
