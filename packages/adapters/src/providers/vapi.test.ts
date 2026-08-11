import { describe, expect, it } from "vitest";
import { classifyDisposition, extractCallState } from "./vapi";

/**
 * These cover knowledge ported from the legacy MVP that was derived by watching
 * real calls, not by reading a spec. If a case here starts failing after a
 * refactor, the refactor is wrong.
 */

describe("classifyDisposition", () => {
  it("detects voicemail", () => {
    expect(classifyDisposition("voicemail", "")).toBe("voicemail");
    expect(classifyDisposition("voicemail-detected", "beep")).toBe("voicemail");
  });

  it("detects the observed no-answer reasons", () => {
    for (const reason of [
      "customer-did-not-answer",
      "customer-busy",
      "no-answer",
      "customer-not-answered",
      "twilio-failed",
      "failed-to-connect",
      "customer-hung-up-immediately",
    ]) {
      expect(classifyDisposition(reason, "")).toBe("no_answer");
    }
  });

  it("detects failures", () => {
    expect(classifyDisposition("pipeline-error-openai-llm-failed", "")).toBe("failed");
    expect(classifyDisposition("assistant-error", "")).toBe("failed");
    expect(classifyDisposition("vapifault-providerfault", "")).toBe("failed");
  });

  it("treats a silence timeout with no transcript as no-answer", () => {
    // The line opened but nobody ever spoke — that is not a conversation.
    expect(classifyDisposition("silence-timed-out", "")).toBe("no_answer");
  });

  it("treats a silence timeout WITH a transcript as answered", () => {
    // Somebody did talk before the silence; the call is real and worth scoring.
    expect(classifyDisposition("silence-timed-out", "user: hello?")).toBe("answered");
  });

  it("defaults to answered for a clean hangup", () => {
    expect(classifyDisposition("customer-ended-call", "user: not interested")).toBe("answered");
    expect(classifyDisposition("assistant-ended-call", "user: sure")).toBe("answered");
  });

  it("handles a missing endedReason without throwing", () => {
    expect(classifyDisposition(null, "")).toBe("answered");
    expect(classifyDisposition(undefined, "")).toBe("answered");
  });

  it("matches case-insensitively", () => {
    expect(classifyDisposition("Customer-Did-Not-Answer", "")).toBe("no_answer");
  });
});

describe("extractCallState", () => {
  it("reads a polled call object (artifact shape)", () => {
    const state = extractCallState(
      {
        status: "ended",
        endedReason: "customer-ended-call",
        artifact: {
          transcript: "AI: hi\nUser: hello",
          messages: [
            { role: "assistant", message: "hi" },
            { role: "user", message: "hello" },
          ],
          recordingUrl: "https://rec/1.mp3",
        },
        analysis: { summary: "Short call." },
        startedAt: "2026-08-07T10:00:00Z",
        endedAt: "2026-08-07T10:01:00Z",
      },
      "call_1",
    );

    expect(state.providerCallId).toBe("call_1");
    expect(state.status).toBe("ended");
    expect(state.summary).toBe("Short call.");
    expect(state.recordingUrl).toBe("https://rec/1.mp3");
    expect(state.transcript).toEqual([
      { role: "assistant", text: "hi" },
      { role: "user", text: "hello" },
    ]);
    expect(state.startedAt?.toISOString()).toBe("2026-08-07T10:00:00.000Z");
  });

  it("reads a webhook message (top-level shape)", () => {
    // The same call arrives in two different shapes depending on the path it
    // took to reach us. Both must normalize identically.
    const state = extractCallState(
      {
        status: "ended",
        endedReason: "customer-ended-call",
        transcript: "AI: hi",
        summary: "Short call.",
        recordingUrl: "https://rec/1.mp3",
      },
      "call_1",
    );

    expect(state.summary).toBe("Short call.");
    expect(state.recordingUrl).toBe("https://rec/1.mp3");
    expect(state.transcriptText).toBe("AI: hi");
  });

  it("falls back through the recording-url variants", () => {
    expect(
      extractCallState({ artifact: { recording: { url: "https://rec/2.mp3" } } }, "c").recordingUrl,
    ).toBe("https://rec/2.mp3");
  });

  it("builds a transcript string from turns when no flat transcript is present", () => {
    const state = extractCallState(
      { messages: [{ role: "user", content: "hello there" }] },
      "c",
    );
    expect(state.transcriptText).toBe("user: hello there");
  });

  it("drops empty turns rather than storing blanks", () => {
    const state = extractCallState(
      { messages: [{ role: "user", message: "" }, { role: "assistant", message: "hi" }] },
      "c",
    );
    expect(state.transcript).toEqual([{ role: "assistant", text: "hi" }]);
  });

  it("survives an empty payload", () => {
    const state = extractCallState({}, "c");
    expect(state.providerCallId).toBe("c");
    expect(state.status).toBe("unknown");
    expect(state.transcript).toBeUndefined();
  });
});
