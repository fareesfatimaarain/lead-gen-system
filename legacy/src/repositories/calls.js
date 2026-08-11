const db = require("../db");
const { newId } = require("../lib/ids");

const insertStmt = db.prepare(`
  INSERT INTO calls
    (id, vapi_call_id, campaign_id, lead_id, status, started_at, created_at)
  VALUES
    (@id, @vapi_call_id, @campaign_id, @lead_id, @status, @started_at, @created_at)
`);

function create(input = {}) {
  const now = new Date().toISOString();
  const row = {
    id: newId("call"),
    vapi_call_id: input.vapiCallId || null,
    campaign_id: input.campaignId || null,
    lead_id: input.leadId || null,
    status: input.status || "queued",
    started_at: input.startedAt || now,
    created_at: now
  };
  insertStmt.run(row);
  return get(row.id);
}

function get(id) {
  return db.prepare("SELECT * FROM calls WHERE id = ?").get(id);
}

function getByVapiId(vapiCallId) {
  if (!vapiCallId) return null;
  return db.prepare("SELECT * FROM calls WHERE vapi_call_id = ? ORDER BY created_at DESC LIMIT 1").get(vapiCallId);
}

const UPDATABLE = new Set([
  "vapi_call_id", "lead_id", "campaign_id", "status", "ended_reason", "disposition",
  "classification", "reason", "next_action", "transcript", "summary",
  "recording_url", "structured_data", "started_at", "ended_at"
]);

function update(id, fields = {}) {
  const sets = [];
  const params = { id };
  for (const [key, value] of Object.entries(fields)) {
    if (UPDATABLE.has(key)) {
      sets.push(`${key} = @${key}`);
      params[key] = value;
    }
  }
  if (!sets.length) return get(id);
  db.prepare(`UPDATE calls SET ${sets.join(", ")} WHERE id = @id`).run(params);
  return get(id);
}

function listByCampaign(campaignId, limit = 100) {
  return db
    .prepare("SELECT * FROM calls WHERE campaign_id = ? ORDER BY created_at DESC LIMIT ?")
    .all(campaignId, limit);
}

function recent(limit = 25) {
  return db.prepare("SELECT * FROM calls ORDER BY created_at DESC LIMIT ?").all(limit);
}

module.exports = { create, get, getByVapiId, update, listByCampaign, recent };
