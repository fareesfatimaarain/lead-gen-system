"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Badge, Button, InlineError, Notice, StatusDot } from "@/components/ui";
import { mergeTranscript, readTranscriptEvent } from "@/lib/vapi-demo";
import type { TranscriptLine } from "@/lib/vapi-demo";

/**
 * In-browser test call.
 *
 * Talks to the same Vapi assistant that phones prospects, over WebRTC instead of
 * the phone network, so the agent can be heard without dialling anyone. It is
 * the only place in the product where a person hears what a prospect hears.
 *
 * The SDK is imported dynamically inside the click handler rather than at module
 * scope. It reaches for `navigator` and `AudioContext` on construction, which
 * breaks server rendering, and it is a large dependency that nobody visiting any
 * other page should have to download.
 */

type Phase = "idle" | "connecting" | "live" | "ending";

/** Minimal shape of the SDK instance — enough to avoid `any` at the call sites. */
interface VapiLike {
  on(event: string, listener: (payload?: unknown) => void): unknown;
  start(assistantId: string): Promise<unknown>;
  stop(): Promise<void> | void;
  setMuted(muted: boolean): void;
}

export function DemoCall() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [lines, setLines] = useState<TranscriptLine[]>([]);
  const [muted, setMuted] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [volume, setVolume] = useState(0);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [seconds, setSeconds] = useState(0);

  const vapiRef = useRef<VapiLike | null>(null);
  const lineId = useRef(0);
  const transcriptRef = useRef<HTMLDivElement | null>(null);

  // Tear the call down if the operator navigates away mid-conversation. Without
  // this the WebRTC session survives the unmount and keeps billing with nobody
  // listening — and the microphone stays live.
  useEffect(() => {
    return () => {
      void vapiRef.current?.stop();
      vapiRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (phase !== "live") return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [phase]);

  useEffect(() => {
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight });
  }, [lines]);

  const addLine = useCallback((role: TranscriptLine["role"], text: string) => {
    setLines((prev) => {
      lineId.current += 1;
      return mergeTranscript(prev, role, text, lineId.current);
    });
  }, []);

  const start = useCallback(async () => {
    setError(null);
    setLines([]);
    setSeconds(0);
    setPhase("connecting");

    try {
      const response = await fetch("/api/calls/demo-session", { method: "POST" });
      const body = (await response.json()) as {
        publicKey?: string;
        assistantId?: string;
        callsRemainingThisHour?: number;
        error?: { message?: string };
      };
      if (!response.ok || !body.publicKey || !body.assistantId) {
        throw new Error(body.error?.message ?? "Could not get the credentials for a test call.");
      }
      setRemaining(body.callsRemainingThisHour ?? null);

      const { default: Vapi } = await import("@vapi-ai/web");
      const vapi = new Vapi(body.publicKey) as unknown as VapiLike;
      vapiRef.current = vapi;

      vapi.on("call-start", () => setPhase("live"));
      vapi.on("call-end", () => {
        setPhase("idle");
        setSpeaking(false);
        setVolume(0);
      });
      vapi.on("speech-start", () => setSpeaking(true));
      vapi.on("speech-end", () => setSpeaking(false));
      vapi.on("volume-level", (v) => setVolume(typeof v === "number" ? v : 0));
      vapi.on("error", (e) => {
        const message =
          e instanceof Error
            ? e.message
            : typeof e === "object" && e !== null && "message" in e
              ? String((e as { message: unknown }).message)
              : "The call failed.";
        setError(message);
        setPhase("idle");
      });
      vapi.on("message", (raw) => {
        const chunk = readTranscriptEvent(raw);
        if (chunk) addLine(chunk.role, chunk.text);
      });

      await vapi.start(body.assistantId);
    } catch (err) {
      // A refused microphone lands here as a DOMException whose message is not
      // worth showing; everything else is either our API's message or the SDK's.
      const message =
        err instanceof DOMException
          ? "Your browser blocked microphone access. Allow it for this site and try again."
          : err instanceof Error
            ? err.message
            : "Could not start the call.";
      setError(message);
      setPhase("idle");
      vapiRef.current = null;
    }
  }, [addLine]);

  const stop = useCallback(async () => {
    setPhase("ending");
    try {
      await vapiRef.current?.stop();
    } finally {
      vapiRef.current = null;
      setPhase("idle");
      setSpeaking(false);
      setVolume(0);
    }
  }, []);

  const toggleMute = useCallback(() => {
    setMuted((m) => {
      const next = !m;
      vapiRef.current?.setMuted(next);
      return next;
    });
  }, []);

  const active = phase === "live" || phase === "connecting" || phase === "ending";
  const mmss = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3 rounded border border-border bg-surface p-4">
        {!active ? (
          <Button variant="primary" onClick={start}>Start test call</Button>
        ) : (
          <Button variant="danger" onClick={stop} disabled={phase === "ending"}>
            {phase === "ending" ? "Ending…" : "End call"}
          </Button>
        )}

        {active ? (
          <Button variant="default" onClick={toggleMute} disabled={phase !== "live"}>
            {muted ? "Unmute" : "Mute"}
          </Button>
        ) : null}

        <div className="flex items-center gap-2 text-sm text-fg-muted">
          <StatusDot tone={phase === "live" ? "ok" : phase === "idle" ? "neutral" : "warn"} />
          {phase === "idle" ? "Not connected" : null}
          {phase === "connecting" ? "Connecting…" : null}
          {phase === "live" ? (speaking ? "Agent speaking" : "Listening") : null}
          {phase === "ending" ? "Ending…" : null}
        </div>

        {phase === "live" ? (
          <span className="font-mono text-sm tabular-nums text-fg-muted">{mmss}</span>
        ) : null}

        {/* Reads as an audio meter rather than progress: it is the only
            confirmation that the microphone is actually picking anything up. */}
        {phase === "live" ? (
          <div className="flex h-4 items-end gap-0.5" aria-hidden="true">
            {[0.15, 0.35, 0.55, 0.75, 0.95].map((threshold) => (
              <span
                key={threshold}
                className={`w-1 rounded-sm transition-all duration-100 ${
                  volume >= threshold ? "bg-accent" : "bg-border"
                }`}
                style={{ height: `${threshold * 100}%` }}
              />
            ))}
          </div>
        ) : null}

        {remaining !== null && !active ? (
          <Badge tone="neutral">{remaining} test call(s) left this hour</Badge>
        ) : null}
      </div>

      {error ? <InlineError>{error}</InlineError> : null}

      <div
        ref={transcriptRef}
        className="max-h-96 min-h-32 overflow-y-auto rounded border border-border bg-bg p-4"
        aria-live="polite"
        aria-label="Live call transcript"
      >
        {lines.length === 0 ? (
          <p className="text-sm text-fg-subtle">
            {active
              ? "Listening. Say hello — the transcript appears here as you both speak."
              : "The transcript will appear here once the call connects."}
          </p>
        ) : (
          <ol className="flex flex-col gap-3">
            {lines.map((line) => (
              <li key={line.id} className="text-sm">
                <span
                  className={`mr-2 font-mono text-xs uppercase tracking-wider ${
                    line.role === "assistant" ? "text-accent" : "text-fg-subtle"
                  }`}
                >
                  {line.role === "assistant" ? "Agent" : "You"}
                </span>
                <span className="text-fg">{line.text}</span>
              </li>
            ))}
          </ol>
        )}
      </div>

      <Notice tone="neutral">
        This call is billed by Vapi exactly like a real one, and it uses the same assistant your sequences call
        prospects with — so what you hear is what they hear. It does not create a prospect, a call record, or an
        activity.
      </Notice>
    </div>
  );
}
