const db = require("../db");
const { newId } = require("../lib/ids");

const insertStmt = db.prepare(`
  INSERT INTO bookings
    (id, lead_id, campaign_id, calcom_booking_id, start_time,
     attendee_name, attendee_email, status, raw, created_at)
  VALUES
    (@id, @lead_id, @campaign_id, @calcom_booking_id, @start_time,
     @attendee_name, @attendee_email, @status, @raw, @created_at)
`);

function create(input = {}) {
  const row = {
    id: newId("bkg"),
    lead_id: input.leadId || null,
    campaign_id: input.campaignId || null,
    calcom_booking_id: input.calcomBookingId ? String(input.calcomBookingId) : null,
    start_time: input.startTime || null,
    attendee_name: input.attendeeName || null,
    attendee_email: input.attendeeEmail || null,
    status: input.status || "confirmed",
    raw: input.raw ? JSON.stringify(input.raw) : null,
    created_at: new Date().toISOString()
  };
  insertStmt.run(row);
  return db.prepare("SELECT * FROM bookings WHERE id = ?").get(row.id);
}

function listByCampaign(campaignId) {
  return db
    .prepare("SELECT * FROM bookings WHERE campaign_id = ? ORDER BY start_time ASC")
    .all(campaignId);
}

function upcoming(limit = 50) {
  const now = new Date().toISOString();
  return db
    .prepare("SELECT * FROM bookings WHERE start_time >= ? ORDER BY start_time ASC LIMIT ?")
    .all(now, limit);
}

module.exports = { create, listByCampaign, upcoming };
