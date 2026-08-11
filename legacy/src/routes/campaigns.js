const express = require("express");

const campaignsRepo = require("../repositories/campaigns");
const leadsRepo = require("../repositories/leads");
const callsRepo = require("../repositories/calls");
const bookingsRepo = require("../repositories/bookings");
const dncRepo = require("../repositories/dnc");
const { parseCsvToObjects, mapLeadColumns } = require("../lib/csv");
const { placeOutboundCall } = require("../services/vapiCall");
const { buildAssistantOverrides } = require("../services/agentConfig");

const router = express.Router();

function withStats(campaign) {
  return { ...campaign, stats: campaignsRepo.stats(campaign.id) };
}

function requireCampaign(req, res) {
  const campaign = campaignsRepo.get(req.params.id);
  if (!campaign) {
    res.status(404).json({ error: "Campaign not found" });
    return null;
  }
  return campaign;
}

// ---- Campaigns ----

router.get("/campaigns", (_req, res) => {
  res.json({ campaigns: campaignsRepo.list().map(withStats) });
});

router.post("/campaigns", (req, res) => {
  const b = req.body || {};
  const campaign = campaignsRepo.create({
    name: b.name,
    timezone: b.timezone,
    assistantId: b.assistantId,
    phoneNumberId: b.phoneNumberId,
    callWindowStart: b.callWindowStart !== undefined ? Number(b.callWindowStart) : undefined,
    callWindowEnd: b.callWindowEnd !== undefined ? Number(b.callWindowEnd) : undefined,
    maxAttempts: b.maxAttempts !== undefined ? Number(b.maxAttempts) : undefined,
    retryMinutes: b.retryMinutes !== undefined ? Number(b.retryMinutes) : undefined
  });
  res.status(201).json({ campaign: withStats(campaign) });
});

router.get("/campaigns/:id", (req, res) => {
  const campaign = requireCampaign(req, res);
  if (!campaign) return;
  res.json({ campaign: withStats(campaign) });
});

router.patch("/campaigns/:id", (req, res) => {
  const campaign = requireCampaign(req, res);
  if (!campaign) return;
  const b = req.body || {};
  const fields = {};
  if (b.name !== undefined) fields.name = b.name;
  if (b.timezone !== undefined) fields.timezone = b.timezone;
  if (b.assistantId !== undefined) fields.assistant_id = b.assistantId;
  if (b.phoneNumberId !== undefined) fields.phone_number_id = b.phoneNumberId;
  if (b.callWindowStart !== undefined) fields.call_window_start = Number(b.callWindowStart);
  if (b.callWindowEnd !== undefined) fields.call_window_end = Number(b.callWindowEnd);
  if (b.maxAttempts !== undefined) fields.max_attempts = Number(b.maxAttempts);
  if (b.retryMinutes !== undefined) fields.retry_minutes = Number(b.retryMinutes);
  if (b.firstMessage !== undefined) fields.first_message = b.firstMessage;
  if (b.systemPrompt !== undefined) fields.system_prompt = b.systemPrompt;
  if (b.knowledgeBase !== undefined) fields.knowledge_base = b.knowledgeBase;
  res.json({ campaign: withStats(campaignsRepo.update(campaign.id, fields)) });
});

router.delete("/campaigns/:id", (req, res) => {
  const campaign = requireCampaign(req, res);
  if (!campaign) return;
  campaignsRepo.remove(campaign.id);
  res.json({ ok: true });
});

// ---- Import leads (CSV text or pre-parsed records) ----

router.post("/campaigns/:id/import", (req, res) => {
  const campaign = requireCampaign(req, res);
  if (!campaign) return;
  const b = req.body || {};

  let mapped = [];
  let detectedColumns = null;

  if (typeof b.csv === "string" && b.csv.trim()) {
    const { headers, records } = parseCsvToObjects(b.csv);
    if (!headers.length) return res.status(400).json({ error: "CSV appears to be empty" });
    const map = mapLeadColumns(headers);
    detectedColumns = map;
    if (!map.phone) {
      return res.status(400).json({
        error: "Could not find a phone column in the CSV. Include a header like 'phone', 'mobile', or 'number'.",
        headers
      });
    }
    mapped = records.map((r) => ({
      name: map.name ? r[map.name] : "",
      phone: map.phone ? r[map.phone] : "",
      email: map.email ? r[map.email] : "",
      company: map.company ? r[map.company] : "",
      timezone: map.timezone ? r[map.timezone] : "",
      notes: map.notes ? r[map.notes] : ""
    }));
  } else if (Array.isArray(b.records)) {
    mapped = b.records;
  } else {
    return res.status(400).json({ error: "Provide a 'csv' string or a 'records' array" });
  }

  const result = leadsRepo.bulkInsert(campaign.id, mapped);
  res.json({ result, detectedColumns, campaign: withStats(campaignsRepo.get(campaign.id)) });
});

