// Sequential outbound dialer.
//
// Each tick, for every campaign in 'running' state:
//   1. Reconcile any in-flight call by polling Vapi (covers missed webhooks).
//   2. Enforce ONE active call at a time (sequential).
//   3. Respect the campaign's calling window (local timezone).
//   4. Pull the next dialable lead and place the call.
//   5. When nothing is left to dial, mark the campaign completed.
//
// Real-time updates still come from webhooks; the reconciler is the safety net.

const campaignsRepo = require("../repositories/campaigns");
const leadsRepo = require("../repositories/leads");
const callsRepo = require("../repositories/calls");
const dncRepo = require("../repositories/dnc");
const { placeOutboundCall, getCall } = require("../services/vapiCall");
const { finalizeCall } = require("../services/callOutcome");
const { buildAssistantOverrides } = require("../services/agentConfig");
const { isWithinWindow } = require("../lib/schedule");

const TICK_MS = Number(process.env.DIALER_TICK_MS || 8000);
const RECONCILE_AFTER_MS = Number(process.env.DIALER_RECONCILE_MS || 45000);

let timer = null;
let ticking = false;

function start() {
  if (timer) return;
  timer = setInterval(runTick, TICK_MS);
  console.log(`[dialer] started (tick ${TICK_MS}ms)`);
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

async function runTick() {
  if (ticking) return; // avoid overlapping ticks
  ticking = true;
  try {
    const running = campaignsRepo.list().filter((c) => c.status === "running");
    for (const campaign of running) {
      await processCampaign(campaign);
    }
  } catch (err) {
    console.error("[dialer] tick error:", err);
  } finally {
    ticking = false;
  }
}

async function processCampaign(campaign) {
  await reconcileInFlight(campaign);

  // Sequential: don't start a new call while one is active.
  if (leadsRepo.hasInFlight(campaign.id)) return;

  if (!isWithinWindow(campaign)) return;

  if (!campaign.assistant_id || !campaign.phone_number_id) return; // not dial-ready

  const lead = leadsRepo.getNextDialable(campaign.id);
  if (!lead) {
    // Nothing dialable right now. If nothing is queued at all, the campaign is done.
    if (leadsRepo.countByStatus(campaign.id, ["queued"]) === 0) {
      campaignsRepo.setStatus(campaign.id, "completed");
      console.log(`[dialer] campaign ${campaign.name} completed`);
    }
    return;
  }

  if (dncRepo.has(lead.phone)) {
    leadsRepo.update(lead.id, { status: "dnc" });
    return;
  }

  await dial(campaign, lead);
}

async function dial(campaign, lead) {
  const now = new Date().toISOString();
  // Claim the lead first so the sequential guard holds even across async gaps.
  leadsRepo.update(lead.id, {
    status: "dialing",
    attempts: lead.attempts + 1,
    last_attempt_at: now,
    next_attempt_at: null
  });
  const call = callsRepo.create({
    campaignId: campaign.id,
    leadId: lead.id,
    status: "queued",
    startedAt: now
  });

  try {
    const vapiCall = await placeOutboundCall({
      assistantId: campaign.assistant_id,
      phoneNumberId: campaign.phone_number_id,
      lead,
      assistantOverrides: buildAssistantOverrides(campaign, lead)
    });
    callsRepo.update(call.id, {
      vapi_call_id: vapiCall.id,
      status: vapiCall.status || "ringing"
    });
    console.log(`[dialer] dialing ${lead.phone} (${lead.name || "lead"}) call=${vapiCall.id}`);
  } catch (err) {
    console.error(`[dialer] dial failed for ${lead.phone}:`, err.message);
    callsRepo.update(call.id, {
      status: "ended",
      ended_reason: "dial-failed",
      disposition: "failed",
      ended_at: new Date().toISOString()
    });
    applyFailedAttempt(campaign, lead);
  }
}

function applyFailedAttempt(campaign, lead) {
  const maxAttempts = campaign.max_attempts || 3;
  // lead.attempts here is the pre-increment value; it was bumped in dial().
  if (lead.attempts + 1 < maxAttempts) {
    const nextAt = new Date(Date.now() + (campaign.retry_minutes || 60) * 60000).toISOString();
    leadsRepo.update(lead.id, { status: "queued", next_attempt_at: nextAt });
  } else {
    leadsRepo.update(lead.id, { status: "failed" });
  }
}

async function reconcileInFlight(campaign) {
  const inFlight = leadsRepo
    .listByCampaign(campaign.id, {})
    .filter((l) => l.status === "dialing" || l.status === "in_progress");

  for (const lead of inFlight) {
    const calls = callsRepo.listByCampaign(campaign.id, 200).filter((c) => c.lead_id === lead.id);
    const call = calls[0]; // most recent
    const ageMs = call ? Date.now() - new Date(call.started_at || call.created_at).getTime() : Infinity;
    if (ageMs < RECONCILE_AFTER_MS) continue;

    if (!call || !call.vapi_call_id) {
      // Call was never actually placed (e.g. crash) — return the lead to the queue.
      leadsRepo.update(lead.id, { status: "queued", next_attempt_at: null });
      continue;
    }

    try {
      const vapiCall = await getCall(call.vapi_call_id);
      if (vapiCall.status === "ended") {
        await finalizeCall(call, lead, vapiCall);
        console.log(`[dialer] reconciled ${call.vapi_call_id} -> ${vapiCall.endedReason}`);
      } else if (vapiCall.status === "in-progress" && lead.status !== "in_progress") {
        leadsRepo.update(lead.id, { status: "in_progress" });
      }
    } catch (err) {
      console.error(`[dialer] reconcile error for ${call.vapi_call_id}:`, err.message);
    }
  }
}

module.exports = { start, stop, runTick };
