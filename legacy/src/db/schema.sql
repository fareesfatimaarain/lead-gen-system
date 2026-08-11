-- Calling Agent — data model
-- All timestamps are ISO 8601 strings (UTC). Local calling windows are computed
-- against each campaign's IANA timezone at runtime.

CREATE TABLE IF NOT EXISTS campaigns (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'draft',   -- draft | running | paused | completed
  assistant_id      TEXT,
  phone_number_id   TEXT,
  timezone          TEXT NOT NULL DEFAULT 'Asia/Karachi',
  call_window_start INTEGER NOT NULL DEFAULT 9,       -- local hour 0-23 (inclusive)
  call_window_end   INTEGER NOT NULL DEFAULT 18,      -- local hour 0-23 (exclusive)
  max_attempts      INTEGER NOT NULL DEFAULT 3,
  retry_minutes     INTEGER NOT NULL DEFAULT 60,
  first_message     TEXT,
  system_prompt     TEXT,
  knowledge_base    TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS leads (
  id              TEXT PRIMARY KEY,
  campaign_id     TEXT NOT NULL,
  name            TEXT,
  phone           TEXT NOT NULL,                       -- E.164
  email           TEXT,
  company         TEXT,
  timezone        TEXT,
  notes           TEXT,
  status          TEXT NOT NULL DEFAULT 'queued',      -- queued | dialing | in_progress | completed | no_answer | voicemail | failed | dnc | done
  classification  TEXT,                                -- Hot | Warm | Cold | Unclassified | Skipped
  reason          TEXT,
  next_action     TEXT,
  attempts        INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TEXT,
  next_attempt_at TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_leads_campaign ON leads(campaign_id);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(campaign_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_campaign_phone ON leads(campaign_id, phone);

CREATE TABLE IF NOT EXISTS calls (
  id              TEXT PRIMARY KEY,
  vapi_call_id    TEXT,
  campaign_id     TEXT,
  lead_id         TEXT,
  status          TEXT,                                -- queued | ringing | in_progress | ended
  ended_reason    TEXT,
  disposition     TEXT,                                -- answered | no_answer | voicemail | failed
  classification  TEXT,
  reason          TEXT,
  next_action     TEXT,
  transcript      TEXT,
  summary         TEXT,
  recording_url   TEXT,
  structured_data TEXT,
  started_at      TEXT,
  ended_at        TEXT,
  created_at      TEXT NOT NULL,
  FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_calls_vapi ON calls(vapi_call_id);
CREATE INDEX IF NOT EXISTS idx_calls_campaign ON calls(campaign_id);
CREATE INDEX IF NOT EXISTS idx_calls_lead ON calls(lead_id);

CREATE TABLE IF NOT EXISTS bookings (
  id                TEXT PRIMARY KEY,
  lead_id           TEXT,
  campaign_id       TEXT,
  calcom_booking_id TEXT,
  start_time        TEXT,
  attendee_name     TEXT,
  attendee_email    TEXT,
  status            TEXT,
  raw               TEXT,
  created_at        TEXT NOT NULL,
  FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_bookings_campaign ON bookings(campaign_id);

CREATE TABLE IF NOT EXISTS dnc (
  phone      TEXT PRIMARY KEY,
  reason     TEXT,
  created_at TEXT NOT NULL
);
