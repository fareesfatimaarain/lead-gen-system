import type { TestResult } from "@outreach/shared";
/**
 * Agent IO schemas are authored with `zod/v4` because that is what the Anthropic
 * SDK's `zodOutputFormat` accepts. Everything else in the codebase — HTTP input,
 * provider config — stays on the classic `zod` import. Zod 3.25 ships both, so
 * this is one package boundary, not a migration.
 */
import type * as z from "zod/v4";

/**
 * Adapter contracts.
 *
 * One interface per provider category. No provider SDK is imported outside
 * `packages/adapters` — business logic depends on these shapes, never on
 * Anthropic's or Vapi's. Swapping a provider is then an adapter file, not a
 * refactor.
 */

export type ProviderCategory =
  | "email_send"
  | "email_receive"
  | "voice"
  | "lead_source"
  | "enrichment"
  | "verification"
  | "search"
  | "crm"
  | "llm"
  | "scheduling";

/** The decrypted credential plus non-secret config, assembled per call. */
export interface AdapterCtx {
  orgId: string;
  /** Decrypted at call time in the worker. Never logged, never returned. */
  secret: string;
  config: Record<string, unknown>;
  /** Aborts a slow provider so a job cannot hang a worker slot. */
  signal?: AbortSignal;
}

export interface ProviderAdapter {
  readonly id: string;
  readonly category: ProviderCategory;
  /**
   * A real, cheap call against the provider. Not a ping, not a token-format
   * check — something that proves the credential actually works, whose result
   * is rendered verbatim on the Connections page.
   */
  testConnection(ctx: AdapterCtx): Promise<TestResult>;
}

// ---------------------------------------------------------------------------
// LLM
// ---------------------------------------------------------------------------

export interface LlmMessage {
  role: "user" | "assistant";
  content: string;
}

export interface LlmRequest<T> {
  system?: string;
  messages: LlmMessage[];
  /** Model id resolved from org settings, not hardcoded at the call site. */
  model: string;
  maxTokens: number;
  /** Every agent returns structured JSON validated against this. */
  schema: z.ZodType<T>;
  schemaName: string;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
}

export interface LlmResponse<T> {
  data: T;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
  /** True when the first attempt failed schema validation and a repair ran. */
  repaired: boolean;
}

export interface LlmProvider extends ProviderAdapter {
  readonly category: "llm";
  complete<T>(req: LlmRequest<T>, ctx: AdapterCtx): Promise<LlmResponse<T>>;
}

// ---------------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------------

export interface OutboundEmail {
  from: { email: string; name?: string };
  to: { email: string; name?: string };
  subject: string;
  /** Plain text is the only required body. First touches are text-only by policy. */
  text: string;
  html?: string;
  replyTo?: string;
  headers?: Record<string, string>;
  inReplyTo?: string;
  references?: string[];
}

export interface SendReceipt {
  providerMessageId: string;
  messageId?: string;
  acceptedAt: Date;
}

export interface EmailSender extends ProviderAdapter {
  readonly category: "email_send";
  send(email: OutboundEmail, ctx: AdapterCtx): Promise<SendReceipt>;
}

export interface InboundEmail {
  providerMessageId: string;
  messageId?: string;
  inReplyTo?: string;
  threadId?: string;
  from: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
  receivedAt: Date;
  headers: Record<string, string>;
}

export interface EmailReceiver extends ProviderAdapter {
  readonly category: "email_receive";
  poll(since: Date, ctx: AdapterCtx): Promise<InboundEmail[]>;
}

// ---------------------------------------------------------------------------
// Voice
// ---------------------------------------------------------------------------

export interface CallRequest {
  assistantId: string;
  phoneNumberId: string;
  customer: { number: string; name?: string };
  /**
   * Per-prospect assistant overrides. Deep-merged by the provider onto the base
   * assistant, so voice, transcriber and tools survive. This is the hook that
   * makes each call open with something true and specific about this prospect.
   */
  overrides?: Record<string, unknown>;
}

export interface CallHandle {
  providerCallId: string;
  status: string;
}

export interface CallState {
  providerCallId: string;
  status: string;
  endedReason?: string;
  transcript?: { role: string; text: string }[];
  transcriptText?: string;
  summary?: string;
  recordingUrl?: string;
  startedAt?: Date;
  endedAt?: Date;
  costUsd?: number;
  raw: Record<string, unknown>;
}

export interface VoiceProvider extends ProviderAdapter {
  readonly category: "voice";
  place(req: CallRequest, ctx: AdapterCtx): Promise<CallHandle>;
  get(providerCallId: string, ctx: AdapterCtx): Promise<CallState>;
  /** Verifies a webhook came from the provider. Phase 5 will not ship without this. */
  verifyWebhook(rawBody: string, headers: Record<string, string>, ctx: AdapterCtx): boolean;
}

// ---------------------------------------------------------------------------
// Lead sources, enrichment, verification (Phases 2-3; shapes fixed now)
// ---------------------------------------------------------------------------

export interface SourceQuery {
  query: string;
  filters?: Record<string, unknown>;
  limit?: number;
}

export interface RawLead {
  fullName?: string;
  firstName?: string;
  lastName?: string;
  title?: string;
  email?: string;
  phone?: string;
  linkedinUrl?: string;
  companyName?: string;
  companyDomain?: string;
  country?: string;
  city?: string;
  /** Where this record came from. Carried into `prospects.source_url`. */
  sourceUrl?: string;
  raw: Record<string, unknown>;
}

export interface CostEstimate {
  costUsd: number;
  unit: string;
}

export interface LeadSource extends ProviderAdapter {
  readonly category: "lead_source";
  search(query: SourceQuery, ctx: AdapterCtx): Promise<RawLead[]>;
  estimateCost(query: SourceQuery): CostEstimate;
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

export interface EmailVerificationResult {
  email: string;
  /** Matches `VERIFICATION_RESULTS` in `@outreach/shared`. Only "valid" may send. */
  result: "valid" | "invalid" | "catch_all" | "risky" | "unknown";
  score?: number;
  reason?: string;
  raw: Record<string, unknown>;
}

export interface EmailVerifier extends ProviderAdapter {
  readonly category: "verification";
  verify(email: string, ctx: AdapterCtx): Promise<EmailVerificationResult>;
}
