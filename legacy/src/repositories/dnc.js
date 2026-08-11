const db = require("../db");
const { normalizePhone } = require("../lib/phone");

function add(phone, reason = "manual") {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;
  db.prepare("INSERT OR REPLACE INTO dnc (phone, reason, created_at) VALUES (?, ?, ?)")
    .run(normalized, reason, new Date().toISOString());
  return normalized;
}

function has(phone) {
  const normalized = normalizePhone(phone);
  if (!normalized) return false;
  return Boolean(db.prepare("SELECT 1 FROM dnc WHERE phone = ?").get(normalized));
}

function list() {
  return db.prepare("SELECT * FROM dnc ORDER BY created_at DESC").all();
}

module.exports = { add, has, list };
