import { NextResponse } from "next/server";
import { signOut } from "@/lib/session";

export async function POST(request: Request) {
  await signOut();
  return NextResponse.redirect(new URL("/sign-in", request.url), { status: 303 });
}
