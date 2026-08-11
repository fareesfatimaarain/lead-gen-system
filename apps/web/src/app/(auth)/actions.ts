"use server";

import { redirect } from "next/navigation";
import { errorMessage } from "@outreach/shared";
import { signIn, signUp } from "@/lib/session";

export interface AuthFormState {
  error?: string;
}

export async function signInAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  try {
    await signIn(String(formData.get("email") ?? ""), String(formData.get("password") ?? ""));
  } catch (err) {
    return { error: errorMessage(err) };
  }
  // Outside the try: redirect() signals by throwing, so catching it here would
  // turn a successful sign-in into an error message.
  redirect("/");
}

export async function signUpAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  try {
    await signUp({
      email: String(formData.get("email") ?? ""),
      password: String(formData.get("password") ?? ""),
      name: String(formData.get("name") ?? ""),
      orgName: String(formData.get("orgName") ?? ""),
    });
  } catch (err) {
    return { error: errorMessage(err) };
  }
  redirect("/");
}
