require("dotenv").config();

const systemPrompt = require("../prompts/systemPrompt");

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function buildAssistantPayload() {
  const webhookBaseUrl = requireEnv("WEBHOOK_PUBLIC_URL").replace(/\/$/, "");
  const modelProvider = process.env.MODEL_PROVIDER || "deepseek";
  const modelName = process.env.MODEL_NAME || "deepseek-v4-pro";
  const humanTransferNumber = requireEnv("HUMAN_TRANSFER_NUMBER");

  const vapiVoiceId = process.env.VAPI_VOICE_ID || "Naina";
  const vapiVoiceVersion = Number(process.env.VAPI_VOICE_VERSION || "2");

  return {
    name: "Bilingual Sales Lead Qualifier",
    firstMessage:
      "Hi, this is Alex calling about your inquiry. Marhaban, kaif yumkinuni musa'adatuk?",

    // VERIFY AGAINST CURRENT VAPI DOCS: Vapi has used both top-level serverUrl and
    // server.url patterns. This project sets both for clarity; remove one if your
    // current dashboard/API rejects unknown fields.
    serverUrl: `${webhookBaseUrl}/webhook/end-of-call`,
    server: {
      url: `${webhookBaseUrl}/webhook/end-of-call`
    },

    model: {
      provider: modelProvider,
      model: modelName,
      messages: [
        {
          role: "system",
          content: systemPrompt
        }
      ],
      tools: [
        {
          // VERIFY AGAINST CURRENT VAPI DOCS: transferCall is a built-in tool and
          // its destination schema can shift. Confirm this before the live demo.
          type: "transferCall",
          destinations: [
            {
              type: "number",
              number: humanTransferNumber,
              message: "I will connect you with someone who can help with pricing and next steps now."
            }
          ],
          description:
            "Transfer the active call to a human when the lead is qualified, asks about pricing or next steps, and wants to speak to someone now."
        },
        {
          type: "function",
          function: {
            name: "scheduleFollowup",
            description:
              "Use this when the lead is qualified but wants a pricing discussion and no human is available, or when the lead explicitly requests a scheduled call instead of talking now.",
            parameters: {
              type: "object",
              properties: {
                start: {
                  type: "string",
                  description: "Preferred follow-up start date/time in ISO 8601 format."
                },
                timeZone: {
                  type: "string",
                  description: "Lead's IANA time zone, such as Asia/Dubai or America/New_York."
                },
                name: {
                  type: "string",
                  description: "Lead's full name."
                },
                email: {
                  type: "string",
                  description: "Lead's email address, if provided."
                },
                phone: {
                  type: "string",
                  description: "Lead's phone number, if available."
                },
                notes: {
                  type: "string",
                  description: "Short context for the follow-up call."
                }
              },
              required: ["start"]
            }
          },
          server: {
            url: `${webhookBaseUrl}/webhook/tools`
          }
        }
      ]
    },

    // Native Vapi voice. See Vapi Voices docs for supported voice IDs.
    voice: {
      provider: "vapi",
      voiceId: vapiVoiceId,
      version: vapiVoiceVersion
    },

    // VERIFY AGAINST CURRENT VAPI DOCS: Deepgram language auto-detection support may
    // depend on the model/account. If Arabic calls do not transcribe well, switch
    // language manually for the demo.
    transcriber: {
      provider: "deepgram",
      model: "nova-2",
      language: "en"
    }
  };
}

async function createAssistant() {
  const apiKey = requireEnv("VAPI_API_KEY");
  const payload = buildAssistantPayload();

  try {
    const response = await fetch("https://api.vapi.ai/assistant", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const responseText = await response.text();
    const responseBody = responseText ? JSON.parse(responseText) : {};

    if (!response.ok) {
      throw new Error(`Vapi responded ${response.status}: ${responseText}`);
    }

    console.log(`Created Vapi assistant ID: ${responseBody.id}`);
    return responseBody;
  } catch (error) {
    console.error("Vapi assistant creation failed:", error);
    throw error;
  }
}

module.exports = { createAssistant, buildAssistantPayload };



