# Calling Agent

An outbound sales-calling autopilot. Upload a CSV of leads, and the system dials
them one by one with a Vapi voice agent, classifies each lead from the conversation
with DeepSeek (Hot / Warm / Cold), and books follow-up meetings via Cal.com — all
tracked in a live control-center dashboard.

## What it does

- **CSV lead import** — auto-detects name/phone/email/company columns, normalizes
  numbers to E.164, dedupes, and rejects invalid rows.
- **Campaigns** — a named batch of leads with its own assistant, phone number,
  calling window (timezone-aware), retry policy, and start/pause/resume controls.
- **Sequential dialer** — calls one lead at a time, only within the calling window,
  retries no-answers/voicemails with backoff, and self-heals via Vapi polling if a
  webhook is missed.
- **Automatic classification** — every answered call is scored Hot/Warm/Cold with a
  reason and next action.
- **Scheduling** — the agent can book a meeting mid-call through Cal.com; bookings
  are stored and surfaced on the dashboard.
- **Compliance** — a Do-Not-Call list that every campaign respects.

## Architecture

```
Dashboard (SPA) ─ REST ─▶ Express API ─▶ SQLite (campaigns, leads, calls, bookings, dnc)
                                │
                          Dialer engine ──▶ Vapi (voice) ──▶ DeepSeek (classify)
                                ▲                                    │
                          Vapi webhooks ◀───────────────────────────┘
                       (status-update, end-of-call, tools ─▶ Cal.com)
```

Key modules:

- `src/db/` — SQLite connection + schema.
- `src/repositories/` — data access (campaigns, leads, calls, bookings, dnc).
- `src/dialer/engine.js` — the sequential calling worker.
- `src/services/callOutcome.js` — shared call finalization (disposition, classify, retry).
- `src/routes/campaigns.js` — campaign/lead/import/overview API.
- `src/routes/webhook.js` — Vapi status + end-of-call + tool webhooks.
- `public/` — the control-center dashboard.

## Setup

```bash
npm install
cp .env.example .env   # then fill in real values
npm start
```

Open the dashboard at http://localhost:3000/dashboard

## Environment

See `.env.example`. Notable values:

- `DEEPSEEK_API_KEY` — powers classification. The Vapi assistant's live LLM uses a
  DeepSeek credential stored in the Vapi dashboard (register it once via the API).
- `VAPI_API_KEY`, `VAPI_ASSISTANT_ID`, `VAPI_PUBLIC_KEY` — Vapi voice agent.
- `VAPI_PHONE_NUMBER_ID` — **required for outbound calling.** Provision a phone
  number in Vapi and paste its ID here (or per-campaign in Settings).
- `WEBHOOK_PUBLIC_URL` — your public tunnel (e.g. cloudflared) so Vapi can deliver
  call results to `/webhook/end-of-call` and `/webhook/tools`.
- `DEFAULT_COUNTRY_CODE` — digits only (e.g. `92`), used to normalize national
  numbers during CSV import.
- `CALCOM_*` — scheduling.

## Public webhook URL

```bash
cloudflared tunnel --url http://localhost:3000
```

Point the Vapi assistant's server URL at `{WEBHOOK_PUBLIC_URL}/webhook/end-of-call`
and the `scheduleFollowup` tool at `{WEBHOOK_PUBLIC_URL}/webhook/tools`.

## Data

SQLite database at `src/data/app.db` (created automatically).
