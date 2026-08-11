const express = require("express");
const { classifyLead } = require("../services/deepseek");

const router = express.Router();

function isSet(value) {
  return Boolean(value && String(value).trim());
}

function publicUrl() {
  return (process.env.WEBHOOK_PUBLIC_URL || "").replace(/\/$/, "");
}

function getEnvStatus() {
  const checks = [
    { name: "DeepSeek API key", key: "DEEPSEEK_API_KEY", required: true },
    { name: "Vapi API key", key: "VAPI_API_KEY", required: true },
    { name: "Vapi assistant ID", key: "VAPI_ASSISTANT_ID", required: true },
    { name: "Vapi public key", key: "VAPI_PUBLIC_KEY", required: false },
    { name: "Vapi phone number ID", key: "VAPI_PHONE_NUMBER_ID", required: true },
    { name: "Webhook public URL", key: "WEBHOOK_PUBLIC_URL", required: true },
    { name: "Human transfer number", key: "HUMAN_TRANSFER_NUMBER", required: false },
    { name: "Cal.com API key", key: "CALCOM_API_KEY", required: true },
    { name: "Cal.com username", key: "CALCOM_USERNAME", required: true },
    { name: "Cal.com event slug", key: "CALCOM_EVENT_TYPE_SLUG", required: true }
  ];
  return checks.map((c) => ({ ...c, set: isSet(process.env[c.key]) }));
}

function getWarnings() {
  const warnings = [];
  if (!isSet(process.env.VAPI_PHONE_NUMBER_ID)) {
    warnings.push("Outbound calling needs a Vapi phone number (VAPI_PHONE_NUMBER_ID). The dialer cannot place calls without it.");
  }
  if (!isSet(process.env.WEBHOOK_PUBLIC_URL)) {
    warnings.push("Set WEBHOOK_PUBLIC_URL to your public tunnel so Vapi can deliver call results.");
  }
  const transfer = process.env.HUMAN_TRANSFER_NUMBER || "";
  if (transfer && !/^\+[1-9]\d{7,14}$/.test(transfer.trim())) {
    warnings.push("Human transfer number should be international format, e.g. +923001234567.");
  }
  return warnings;
}

router.get("/status", (_req, res) => {
  const base = publicUrl();
  res.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    model: { provider: process.env.MODEL_PROVIDER || "deepseek", name: process.env.MODEL_NAME || "deepseek-v4-pro" },
    voice: { provider: "vapi", voiceId: process.env.VAPI_VOICE_ID || "Naina", version: process.env.VAPI_VOICE_VERSION || "2" },
    capabilities: {
      outboundCall: isSet(process.env.VAPI_API_KEY) && isSet(process.env.VAPI_ASSISTANT_ID) && isSet(process.env.VAPI_PHONE_NUMBER_ID),
      browserCall: isSet(process.env.VAPI_PUBLIC_KEY) && isSet(process.env.VAPI_ASSISTANT_ID),
      scheduling: isSet(process.env.CALCOM_API_KEY) && isSet(process.env.CALCOM_USERNAME)
    },
    endpoints: {
      dashboard: "http://localhost:" + (process.env.PORT || 3000) + "/dashboard",
      publicBaseUrl: base,
      endOfCallWebhook: base ? `${base}/webhook/end-of-call` : "",
      toolWebhook: base ? `${base}/webhook/tools` : ""
    },
    defaults: {
      assistantId: process.env.VAPI_ASSISTANT_ID || "",
      phoneNumberId: process.env.VAPI_PHONE_NUMBER_ID || ""
    },
    env: getEnvStatus(),
    warnings: getWarnings()
  });
});

router.get("/client-config", (_req, res) => {
  res.json({
    vapiPublicKey: process.env.VAPI_PUBLIC_KEY || "",
    assistantId: process.env.VAPI_ASSISTANT_ID || ""
  });
});

// Manual transcript classifier (handy demo / QA tool).
router.post("/classify", async (req, res) => {
  const transcript = String((req.body && req.body.transcript) || "").trim();
  if (!transcript) return res.status(400).json({ error: "Transcript is required" });
  const classification = await classifyLead(transcript);
  res.json({ classification });
});

module.exports = router;
