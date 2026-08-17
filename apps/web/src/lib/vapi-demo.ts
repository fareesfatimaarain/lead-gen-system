/**
 * Shared logic for the in-browser test call.
 *
 * The page decides what to render, the API route decides what to hand the
 * browser, and both have to agree on what "ready" means. Two copies of that
 * check would drift the first time a field is added — and the failure mode is a
 * page that offers a button whose endpoint then refuses.
 */

/**
 * The only two fields a browser is allowed to receive.
 *
 * Named explicitly rather than passed through, because `credentials.config` is
 * the non-secret half by convention, not by enforcement. Anything added to it
 * later — an internal note, an account id — would otherwise be published to the
 * client the moment it exists.
 */
export interface DemoCallConfig {
  publicKey: string;
  assistantId: string;
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function readDemoConfig(config: unknown): DemoCallConfig {
  const c = (config ?? {}) as Record<string, unknown>;
  return { publicKey: str(c.publicKey), assistantId: str(c.assistantId) };
}

export type DemoBlocker = "not_connected" | "no_public_key" | "no_assistant";

export interface DemoReadiness {
  ready: boolean;
  blocker: DemoBlocker | null;
}

/**
 * Order matters: report the first thing the operator has to fix, not all of
 * them. A missing credential makes the other two questions meaningless.
 */
export function demoReadiness(config: unknown | null): DemoReadiness {
  if (config === null || config === undefined) return { ready: false, blocker: "not_connected" };
  const { publicKey, assistantId } = readDemoConfig(config);
  if (!publicKey) return { ready: false, blocker: "no_public_key" };
  if (!assistantId) return { ready: false, blocker: "no_assistant" };
  return { ready: true, blocker: null };
}

export const DEMO_BLOCKER_MESSAGE: Record<DemoBlocker, string> = {
  not_connected: "Vapi is not connected yet, so there is no agent to call.",
  no_public_key:
    "Vapi is connected, but no public key is saved. A browser call cannot use the private key — that one stays on the server.",
  no_assistant: "Vapi is connected, but no assistant ID is saved, so there is nothing to call.",
};

// ---------------------------------------------------------------------------
// Transcript
// ---------------------------------------------------------------------------

export interface TranscriptLine {
  id: number;
  role: "assistant" | "user";
  text: string;
}

/**
 * Fold a transcript chunk into the running transcript.
 *
 * Vapi emits partial transcripts and then a final one for the same utterance.
 * Appending each would stutter a sentence out one word per line, so a chunk from
 * the same speaker as the previous line replaces it; a change of speaker starts
 * a new line. Returns the input unchanged for empty chunks, so the caller can
 * pass raw events straight through.
 */
export function mergeTranscript(
  lines: readonly TranscriptLine[],
  role: TranscriptLine["role"],
  text: string,
  nextId: number,
): TranscriptLine[] {
  const trimmed = text.trim();
  if (!trimmed) return lines as TranscriptLine[];

  const last = lines[lines.length - 1];
  if (last && last.role === role) {
    return [...lines.slice(0, -1), { ...last, text: trimmed }];
  }
  return [...lines, { id: nextId, role, text: trimmed }];
}

/** Narrow a Vapi `message` event to a transcript chunk, or null if it is not one. */
export function readTranscriptEvent(raw: unknown): { role: TranscriptLine["role"]; text: string } | null {
  const m = raw as { type?: unknown; role?: unknown; transcript?: unknown } | null;
  if (!m || m.type !== "transcript" || typeof m.transcript !== "string") return null;
  return { role: m.role === "assistant" ? "assistant" : "user", text: m.transcript };
}