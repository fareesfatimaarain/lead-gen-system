const db = require("../db");
const { newId } = require("../lib/ids");
const { normalizePhone, isValidE164 } = require("../lib/phone");

const insertStmt = db.prepare(`
  INSERT OR IGNORE INTO leads
    (id, campaign_id, name, phone, email, company, timezone, notes,
     status, attempts, created_at, updated_at)
  VALUES
    (@id, @campaign_id, @name, @phone, @email, @company, @timezone, @notes,
     'queued', 0, @created_at, @updated_at)
`);

const dncStmt = db.prepare("SELECT 1 FROM dnc WHERE phone = ?");

// records: [{ name, phone, email, company, timezone, notes }]
function bulkInsert(campaignId, records = []) {
  const now = new Date().toISOString();
  const result = { inserted: 0, duplicates: 0, invalid: 0, dnc: 0, errors: [] };
  const seen = new Set();

  const tx = db.transaction((rows) => {
    for (const raw of rows) {
      const phone = normalizePhone(raw.phone);
      if (!phone || !isValidE164(phone)) {
        result.invalid += 1;
        continue;
      }
      if (seen.has(phone)) {
        result.duplicates += 1;
        continue;
      }
      seen.add(phone);
      if (dncStmt.get(phone)) {
        result.dnc += 1;
        continue;
      }
      const info = insertStmt.run({
        id: newId("lead"),
        campaign_id: campaignId,
        name: raw.name || null,
        phone,
        email: raw.email || null,
        company: raw.company || null,
        timezone: raw.timezone || null,
        notes: raw.notes || null,
        created_at: now,
        updated_at: now
      });
      if (info.changes === 1) result.inserted += 1;
      else result.duplicates += 1; // hit unique(campaign_id, phone)
    }
  });

  tx(records);
  return result;
}

function get(id) {
  return db.prepare("SELECT * FROM leads WHERE id = ?").get(id);
}

function listByCampaign(campaignId, filters = {}) {
  const clauses = ["campaign_id = @campaign_id"];
  const params = { campaign_id: campaignId };
  if (filters.status) {
    clauses.push("status = @status");
    params.status = filters.status;
  }
  if (filters.classification) {
    clauses.push("classification = @classification");
    params.classification = filters.classification;
  }
  if (filters.search) {
    clauses.push("(name LIKE @q OR phone LIKE @q OR company LIKE @q OR email LIKE @q)");
    params.q = `%${filters.search}%`;
  }
  return db
    .prepare(`SELECT * FROM leads WHERE ${clauses.join(" AND ")} ORDER BY created_at ASC`)
    .all(params);
}

const UPDATABLE = new Set([
  "name", "phone", "email", "company", "timezone", "notes", "status",
  "classification", "reason", "next_action", "attempts",
  "last_attempt_at", "next_attempt_at"
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
  if (!sets.length) return get(id);
  sets.push("updated_at = @updated_at");
  db.prepare(`UPDATE leads SET ${sets.join(", ")} WHERE id = @id`).run(params);
  return get(id);
}

// The next lead eligible to dial: queued and (no retry time or retry time passed).
function getNextDialable(campaignId, nowIso = new Date().toISOString()) {
  return db
    .prepare(`
      SELECT * FROM leads
      WHERE campaign_id = ? AND status = 'queued'
        AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
      ORDER BY created_at ASC
      LIMIT 1
    `)
    .get(campaignId, nowIso);
}

// True if a call is currently active for this campaign (enforces sequential dialing).
function hasInFlight(campaignId) {
  const row = db
    .prepare("SELECT COUNT(*) n FROM leads WHERE campaign_id = ? AND status IN ('dialing','in_progress')")
    .get(campaignId);
  return row.n > 0;
}

function countByStatus(campaignId, statuses) {
  const placeholders = statuses.map(() => "?").join(",");
  return db
    .prepare(`SELECT COUNT(*) n FROM leads WHERE campaign_id = ? AND status IN (${placeholders})`)
    .get(campaignId, ...statuses).n;
}

// Reset any leads stuck mid-call (e.g. after a crash) back to queued.
function requeueStuck(campaignId) {
  return db
    .prepare("UPDATE leads SET status = 'queued', updated_at = ? WHERE campaign_id = ? AND status IN ('dialing','in_progress')")
    .run(new Date().toISOString(), campaignId).changes;
}

module.exports = {
  bulkInsert, get, listByCampaign, update,
  getNextDialable, hasInFlight, countByStatus, requeueStuck
};
