import { afterEach, describe, expect, it, vi } from "vitest";
import { vapiProvider } from "./providers/vapi";
import type { AdapterCtx } from "./types";

/**
 * The phone number id became optional on the credential so a Vapi account used
 * only for browser test calls can be connected. Reaching a real phone still
 * needs one, and this pins that the refusal happens here — before a request goes
 * out — rather than being relayed back as Vapi's less specific rejection.
 */
const ctx: AdapterCtx = { orgId: "org-1", secret: "sk-test", config: {} };
const req = { assistantId: "as_1", customer: { number: "+441234567890" } };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("vapiProvider.place without a phone number id", () => {
  it("refuses, naming the field and where to set it", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(vapiProvider.place(req, ctx)).rejects.toThrow(/phone number ID/i);
    expect(fetchMock, "should not reach the network").not.toHaveBeenCalled();
  });

  it("treats whitespace as absent", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(vapiProvider.place({ ...req, phoneNumberId: "   " }, ctx)).rejects.toThrow(/phone number ID/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("proceeds when one is supplied", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        status: 201,
        text: async () => JSON.stringify({ id: "call_1", status: "queued" }),
      }),
    );

    await expect(vapiProvider.place({ ...req, phoneNumberId: "pn_1" }, ctx)).resolves.toEqual({
      providerCallId: "call_1",
      status: "queued",
    });
  });
});
