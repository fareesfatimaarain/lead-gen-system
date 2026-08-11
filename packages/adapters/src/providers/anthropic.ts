import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { providerError } from "@outreach/shared";
import type { TestResult } from "@outreach/shared";
import type { AdapterCtx, LlmProvider, LlmRequest, LlmResponse } from "../types";

/**
 * Anthropic LLM adapter — the default behind the agent runtime.
 *
 * Uses `messages.parse()` with `zodOutputFormat`, which constrains the response
 * to the caller's schema server-side and validates it client-side. That is why
 * no agent in this system ever parses free-form model text.
 */

/**
 * Published list pricing, USD per million tokens. Drives the spend cap and
 * `agent_runs.cost_usd`.
 *
 * TODO(verify): re-check against platform.claude.com/docs/en/pricing each phase.
 * Numbers that are too low here mean a spend cap that cuts off too late.
 */
const PRICING: Record<string, { input: number; output: number }> = {
  "claude-opus-5": { input: 5, output: 25 },
  "claude-sonnet-5": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};

/** Default for reasoning-heavy agents: strategist, research, composer, scoring. */
export const DEFAULT_MODEL = "claude-opus-5";
/** For high-volume, low-judgment work: reply classification, extraction. */
export const CHEAP_MODEL = "claude-haiku-4-5";

export const SUPPORTED_MODELS = Object.keys(PRICING);

function client(ctx: AdapterCtx): Anthropic {
  return new Anthropic({ apiKey: ctx.secret, maxRetries: 2, timeout: 120_000 });
}

function costOf(model: string, inputTokens: number, outputTokens: number): number {
  const rate = PRICING[model];
  if (!rate) return 0;
  return (inputTokens * rate.input + outputTokens * rate.output) / 1_000_000;
}

/** Turn an SDK error into something the user can act on. */
function describe(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) {
    return "Anthropic rejected this API key. Check it was copied in full from console.anthropic.com.";
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    return "This key cannot access the requested model. Check which workspace it belongs to.";
  }
  if (err instanceof Anthropic.NotFoundError) {
    return `Model ${DEFAULT_MODEL} is not available to this key.`;
  }
  if (err instanceof Anthropic.RateLimitError) {
    return "Anthropic is rate-limiting this key. The key works — try again shortly.";
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return "Could not reach api.anthropic.com. Check this server's outbound network access.";
  }
  if (err instanceof Anthropic.APIError) {
    return `Anthropic returned ${err.status}: ${err.message}`;
  }
  return err instanceof Error ? err.message : String(err);
}

export const anthropicProvider: LlmProvider = {
  id: "anthropic",
  category: "llm",

  /**
   * `GET /v1/models/{id}` — free, consumes no tokens, and proves two things at
   * once: the key authenticates, and this workspace can actually see the model
   * we default to. A key that passes an auth check but cannot reach the model
   * would otherwise fail later, mid-campaign.
   */
  async testConnection(ctx: AdapterCtx): Promise<TestResult> {
    const startedAt = Date.now();
    try {
      const model = await client(ctx).models.retrieve(DEFAULT_MODEL);
      const m = model as unknown as {
        id: string;
        display_name: string;
        max_input_tokens?: number;
        max_tokens?: number;
      };
      return {
        ok: true,
        message: `Connected. ${m.display_name} is available.`,
        detail: {
          model: m.id,
          contextWindow: m.max_input_tokens ?? null,
          maxOutputTokens: m.max_tokens ?? null,
        },
        latencyMs: Date.now() - startedAt,
      };
    } catch (err) {
      return { ok: false, message: describe(err), latencyMs: Date.now() - startedAt };
    }
  },

  /**
   * Structured completion. Every agent goes through here.
   *
   * On a schema failure, exactly one repair attempt runs with the validation
   * errors appended, then it gives up. Looping on a model that cannot produce
   * the shape burns money without converging, so the second failure is
   * dead-lettered with the raw output attached instead.
   */
  async complete<T>(req: LlmRequest<T>, ctx: AdapterCtx): Promise<LlmResponse<T>> {
    const startedAt = Date.now();
    const anthropic = client(ctx);

    let inputTokens = 0;
    let outputTokens = 0;

    const attempt = async (messages: LlmRequest<T>["messages"]) => {
      const response = await anthropic.messages.parse(
        {
          model: req.model,
          max_tokens: req.maxTokens,
          ...(req.system ? { system: req.system } : {}),
          messages,
          output_config: {
            format: zodOutputFormat(req.schema),
            ...(req.effort ? { effort: req.effort } : {}),
          },
        },
        { signal: ctx.signal },
      );

      inputTokens += response.usage.input_tokens;
      outputTokens += response.usage.output_tokens;

      // Safety classifiers can decline. Check before reading content — a refusal
      // returns HTTP 200 with empty or partial content, not an exception.
      if (response.stop_reason === "refusal") {
        throw providerError(
          "anthropic",
          `Anthropic declined the ${req.schemaName} request. Review this agent's prompt in Settings.`,
        );
      }
      if (response.stop_reason === "max_tokens") {
        throw providerError(
          "anthropic",
          `The ${req.schemaName} agent hit its ${req.maxTokens}-token output limit before finishing. ` +
            `Raise the limit for this agent in Settings.`,
        );
      }

      const rawText = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");

      return { parsed: response.parsed_output as T | null, rawText };
    };

    const first = await attempt(req.messages);
    if (first.parsed !== null && first.parsed !== undefined) {
      return {
        data: first.parsed,
        model: req.model,
        inputTokens,
        outputTokens,
        costUsd: costOf(req.model, inputTokens, outputTokens),
        latencyMs: Date.now() - startedAt,
        repaired: false,
      };
    }

    const repair = await attempt([
      ...req.messages,
      { role: "assistant", content: first.rawText },
      {
        role: "user",
        content:
          `That response did not match the required ${req.schemaName} schema. ` +
          `Return corrected JSON matching the schema exactly, and nothing else.`,
      },
    ]);

    if (repair.parsed === null || repair.parsed === undefined) {
      throw providerError(
        "anthropic",
        `The ${req.schemaName} agent returned output that does not match its schema, twice. ` +
          `The run was discarded rather than acted on.`,
        { rawText: repair.rawText },
      );
    }

    return {
      data: repair.parsed,
      model: req.model,
      inputTokens,
      outputTokens,
      costUsd: costOf(req.model, inputTokens, outputTokens),
      latencyMs: Date.now() - startedAt,
      repaired: true,
    };
  },
};