// ---- Campaign controls ----

router.post("/campaigns/:id/start", (req, res) => {
  const campaign = requireCampaign(req, res);
  if (!campaign) return;

  const problems = [];
  if (!campaign.assistant_id) problems.push("No assistant configured (VAPI_ASSISTANT_ID).");
  if (!campaign.phone_number_id) problems.push("No Vapi phone number set. Provision one and add it to the campaign.");
  if (leadsRepo.countByStatus(campaign.id, ["queued"]) === 0) problems.push("No queued leads to call. Import a CSV first.");
  if (problems.length) return res.status(400).json({ error: "Cannot start campaign", problems });

  res.json({ campaign: withStats(campaignsRepo.setStatus(campaign.id, "running")) });
});

router.post("/campaigns/:id/pause", (req, res) => {
  const campaign = requireCampaign(req, res);
  if (!campaign) return;
  res.json({ campaign: withStats(campaignsRepo.setStatus(campaign.id, "paused")) });
});

router.post("/campaigns/:id/resume", (req, res) => {
  const campaign = requireCampaign(req, res);
  if (!campaign) return;
  res.json({ campaign: withStats(campaignsRepo.setStatus(campaign.id, "running")) });
});

// ---- Campaign detail data ----

router.get("/campaigns/:id/leads", (req, res) => {
  const campaign = requireCampaign(req, res);
  if (!campaign) return;
  const leads = leadsRepo.listByCampaign(campaign.id, {
    status: req.query.status,
    classification: req.query.classification,
    search: req.query.search
  });
  res.json({ leads });
});

router.get("/campaigns/:id/calls", (req, res) => {
  const campaign = requireCampaign(req, res);
  if (!campaign) return;
  res.json({ calls: callsRepo.listByCampaign(campaign.id, Number(req.query.limit) || 100) });
});

router.get("/campaigns/:id/bookings", (req, res) => {
  const campaign = requireCampaign(req, res);
  if (!campaign) return;
  res.json({ bookings: bookingsRepo.listByCampaign(campaign.id) });
});

// Place a single immediate call to the next lead (handy for a live demo).
router.post("/campaigns/:id/dial-next", async (req, res) => {
  const campaign = requireCampaign(req, res);
  if (!campaign) return;
  if (!campaign.phone_number_id) {
    return res.status(400).json({ error: "No Vapi phone number set on this campaign." });
  }
  const lead = leadsRepo.getNextDialable(campaign.id);
  if (!lead) return res.status(400).json({ error: "No dialable leads right now." });

  try {
    const now = new Date().toISOString();
    leadsRepo.update(lead.id, { status: "dialing", attempts: lead.attempts + 1, last_attempt_at: now, next_attempt_at: null });
    const call = callsRepo.create({ campaignId: campaign.id, leadId: lead.id, status: "queued", startedAt: now });
    const vapiCall = await placeOutboundCall({
      assistantId: campaign.assistant_id,
      phoneNumberId: campaign.phone_number_id,
      lead,
      assistantOverrides: buildAssistantOverrides(campaign, lead)
    });
    callsRepo.update(call.id, { vapi_call_id: vapiCall.id, status: vapiCall.status || "ringing" });
    res.json({ ok: true, lead, vapiCallId: vapiCall.id });
  } catch (err) {
    res.status(502).json({ error: "Failed to place call", message: err.message, details: err.details });
  }
});

// ---- Overview (top-level dashboard) ----

router.get("/overview", (_req, res) => {
  const campaigns = campaignsRepo.list();
  const totals = { total: 0, hot: 0, warm: 0, cold: 0, skipped: 0, unclassified: 0, queued: 0, completed: 0, no_answer: 0, voicemail: 0, failed: 0 };
  for (const c of campaigns) {
    const s = campaignsRepo.stats(c.id);
    totals.total += s.total;
    for (const [k, v] of Object.entries(s.statusCounts)) if (k in totals) totals[k] += v;
    totals.hot += s.classCounts.Hot || 0;
    totals.warm += s.classCounts.Warm || 0;
    totals.cold += s.classCounts.Cold || 0;
    totals.skipped += s.classCounts.Skipped || 0;
    totals.unclassified += s.classCounts.Unclassified || 0;
  }
  res.json({
    campaigns: campaigns.map(withStats),
    totals,
    recentCalls: callsRepo.recent(15),
    upcomingBookings: bookingsRepo.upcoming(20)
  });
});

// ---- Do-Not-Call list ----

router.get("/dnc", (_req, res) => res.json({ dnc: dncRepo.list() }));
router.post("/dnc", (req, res) => {
  const phone = dncRepo.add(req.body && req.body.phone, (req.body && req.body.reason) || "manual");
  if (!phone) return res.status(400).json({ error: "Invalid phone number" });
  res.status(201).json({ phone });
});

module.exports = router;
