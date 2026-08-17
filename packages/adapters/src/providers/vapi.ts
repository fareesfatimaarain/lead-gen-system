import { createHmac, timingSafeEqual } from "node:crypto";
import { providerError } from "@outreach/shared";
import type { TestResult } from "@outreach/shared";
import type { AdapterCtx, CallHandle, CallRequest, CallState, VoiceProvider } from "../types";

/**
 * Vapi voice adapter.
 *
 * Ported from the legacy MVP's `services/vapiCall.js` and `services/callOutcome.js`.
 * The request shapes and the artifact-extraction fallbacks below were exercised
 * against the live API in production — that is knowledge worth more than the
 * docs, because the docs do not record which fields actually vary in practice.
 */

const VAPI_BASE = "https://api.vapi.ai";

/**
 * `endedReason` -> disposition.
 *
 * Built by observing real calls, not from a spec. Do not "clean this up" against
 * the documentation; the redundant-looking entries are reasons that were
 * actually returned.
 */
const NO_ANSWER_REASONS = [
  "customer-did-not-answer",
  "customer-busy",
  "no-answer",
  "customer-not-answered",
  "twilio-failed",
  "failed-to-connect",
  "customer-hung-up-immediately",
];
const VOICEMAIL_REASONS = ["voicemail", "voicemail-detected"];

export type Disposition =
  | "answered"
  | "no_answer"
  | "voicemail"
  | "failed";

export function classifyDisposition(endedReason: string | null | undefined, transcriptText: string): Disposition {
  const r = String(endedReason ?? "").toLowerCase();
  if (VOICEMAIL_REASONS.some((x) => r.includes(x))) return "voicemail";
  if (NO_ANSWER_REASONS.some((x) => r.includes(x))) return "no_answer";
  if (r.includes("error") || r.includes("providerfault") || r.includes("pipeline") || r.includes("failed")) {
    return "failed";
  }
  // A silence timeout with no transcript means nobody ever spoke.
  if (r.includes("silence-timed-out") && !transcriptText) return "no_answer";
  return "answered";
}

interface VapiArtifactShape {
  artifact?: {
    transcript?: string;
    messages?: { role?: string; speaker?: string; message?: string; content?: string; transcript?: string }[];
    recordingUrl?: string;
    recording?: { url?: string };
  };
  analysis?: { summary?: string; structuredData?: unknown };
  messages?: { role?: string; speaker?: string; message?: string; content?: string; transcript?: string }[];
  transcript?: string;
  summary?: string;
  recordingUrl?: string;
  endedReason?: string;
  startedAt?: string;
  endedAt?: string;
  status?: string;
  cost?: number;
}

/**
 * Normalize a polled call object and an end-of-call webhook message into one
 * shape. The multi-key fallbacks encode observed variance between those two
 * payloads — they are not defensive padding.
 */
export function extractCallState(obj: VapiArtifactShape, providerCallId: string): CallState {
  const artifact = obj.artifact ?? {};
  const analysis = obj.analysis ?? {};
  const messages = obj.messages ?? artifact.messages ?? [];

  const turns = messages
    .map((m) => ({
      role: m.role ?? m.speaker ?? "unknown",
      text: m.message ?? m.content ?? m.transcript ?? "",
    }))
    .filter((t) => t.text.length > 0);

  const transcriptText =
    obj.transcript ??
    artifact.transcript ??
    turns.map((t) => `${t.role}: ${t.text}`).join("\n");

  return {
    providerCallId,
    status: obj.status ?? "unknown",
    endedReason: obj.endedReason,
    transcript: turns.length > 0 ? turns : undefined,
    transcriptText: transcriptText || undefined,
    summary: obj.summary ?? analysis.summary,
    recordingUrl: obj.recordingUrl ?? artifact.recordingUrl ?? artifact.recording?.url,
    startedAt: obj.startedAt ? new Date(obj.startedAt) : undefined,
    endedAt: obj.endedAt ? new Date(obj.endedAt) : undefined,
    costUsd: typeof obj.cost === "number" ? obj.cost : undefined,
    raw: obj as unknown as Record<string, unknown>,
  };
}

