const express = require("express");

const callsRepo = require("../repositories/calls");
const leadsRepo = require("../repositories/leads");
const { finalizeCall, recordBooking } = require("../services/callOutcome");
const { scheduleCalcomBooking } = require("../services/calcom");
const { classifyLead } = require("../services/deepseek");

const router = express.Router();

function getMessage(body) {
  return body.message || body || {};
}

function getVapiCallId(message) {
  const call = message.call || {};
  return call.id || message.callId || message.call_id || null;
}

// Map Vapi live status -> our lead status.
function leadStatusForCallStatus(status) {
  switch (String(status || "").toLowerCase()) {
    case "queued":
    case "ringing":
      return "dialing";
    case "in-progress":
      return "in_progress";
    default:
      return null;
  }
}

// Vapi posts ALL server messages here (status-update, end-of-call-report, ...).
router.post("/end-of-call", async (req, res, next) => {
  try {
    const message = getMessage(req.body);
    const type = message.type || "";
    const vapiCallId = getVapiCallId(message);
    const call = vapiCallId ? callsRepo.getByVapiId(vapiCallId) : null;
    const lead = call && call.lead_id ? leadsRepo.get(call.lead_id) : null;

    if (type === "status-update") {
      const status = message.status;
      if (call) callsRepo.update(call.id, { status: String(status || call.status) });
      if (lead) {
        const next = leadStatusForCallStatus(status);
        if (next && lead.status !== next) leadsRepo.update(lead.id, { status: next });
      }
      return res.status(200).json({ ok: true, handled: "status-update" });
    }

    if (type === "end-of-call-report" || message.endedReason) {
      if (call) {
        const result = await finalizeCall(call, lead, message);
        return res.status(200).json({ ok: true, handled: "end-of-call", disposition: result.disposition });
      }
      // Not tied to a campaign lead (e.g. browser test call) — classify for reference only.
      const transcriptText = [message.summary, message.transcript].filter(Boolean).join("\n\n").trim();
      const classification = transcriptText ? await classifyLead(transcriptText) : null;
      return res.status(200).json({ ok: true, handled: "end-of-call", untracked: true, classification });
    }

    // Other message types (transcript, speech-update, hang, ...) — acknowledge.
    return res.status(200).json({ ok: true, ignored: type || "unknown" });
  } catch (error) {
    next(error);
  }
});

function getToolCalls(body) {
  const message = getMessage(body);
  return (
    message.toolCallList ||
    message.toolCalls ||
    (message.toolWithToolCallList || []).map((item) => item.toolCall).filter(Boolean) ||
    []
  );
}

function getToolName(toolCall) {
  return toolCall.name || (toolCall.function && toolCall.function.name) || "";
}

function getToolArguments(toolCall) {
  const args = toolCall.arguments || (toolCall.function && toolCall.function.arguments) || (toolCall.function && toolCall.function.parameters) || {};
  if (typeof args === "string") {
    try {
      return JSON.parse(args);
    } catch {
      return {};
    }
  }
  return args || {};
}

router.post("/tools", async (req, res) => {
  const message = getMessage(req.body);
  const toolCalls = getToolCalls(req.body);
  const vapiCallId = getVapiCallId(message);
  const call = vapiCallId ? callsRepo.getByVapiId(vapiCallId) : null;
  const lead = call && call.lead_id ? leadsRepo.get(call.lead_id) : null;

  if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
    return res.status(400).json({ error: "No tool calls found in payload" });
  }

  const results = [];
  for (const toolCall of toolCalls) {
    const toolCallId = toolCall.id || toolCall.toolCallId;
    const name = getToolName(toolCall);
    const args = getToolArguments(toolCall);

    if (name !== "scheduleFollowup") {
      results.push({ toolCallId, result: `Unsupported tool: ${name}` });
      continue;
    }

    try {
      const booking = await scheduleCalcomBooking(args);
      if (call || lead) {
        recordBooking({
          campaignId: call && call.campaign_id,
          leadId: lead && lead.id,
          booking,
          args
        });
      }
      if (lead) {
        leadsRepo.update(lead.id, { next_action: "meeting scheduled" });
      }
      results.push({ toolCallId, result: { ok: true, booking } });
    } catch (error) {
      console.error("Cal.com scheduleFollowup tool failed:", error);
      results.push({
        toolCallId,
        result: { ok: false, message: "Could not schedule the follow-up. Please collect details for manual follow-up." }
      });
    }
  }

  return res.json({ results });
});

module.exports = router;
