// Thin wrapper over the Vapi call API for outbound phone calls.

const VAPI_BASE = "https://api.vapi.ai";

function apiKey() {
  const key = process.env.VAPI_API_KEY;
  if (!key) throw new Error("VAPI_API_KEY is not set");
  return key;
}

// Place an outbound call. `assistantOverrides` (optional) carries the campaign's
// first message / system prompt / knowledge base so per-campaign scripting works.
async function placeOutboundCall({ assistantId, phoneNumberId, lead, assistantOverrides }) {
  if (!assistantId) throw new Error("assistantId is required");
  if (!phoneNumberId) throw new Error("phoneNumberId is required (provision a Vapi phone number)");
  if (!lead || !lead.phone) throw new Error("lead.phone is required");

  const body = {
    assistantId,
    phoneNumberId,
    customer: {
      number: lead.phone,
      name: lead.name || undefined
    },
    assistantOverrides: assistantOverrides || {
      variableValues: {
        name: lead.name || "there",
        company: lead.company || "",
        email: lead.email || "",
        notes: lead.notes || ""
      }
    }
  };

  const response = await fetch(`${VAPI_BASE}/call`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const err = new Error(`Vapi call failed (${response.status}): ${text}`);
    err.status = response.status;
    err.details = data;
    throw err;
  }
  return data; // includes id (vapi call id), status, etc.
}

async function getCall(vapiCallId) {
  const response = await fetch(`${VAPI_BASE}/call/${vapiCallId}`, {
    headers: { Authorization: `Bearer ${apiKey()}` }
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(`Vapi get-call failed (${response.status}): ${text}`);
  return data;
}

module.exports = { placeOutboundCall, getCall };
