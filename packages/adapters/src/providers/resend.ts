import { providerError } from "@outreach/shared";
import type { TestResult } from "@outreach/shared";
import type { AdapterCtx, EmailSender, OutboundEmail, SendReceipt } from "../types";

/**
 * Resend email sender.
 *
 * Implemented against Resend's documented REST API rather than their SDK, so the
 * dependency footprint stays at zero and the wire shape is visible here.
 *
 * TODO(verify): both endpoints below are written from Resend's public API docs
 * but have not been exercised against a live account in this repo. Run the
 * Connections page test once a key exists and correct anything that differs
 * before Phase 4 sends to a real prospect.
 */

const RESEND_BASE = "https://api.resend.com";

interface ResendConfig {
  fromEmail: string;
  fromName?: string;
}

function readConfig(ctx: AdapterCtx): ResendConfig {
  const c = ctx.config as Record<string, unknown>;
  const fromEmail = typeof c.fromEmail === "string" ? c.fromEmail.trim() : "";
  if (!fromEmail) {
    throw providerError("resend", "A From address is not set. Add it on the Connections page.");
  }
  return { fromEmail, fromName: typeof c.fromName === "string" ? c.fromName : undefined };
}

async function resendFetch(
  path: string,
  ctx: AdapterCtx,
  init: RequestInit = {},
): Promise<{ status: number; body: unknown; text: string }> {
  const response = await fetch(`${RESEND_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${ctx.secret}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    signal: ctx.signal ?? null,
  });
  const text = await response.text();
  let body: unknown = {};
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text };
    }
  }
  return { status: response.status, body, text };
}

export const resendProvider: EmailSender = {
  id: "resend",
  category: "email_send",

  /**
   * `GET /domains` — read-only, free, sends nothing.
   *
   * It also answers the question that actually matters at setup time: is the
   * sending domain verified? An authenticated key with an unverified domain will
   * accept the credential here and then fail on the first real send, so the
   * check reports domain status rather than just auth.
   */
  async testConnection(ctx: AdapterCtx): Promise<TestResult> {
    const startedAt = Date.now();
    try {
      const { status, body, text } = await resendFetch("/domains", ctx);
      const latencyMs = Date.now() - startedAt;

      if (status === 401 || status === 403) {
        return { ok: false, message: "Resend rejected this API key. Check it at resend.com/api-keys.", latencyMs };
      }
      if (status >= 400) {
        return { ok: false, message: `Resend returned ${status}: ${text.slice(0, 200)}`, latencyMs };
      }

      const payload = body as { data?: { name?: string; status?: string }[] };
      const domains = payload.data ?? [];
      const verified = domains.filter((d) => d.status === "verified");

      if (domains.length === 0) {
        return {
          ok: false,
          message: "The key works, but this Resend account has no sending domain. Add and verify one first.",
          latencyMs,
        };
      }
      if (verified.length === 0) {
        return {
          ok: false,
          message: `The key works, but no domain is verified yet (${domains.map((d) => d.name).join(", ")}). Finish DNS verification in Resend.`,
          detail: { domains },
          latencyMs,
        };
      }

      return {
        ok: true,
        message: `Connected. ${verified.length} verified domain${verified.length === 1 ? "" : "s"}: ${verified.map((d) => d.name).join(", ")}.`,
        detail: { verified: verified.map((d) => d.name) },
        latencyMs,
      };
    } catch {
      return {
        ok: false,
        message: "Could not reach api.resend.com. Check this server's outbound network access.",
        latencyMs: Date.now() - startedAt,
      };
    }
  },

  async send(email: OutboundEmail, ctx: AdapterCtx): Promise<SendReceipt> {
    readConfig(ctx);

    const { status, body, text } = await resendFetch("/emails", ctx, {
      method: "POST",
      body: JSON.stringify({
        from: email.from.name ? `${email.from.name} <${email.from.email}>` : email.from.email,
        to: [email.to.email],
        subject: email.subject,
        text: email.text,
        ...(email.html ? { html: email.html } : {}),
        ...(email.replyTo ? { reply_to: email.replyTo } : {}),
        ...(email.headers ? { headers: email.headers } : {}),
      }),
    });

    if (status >= 400) {
      throw providerError("resend", `Resend refused the message (${status}): ${text.slice(0, 300)}`);
    }

    const sent = body as { id?: string };
    if (!sent.id) {
      throw providerError("resend", "Resend accepted the message but returned no id, so it cannot be tracked.");
    }

    return { providerMessageId: sent.id, acceptedAt: new Date() };
  },
};
