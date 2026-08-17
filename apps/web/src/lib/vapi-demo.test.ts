import { describe, expect, it } from "vitest";
import {
  DEMO_BLOCKER_MESSAGE,
  demoReadiness,
  mergeTranscript,
  readDemoConfig,
  readTranscriptEvent,
} from "./vapi-demo";
import type { TranscriptLine } from "./vapi-demo";

describe("readDemoConfig", () => {
  it("reads the two browser-safe fields", () => {
    expect(readDemoConfig({ publicKey: "pk_1", assistantId: "as_1" })).toEqual({
      publicKey: "pk_1",
      assistantId: "as_1",
    });
  });

  /**
   * The security property of this whole feature. `credentials.config` is the
   * non-secret half by convention, and this asserts the convention is enforced
   * by construction rather than trusted — a field added to config later must not
   * reach the browser just because it exists.
   */
  it("returns nothing but those two fields, whatever else config carries", () => {
    const result = readDemoConfig({
      publicKey: "pk_1",
      assistantId: "as_1",
      webhookSecret: "super-secret-value",
      phoneNumberId: "pn_1",
      somethingAddedLater: "should not leak",
    });
    expect(Object.keys(result).sort()).toEqual(["assistantId", "publicKey"]);
    expect(JSON.stringify(result)).not.toContain("super-secret-value");
    expect(JSON.stringify(result)).not.toContain("should not leak");
  });

  it("trims, and treats whitespace or a non-string as absent", () => {
    expect(readDemoConfig({ publicKey: "  pk_1  ", assistantId: "   " })).toEqual({
      publicKey: "pk_1",
      assistantId: "",
    });
    expect(readDemoConfig({ publicKey: 12345, assistantId: null })).toEqual({ publicKey: "", assistantId: "" });
  });

  it("survives null and undefined config", () => {
    expect(readDemoConfig(null)).toEqual({ publicKey: "", assistantId: "" });
    expect(readDemoConfig(undefined)).toEqual({ publicKey: "", assistantId: "" });
  });
});

describe("demoReadiness", () => {
  it("is ready when both fields are present", () => {
    expect(demoReadiness({ publicKey: "pk_1", assistantId: "as_1" })).toEqual({ ready: true, blocker: null });
  });

  it("reports no credential first, because the other questions are then meaningless", () => {
    expect(demoReadiness(null).blocker).toBe("not_connected");
  });

  it("distinguishes a missing public key from a missing assistant", () => {
    expect(demoReadiness({ assistantId: "as_1" }).blocker).toBe("no_public_key");
    expect(demoReadiness({ publicKey: "pk_1" }).blocker).toBe("no_assistant");
  });

  it("reports the public key first when both are missing", () => {
    expect(demoReadiness({}).blocker).toBe("no_public_key");
  });

  it("has a message for every blocker it can return", () => {
    for (const cfg of [null, {}, { publicKey: "pk_1" }]) {
      const { blocker } = demoReadiness(cfg);
      expect(blocker && DEMO_BLOCKER_MESSAGE[blocker]).toBeTruthy();
    }
  });

  // The private key is never in `config`, but a reader should not have to know
  // that to trust the page: a credential carrying only the private key is not
  // "ready", it is missing a public key.
  it("does not consider a private-key-only credential ready", () => {
    expect(demoReadiness({ phoneNumberId: "pn_1", webhookSecret: "x" }).ready).toBe(false);
  });
});

describe("mergeTranscript", () => {
  const line = (id: number, role: TranscriptLine["role"], text: string): TranscriptLine => ({ id, role, text });

  it("appends the first chunk", () => {
    expect(mergeTranscript([], "assistant", "Hello there", 1)).toEqual([line(1, "assistant", "Hello there")]);
  });

  // Vapi streams partials then a final for one utterance. Appending each would
  // stutter a sentence out one word per line.
  it("replaces the trailing line when the same speaker continues", () => {
    let lines = mergeTranscript([], "assistant", "Hi", 1);
    lines = mergeTranscript(lines, "assistant", "Hi, is now", 2);
    lines = mergeTranscript(lines, "assistant", "Hi, is now a good time?", 3);
    expect(lines).toEqual([line(1, "assistant", "Hi, is now a good time?")]);
  });

  it("starts a new line when the speaker changes", () => {
    let lines = mergeTranscript([], "assistant", "Is now a good time?", 1);
    lines = mergeTranscript(lines, "user", "Not really", 2);
    expect(lines).toEqual([line(1, "assistant", "Is now a good time?"), line(2, "user", "Not really")]);
  });

  it("alternates back and forth without merging across a speaker change", () => {
    let lines = mergeTranscript([], "assistant", "A", 1);
    lines = mergeTranscript(lines, "user", "B", 2);
    lines = mergeTranscript(lines, "assistant", "C", 3);
    expect(lines.map((l) => l.role)).toEqual(["assistant", "user", "assistant"]);
    expect(lines).toHaveLength(3);
  });

  it("ignores an empty or whitespace chunk rather than adding a blank line", () => {
    const existing = [line(1, "user", "Hello")];
    expect(mergeTranscript(existing, "assistant", "   ", 2)).toBe(existing);
    expect(mergeTranscript([], "assistant", "", 1)).toEqual([]);
  });

  it("does not mutate the array it is given", () => {
    const existing = [line(1, "user", "Hello")];
    mergeTranscript(existing, "user", "Hello there", 2);
    expect(existing).toEqual([line(1, "user", "Hello")]);
  });
});

describe("readTranscriptEvent", () => {
  it("reads a transcript event", () => {
    expect(readTranscriptEvent({ type: "transcript", role: "assistant", transcript: "Hi" })).toEqual({
      role: "assistant",
      text: "Hi",
    });
  });

  it("treats any non-assistant role as the human", () => {
    expect(readTranscriptEvent({ type: "transcript", role: "customer", transcript: "Hi" })?.role).toBe("user");
    expect(readTranscriptEvent({ type: "transcript", transcript: "Hi" })?.role).toBe("user");
  });

  // The SDK emits status updates, function calls and tool results on the same
  // channel; only transcripts belong in the transcript.
  it("ignores events that are not transcripts", () => {
    expect(readTranscriptEvent({ type: "status-update", status: "in-progress" })).toBeNull();
    expect(readTranscriptEvent({ type: "transcript" })).toBeNull();
    expect(readTranscriptEvent(null)).toBeNull();
    expect(readTranscriptEvent(undefined)).toBeNull();
    expect(readTranscriptEvent("nonsense")).toBeNull();
  });
});
