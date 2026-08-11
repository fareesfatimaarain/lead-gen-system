"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button, Field, InlineError, Input } from "@/components/ui";
import { signUpAction, type AuthFormState } from "../actions";

export default function SignUpPage() {
  const [state, action, pending] = useActionState<AuthFormState, FormData>(signUpAction, {});

  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight text-fg">Create a workspace</h1>
      <p className="mt-1 text-sm text-fg-muted">You will be its owner.</p>

      <form action={action} className="mt-6 flex flex-col gap-3">
        {state.error ? <InlineError>{state.error}</InlineError> : null}

        <Field label="Workspace name">
          <Input name="orgName" required autoFocus placeholder="Acme Consulting" />
        </Field>
        <Field label="Your name">
          <Input name="name" autoComplete="name" required />
        </Field>
        <Field label="Email">
          <Input name="email" type="email" autoComplete="email" required />
        </Field>
        <Field label="Password" help="At least 12 characters.">
          <Input name="password" type="password" autoComplete="new-password" required minLength={12} />
        </Field>

        <Button type="submit" variant="primary" disabled={pending} className="mt-1 w-full">
          {pending ? "Creating…" : "Create workspace"}
        </Button>
      </form>

      <p className="mt-4 text-sm text-fg-muted">
        Already have one?{" "}
        <Link href="/sign-in" className="text-accent hover:underline">
          Sign in
        </Link>
      </p>
    </>
  );
}
