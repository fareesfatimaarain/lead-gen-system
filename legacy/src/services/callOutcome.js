// Shared call-finalization logic. Both the end-of-call webhook and the dialer's
// Vapi reconciler funnel through finalizeCall(), which is idempotent: once a call
// row is 'ended' it will not be reprocessed.

const leadsRepo = require("../repositories/leads");
const callsRepo = require("../repositories/calls");
const bookingsRepo = require("../repositories/bookings");
const campaignsRepo = require("../repositories/campaigns");
const { classifyLead } = require("./deepseek");

const NO_ANSWER_REASONS = [
  "customer-did-not-answer", "customer-busy", "no-answer", "customer-not-answered",
  "twilio-failed", "failed-to-connect", "customer-hung-up-immediately"
];
const VOICEMAIL_REASONS = ["voicemail", "voicemail-detected"];

function messagesToTranscript(messages = []) {
  if (!Array.isArray(messages)) return "";
  return messages
    .map((m) => {
      const role = m.role || m.speaker || "unknown";
      const text = m.message || m.content || m.transcript || "";
      return text ? `${role}: ${text}` : "";
    })
    .filter(Boolean)
    .join("\n");
}

// Normalize both a Vapi call object (GET /call/:id) and an end-of-call webhook
// message into one shape.
function extractCallData(obj = {}) {
  const artifact = obj.artifact || {};
  const analysis = obj.analysis || {};
  const messages = obj.messages || artifact.messages || [];
  const transcript =
    obj.transcript || artifact.transcript || messagesToTranscript(messages) || "";
  const summary = obj.summary || analysis.summary || "";
  const recordingUrl =
    obj.recordingUrl || artifact.recordingUrl || (artifact.recording && artifact.recording.url) || null;
  const structuredData = analysis.structuredData || obj.structuredData || null;
  const endedReason = obj.endedReason || null;
  const startedAt = obj.startedAt || null;
  const endedAt = obj.endedAt || null;
  const status = obj.status || null;
  const transcriptText = [summary, transcript].filter(Boolean).join("\n\n").trim();
  return { transcript, summary, recordingUrl, structuredData, endedReason, startedAt, endedAt, status, transcriptText };
}

function classifyDisposition(endedReason, transcriptText) {
  const r = String(endedReason || "").toLowerCase();
  if (VOICEMAIL_REASONS.some((x) => r.includes(x))) return "voicemail";
  if (NO_ANSWER_REASONS.some((x) => r.includes(x))) return "no_answer";
  if (r.includes("error") || r.includes("providerfault") || r.includes("pipeline") || r.includes("failed")) {
    return "failed";
  }
  if (r.includes("silence-timed-out") && !transcriptText) return "no_answer";
  return "answered";
}

// callRow: our calls row (may be null if we can't correlate).
// lead: our leads row (may be null).
// source object: raw Vapi call or webhook message.
async function finalizeCall(callRow, lead, source) {
  const data = extractCallData(source);

  // Idempotency guard.
  if (callRow && callRow.status === "ended") {
    return { alreadyFinal: true, call: callRow, lead };
  }

  const disposition = classifyDisposition(data.endedReason, data.transcriptText);

  let classification = { classification: null, reason: null, next_action: null };
  if (disposition === "answered" && data.transcriptText) {
    classification = await classifyLead(data.transcriptText);
  } else if (disposition === "answered") {
    classification = { classification: "Unclassified", reason: "No transcript captured", next_action: "manual review" };
  }

  if (callRow) {
    callRow = callsRepo.update(callRow.id, {
      status: "ended",
      ended_reason: data.endedReason,
      disposition,
      classification: classification.classification,
      reason: classification.reason,
      next_action: classification.next_action,
      transcript: data.transcript || null,
      summary: data.summary || null,
      recording_url: data.recordingUrl,
      structured_data: data.structuredData ? JSON.stringify(data.structuredData) : null,
      ended_at: data.endedAt || new Date().toISOString()
    });
  }

  if (lead) {
    const campaign = campaignsRepo.get(lead.campaign_id) || {};
    const maxAttempts = campaign.max_attempts || 3;
    const retryMinutes = campaign.retry_minutes || 60;

    if (disposition === "answered") {
      lead = leadsRepo.update(lead.id, {
        status: "completed",
        classification: classification.classification || "Unclassified",
        reason: classification.reason,
        next_action: classification.next_action
      });
    } else if (lead.attempts < maxAttempts) {
      const nextAt = new Date(Date.now() + retryMinutes * 60000).toISOString();
      lead = leadsRepo.update(lead.id, { status: "queued", next_attempt_at: nextAt });
    } else {
      lead = leadsRepo.update(lead.id, { status: disposition });
    }
  }

  return { alreadyFinal: false, disposition, classification, call: callRow, lead };
}

// Persist a Cal.com booking produced by the scheduleFollowup tool, correlating it
// to the lead behind the active call when possible.
function recordBooking({ campaignId, leadId, booking, args }) {
  return bookingsRepo.create({
    campaignId,
    leadId,
    calcomBookingId: booking && (booking.id || booking.bookingId),
    startTime: (args && args.start) || (booking && booking.startTime) || null,
    attendeeName: args && args.name,
    attendeeEmail: args && args.email,
    status: "confirmed",
    raw: booking
  });
}

module.exports = { finalizeCall, extractCallData, classifyDisposition, recordBooking };
