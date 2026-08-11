const db = require("../db");
const { newId } = require("../lib/ids");
const defaultSystemPrompt = require("../prompts/systemPrompt");

const DEFAULT_FIRST_MESSAGE =
  "Hi, this is Alex calling from the team about your recent inquiry. Do you have a quick minute to chat?";

const insertStmt = db.prepare(`
  INSERT INTO campaigns
    (id, name, status, assistant_id, phone_number_id, timezone,
     call_window_start, call_window_end, max_attempts, retry_minutes,
     first_message, system_prompt, knowledge_base, created_at, updated_at)
  VALUES
    (@id, @name, @status, @assistant_id, @phone_number_id, @timezone,
     @call_window_start, @call_window_end, @max_attempts, @retry_minutes,
     @first_message, @system_prompt, @knowledge_base, @created_at, @updated_at)
`);

function create(input = {}) {
  const now = new Date().toISOString();
  const row = {
    id: newId("cmp"),
    name: input.name || "Untitled Campaign",
    status: "draft",
    assistant_id: input.assistantId || process.env.VAPI_ASSISTANT_ID || null,
    phone_number_id: input.phoneNumberId || process.env.VAPI_PHONE_NUMBER_ID || null,
    timezone: input.timezone || "Asia/Karachi",
    call_window_start: Number.isFinite(input.callWindowStart) ? input.callWindowStart : 9,
    call_window_end: Number.isFinite(input.callWindowEnd) ? input.callWindowEnd : 18,
    max_attempts: Number.isFinite(input.maxAttempts) ? input.maxAttempts : 3,
    retry_minutes: Number.isFinite(input.retryMinutes) ? input.retryMinutes : 60,
    first_message: input.firstMessage != null ? input.firstMessage : DEFAULT_FIRST_MESSAGE,
    system_prompt: input.systemPrompt != null ? input.systemPrompt : defaultSystemPrompt,
    knowledge_base: input.knowledgeBase != null ? input.knowledgeBase : "",
    created_at: now,
    updated_at: now
  };
  insertStmt.run(row);
  return get(row.id);
}

function get(id) {
  return db.prepare("SELECT * FROM campaigns WHERE id = ?").get(id);
}

function list() {
  return db.prepare("SELECT * FROM campaigns ORDER BY created_at DESC").all();
}

const UPDATABLE = new Set([
  "name", "status", "assistant_id", "phone_number_id", "timezone",
  "call_window_start", "call_window_end", "max_attempts", "retry_minutes",
  "first_message", "system_prompt", "knowledge_base"
]);

function update(id, fields = {}) {
  const sets = [];
  const params = { id, updated_at: new Date().toISOString() };
  for (const [key, value] of Object.entries(fields)) {
    if (UPDATABLE.has(key)) {
      sets.push(`${key} = @${key}`);
      params[key] = value;
    }
  }
  sets.push("updated_at = @updated_at");
  db.prepare(`UPDATE campaigns SET ${sets.join(", ")} WHERE id = @id`).run(params);
  return get(id);
}

function setStatus(id, status) {
  return update(id, { status });
}

function stats(id) {
  const byStatus = db
    .prepare("SELECT status, COUNT(*) n FROM leads WHERE campaign_id = ? GROUP BY status")
    .all(id);
  const byClass = db
    .prepare("SELECT classification, COUNT(*) n FROM leads WHERE campaign_id = ? AND classification IS NOT NULL GROUP BY classification")
    .all(id);
  const total = db.prepare("SELECT COUNT(*) n FROM leads WHERE campaign_id = ?").get(id).n;

  const statusCounts = {};
  for (const r of byStatus) statusCounts[r.status] = r.n;
  const classCounts = {};
  for (const r of byClass) classCounts[r.classification] = r.n;

  const terminal = ["completed", "failed", "dnc", "done"];
  const finished = terminal.reduce((sum, s) => sum + (statusCounts[s] || 0), 0);

  return { total, finished, statusCounts, classCounts };
}

function remove(id) {
  const tx = db.transaction((cid) => {
    db.prepare("DELETE FROM bookings WHERE campaign_id = ?").run(cid);
    db.prepare("DELETE FROM calls WHERE campaign_id = ?").run(cid);
    db.prepare("DELETE FROM leads WHERE campaign_id = ?").run(cid); // also covered by FK cascade
    db.prepare("DELETE FROM campaigns WHERE id = ?").run(cid);
  });
  tx(id);
  return { ok: true };
}

module.exports = { create, get, list, update, setStatus, stats, remove };