async function vapiFetch(
  path: string,
  ctx: AdapterCtx,
  init: RequestInit = {},
): Promise<{ status: number; body: unknown; text: string }> {
  const response = await fetch(`${VAPI_BASE}${path}`, {
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

export const vapiProvider: VoiceProvider = {
  id: "vapi",
  category: "voice",

  /**
   * Lists assistants. Cheap, read-only, and it confirms the key is scoped to a
   * real account rather than merely well-formed.
   *
   * TODO(verify): `?limit=1` is assumed. If Vapi rejects the parameter the call
   * still succeeds and just returns more rows, so this degrades safely — but
   * confirm against the current API reference before Phase 5.
   */
  async testConnection(ctx: AdapterCtx): Promise<TestResult> {
    const startedAt = Date.now();
    try {
      const { status, body, text } = await vapiFetch("/assistant?limit=1", ctx);
      const latencyMs = Date.now() - startedAt;

      if (status === 401 || status === 403) {
        return { ok: false, message: "Vapi rejected this API key. Check it in your Vapi dashboard.", latencyMs };
      }
      if (status >= 400) {
        return { ok: false, message: `Vapi returned ${status}: ${text.slice(0, 200)}`, latencyMs };
      }

      const assistants = Array.isArray(body) ? body : [];
      return {
        ok: true,
        message:
          assistants.length > 0
            ? "Connected. At least one assistant is configured."
            : "Connected, but this account has no assistants yet.",
        detail: { assistantsVisible: assistants.length },
        latencyMs,
      };
    } catch (err) {
      return {
        ok: false,
        message:
          err instanceof Error && err.name === "AbortError"
            ? "Vapi did not respond in time."
            : "Could not reach api.vapi.ai. Check this server's outbound network access.",
        latencyMs: Date.now() - startedAt,
      };
    }
  },

  /** `POST /call`. Shape verified in production by the legacy MVP. */
  async place(req: CallRequest, ctx: AdapterCtx): Promise<CallHandle> {
    // A phone number id is optional on the credential, because in-browser test
    // calls do not use one. Reaching a real phone does, so say which field is
    // missing rather than forwarding an incomplete request and relaying Vapi's
    // less specific rejection.
    if (!req.phoneNumberId?.trim()) {
      throw providerError(
        "vapi",
        "No Vapi phone number ID is configured, so calls can only be placed in the browser. Provision a number in Vapi and add its ID on the Connections page to call real numbers.",
      );
    }

    const { status, body, text } = await vapiFetch("/call", ctx, {
      method: "POST",
      body: JSON.stringify({
        assistantId: req.assistantId,
        phoneNumberId: req.phoneNumberId,
        customer: { number: req.customer.number, name: req.customer.name || undefined },
        ...(req.overrides ? { assistantOverrides: req.overrides } : {}),
      }),
    });

    if (status >= 400) {
      throw providerError("vapi", `Vapi refused the call (${status}): ${text.slice(0, 300)}`);
    }

    const call = body as { id?: string; status?: string };
    if (!call.id) {
      throw providerError("vapi", "Vapi accepted the call but returned no call id.");
    }
    return { providerCallId: call.id, status: call.status ?? "queued" };
  },

  /**
   * `GET /call/:id`. The reconciliation path: the legacy MVP proved that
   * webhooks do get missed, and polling is the only way to notice.
   */
  async get(providerCallId: string, ctx: AdapterCtx): Promise<CallState> {
    const { status, body, text } = await vapiFetch(`/call/${providerCallId}`, ctx);
    if (status >= 400) {
      throw providerError("vapi", `Vapi could not return call ${providerCallId} (${status}): ${text.slice(0, 200)}`);
    }
    return extractCallState(body as VapiArtifactShape, providerCallId);
  },

  /**
   * Webhook authentication.
   *
   * The legacy MVP left both webhook endpoints wide open (audit §8.1) — anyone
   * who learned the tunnel URL could forge a call result or drive bookings.
   * That does not carry forward: an unverified payload is discarded.
   *
   * TODO(verify): Vapi's signing scheme is unconfirmed. The `x-vapi-secret`
   * shared-secret comparison below is the documented server-auth mechanism; if
   * an HMAC scheme is available, prefer it — the branch is already here. Resolve
   * this before Phase 5 places a real call.
   */
  verifyWebhook(rawBody: string, headers: Record<string, string>, ctx: AdapterCtx): boolean {
    const configuredSecret = typeof ctx.config.webhookSecret === "string" ? ctx.config.webhookSecret : "";
    if (!configuredSecret) return false;

    const signature = headers["x-vapi-signature"] ?? headers["X-Vapi-Signature"];
    if (signature) {
      const expected = createHmac("sha256", configuredSecret).update(rawBody, "utf8").digest("hex");
      const a = Buffer.from(expected);
      const b = Buffer.from(signature);
      return a.length === b.length && timingSafeEqual(a, b);
    }

    const shared = headers["x-vapi-secret"] ?? headers["X-Vapi-Secret"];
    if (!shared) return false;
    const a = Buffer.from(configuredSecret);
    const b = Buffer.from(shared);
    return a.length === b.length && timingSafeEqual(a, b);
  },
};
