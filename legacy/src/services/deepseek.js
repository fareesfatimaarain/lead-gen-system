const OpenAI = require("openai");

const SYSTEM_PROMPT =
  'You are a sales lead classification assistant. You will be given a transcript or summary of a phone call between an AI sales agent and a potential lead. Classify the lead as one of: Hot, Warm, Cold. Provide a one-sentence reason. Provide a recommended next_action (e.g. \'human follow-up call needed\', \'nurture in 2 weeks\', \'not a fit, do not pursue\'). Respond ONLY with valid JSON in this exact shape and nothing else: {"classification": "", "reason": "", "next_action": ""}';

function getClient() {
  return new OpenAI({
    apiKey: process.env.DEEPSEEK_API_KEY,
    baseURL: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com"
  });
}

function stripCodeFences(text) {
  return String(text || "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function isInsufficientBalanceError(error) {
  const status = error?.status;
  const message = [
    error?.message,
    error?.error?.message,
    error?.code,
    error?.type
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return status === 402 || message.includes("insufficient balance");
}

function skippedClassification(reason) {
  return {
    classification: "Skipped",
    reason,
    next_action: "manual review",
    skipped: true
  };
}

function parseClassification(content) {
  try {
    const parsed = JSON.parse(stripCodeFences(content));
    return {
      classification: parsed.classification || "Unclassified",
      reason: parsed.reason || "No reason provided",
      next_action: parsed.next_action || "manual review",
      skipped: false
    };
  } catch (error) {
    console.error("DeepSeek classification parse error:", error);
    return {
      classification: "Unclassified",
      reason: "parse error",
      next_action: "manual review",
      skipped: false
    };
  }
}

async function callDeepSeek(model, transcriptText) {
  const client = getClient();

  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: transcriptText }
    ],
    temperature: 0.1
  });

  return response.choices?.[0]?.message?.content || "";
}

async function classifyLead(transcriptText) {
  try {
    const content = await callDeepSeek("deepseek-v4-pro", transcriptText);
    return parseClassification(content);
  } catch (firstError) {
    if (isInsufficientBalanceError(firstError)) {
      console.warn("Skipping DeepSeek classification: insufficient balance.");
      return skippedClassification("DeepSeek skipped: insufficient balance");
    }

    console.error("DeepSeek API failed with model deepseek-v4-pro:", firstError);

    try {
      const fallbackContent = await callDeepSeek("deepseek-v4-flash", transcriptText);
      return parseClassification(fallbackContent);
    } catch (fallbackError) {
      if (isInsufficientBalanceError(fallbackError)) {
        console.warn("Skipping DeepSeek fallback classification: insufficient balance.");
        return skippedClassification("DeepSeek skipped: insufficient balance");
      }

      console.error("DeepSeek API failed with fallback model deepseek-v4-flash:", fallbackError);
      return {
        classification: "Unclassified",
        reason: "DeepSeek API error",
        next_action: "manual review",
        skipped: false
      };
    }
  }
}

module.exports = { classifyLead, isInsufficientBalanceError };
