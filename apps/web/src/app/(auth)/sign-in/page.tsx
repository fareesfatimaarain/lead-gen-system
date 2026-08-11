"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button, Field, InlineError, Input } from "@/components/ui";
import { signInAction, type AuthFormState } from "../actions";

export default function SignInPage() {
  const [state, action, pending] = useActionState<AuthFormState, FormData>(signInAction, {});

  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight text-fg">Sign in</h1>
      <p className="mt-1 text-sm text-fg-muted">Continue to your workspace.</p>

      <form action={action} className="mt-6 flex flex-col gap-3">
        {state.error ? <InlineError>{state.error}</InlineError> : null}

        <Field label="Email">
          <Input name="email" type="email" autoComplete="email" required autoFocus />
        </Field>
        <Field label="Password">
          <Input name="password" type="password" autoComplete="current-password" required />
        </Field>

        <Button type="submit" variant="primary" disabled={pending} className="mt-1 w-full">
          {pending ? "Signing in…" : "Sign in"}
        </Button>
      </form>

      <p className="mt-4 text-sm text-fg-muted">
        No workspace yet?{" "}
        <Link href="/sign-up" className="text-accent hover:underline">
          Create one
        </Link>
      </p>
    </>
  );
}
