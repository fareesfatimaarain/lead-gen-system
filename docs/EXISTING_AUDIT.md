# Existing Codebase Audit

**Audited:** 2026-08-07
**Scope:** every file in `calling-agent-mvp` outside `node_modules`. Nothing was inferred from the README alone — every claim below is traced to a file and line.

---

## 0. Headline finding — read this before the rest

**The build prompt assumes a Next.js + TypeScript MVP exists. It does not.**

What actually exists is a **single-tenant Node CommonJS Express server** (~1,050 LOC of `src/`) serving a **vanilla-JS hash-routed SPA** (~1,350 LOC of `public/`) on **SQLite via `better-sqlite3`**. There is no TypeScript, no build step, no test suite, no auth, no `org_id` anywhere, no queue, no migrations framework, and no package boundaries.

The consequence for the plan in the build prompt:

- The monorepo line `/apps/web  Next.js app (existing MVP folds in here)` **cannot be executed literally.** There is no Next.js app to fold in.
- "Do not rebuild anything that already works" still holds — but what *works* here is **domain logic, not infrastructure.** The dialer's sequential-call semantics, the Vapi request/webhook shapes, the disposition classifier, the retry policy, the E.164 normalizer, the CSV column mapper and the calling-window math are real, working, hard-won assets. They must be ported, not reinvented.
- The persistence layer, the HTTP layer and the entire frontend **cannot survive contact with multi-tenancy.** Not because they are bad, but because every query in `src/repositories/` is written without a tenant predicate and `better-sqlite3` is synchronous and single-process, which is incompatible with RLS, a worker fleet, and 100k-row server-side pagination.

My recommendation is in §8. Short version: **port the logic, retire the shell.**

---

## 1. Inventory

### 1.1 File map

```
src/
  server.js                    Express bootstrap, static serving, dialer start
  db/index.js                  better-sqlite3 connection + ad-hoc column migrator
  db/schema.sql                5 tables, no tenancy
  dialer/engine.js             the sequential outbound dialer (setInterval loop)
  routes/api.js                status / client-config / classify
  routes/campaigns.js          campaign + lead + import + overview + DNC CRUD
  routes/webhook.js            Vapi status-update, end-of-call-report, tool calls
  repositories/                campaigns, leads, calls, bookings, dnc
  services/vapiCall.js         POST /call, GET /call/:id
  services/vapiAssistant.js    assistant creation payload (setup script only)
  services/agentConfig.js      per-campaign assistantOverrides builder
  services/callOutcome.js      shared call finalization: disposition + classify + retry
  services/deepseek.js         LLM classification via OpenAI SDK against DeepSeek
  services/calcom.js           Cal.com v2 booking
  services/storage.js          DEAD CODE — CSV append/read, never imported
  lib/csv.js                   RFC-4180-ish parser + fuzzy column mapper
  lib/phone.js                 E.164 normalization
  lib/schedule.js              timezone-aware calling window
  lib/ids.js                   prefixed UUID
  prompts/systemPrompt.js      default agent system prompt (EN/AR bilingual)
  data/app.db                  live SQLite DB (+ WAL/SHM)
  data/leads.csv               DEAD DATA — artifact of storage.js
public/
  index.html                   93 lines — app shell, sidebar, new-campaign modal
  app.js                       590 lines — the entire SPA
  styles.css                   662 lines — CSS custom-property theme, light + dark
scripts/
  setup-assistant.js           one-shot: create the Vapi assistant
  test-webhook.js              posts a fake end-of-call-report to localhost
```

Plus at repo root: `cloudflared.err.log` (**2.1 MB of committed tunnel noise**), `cloudflared.log`, `server.log`, `server.err.log`, and a real `.env` sitting next to `.env.example`.

### 1.2 HTTP surface

| Method | Path | Handler | Notes |
|---|---|---|---|
| GET | `/health` | [server.js:18](../src/server.js#L18) | |
| GET | `/dashboard` | [server.js:19](../src/server.js#L19) | serves the SPA |
| GET | `/api/status` | [api.js:45](../src/routes/api.js#L45) | env-var presence checks + capability flags |
| GET | `/api/client-config` | [api.js:72](../src/routes/api.js#L72) | **leaks `VAPI_PUBLIC_KEY` unauthenticated** |
| POST | `/api/classify` | [api.js:80](../src/routes/api.js#L80) | manual transcript classifier |
| GET | `/api/campaigns` | [campaigns.js:29](../src/routes/campaigns.js#L29) | |
| POST | `/api/campaigns` | [campaigns.js:33](../src/routes/campaigns.js#L33) | no validation |
| GET/PATCH/DELETE | `/api/campaigns/:id` | [campaigns.js:48-78](../src/routes/campaigns.js#L48-L78) | |
| POST | `/api/campaigns/:id/import` | [campaigns.js:82](../src/routes/campaigns.js#L82) | CSV text or records array |
| POST | `/api/campaigns/:id/{start,pause,resume}` | [campaigns.js:121-144](../src/routes/campaigns.js#L121-L144) | `start` has a real preflight |
| GET | `/api/campaigns/:id/{leads,calls,bookings}` | [campaigns.js:148-169](../src/routes/campaigns.js#L148-L169) | **unpaginated** |
| POST | `/api/campaigns/:id/dial-next` | [campaigns.js:172](../src/routes/campaigns.js#L172) | demo button; duplicates dialer logic |
| GET | `/api/overview` | [campaigns.js:200](../src/routes/campaigns.js#L200) | N+1 stats query per campaign |
| GET/POST | `/api/dnc` | [campaigns.js:223-228](../src/routes/campaigns.js#L223-L228) | |
| POST | `/webhook/end-of-call` | [webhook.js:34](../src/routes/webhook.js#L34) | **unauthenticated**; receives *all* Vapi server messages |
| POST | `/webhook/tools` | [webhook.js:96](../src/routes/webhook.js#L96) | **unauthenticated**; `scheduleFollowup` only |

### 1.3 Frontend routes and components

Hash-routed, no framework, no build. Router at [app.js:73](../public/app.js#L73).

| Route | Renderer | Content |
|---|---|---|
| `#/` | `renderOverview` [app.js:91](../public/app.js#L91) | 6 metric tiles, campaign cards, upcoming meetings, recent calls. Polls `/api/overview` every 5s |
| `#/campaign/:id` | `renderCampaign` [app.js:205](../public/app.js#L205) | metrics, progress, CSV import, settings, agent script editor, lead table, call + booking feeds. Polls every 4s |
| `#/dnc` | `renderDnc` [app.js:451](../public/app.js#L451) | DNC list + add |
| `#/tools` | `renderTools` [app.js:478](../public/app.js#L478) | browser web-call via Vapi web SDK, manual classifier |

"Components" are template-literal functions returning HTML strings: `metric`, `campaignCard`, `bookingRow`, `callRow`, `statusBadge`, `classBadge`, `campaignChip`, `progressBar`. Escaping is via a hand-rolled `esc()` at [app.js:7](../public/app.js#L7) applied *mostly* consistently.

---

## 2. What the Vapi integration actually does

This is the most valuable verified knowledge in the repo, because these payload shapes have been exercised against the live API.

**Outbound call** — [vapiCall.js:13-53](../src/services/vapiCall.js#L13-L53)
`POST https://api.vapi.ai/call`, bearer `VAPI_API_KEY`, body `{ assistantId, phoneNumberId, customer: { number, name }, assistantOverrides }`. Returns `{ id, status, ... }`.

**Call polling** — [vapiCall.js:55](../src/services/vapiCall.js#L55)
`GET https://api.vapi.ai/call/{id}`. Used as the reconciliation safety net for dropped webhooks.

**Per-call assistant overrides** — [agentConfig.js:23-44](../src/services/agentConfig.js#L23-L44)
`{ variableValues: {name, company, email, notes}, firstMessage, model: { messages: [{role:"system", content}] } }`. Vapi deep-merges these onto the base assistant, so provider/voice/transcriber/tools survive. **This is exactly the hook Phase 5 needs for per-prospect dynamic assistants** — the mechanism is proven, only the content needs to become research-driven.

**Assistant creation** — [vapiAssistant.js:13-119](../src/services/vapiAssistant.js#L13-L119)
Sets `serverUrl` *and* `server.url` defensively, a `transferCall` built-in tool, a `scheduleFollowup` function tool with its own `server.url`, `voice: {provider:"vapi", voiceId, version}`, `transcriber: {provider:"deepgram", model:"nova-2", language:"en"}`.
The file carries three `VERIFY AGAINST CURRENT VAPI DOCS` comments (lines 27, 46, 110) that were **never resolved.** Treat all three as open.

**Inbound webhooks** — [webhook.js:34-68](../src/routes/webhook.js#L34-L68)
One endpoint receives every server message. Handled: `status-update` (maps `queued`/`ringing`→`dialing`, `in-progress`→`in_progress`) and `end-of-call-report`. Everything else is 200-acked and dropped. Call correlation is by `message.call.id` → `calls.vapi_call_id`.

**Artifact extraction** — [callOutcome.js:31-47](../src/services/callOutcome.js#L31-L47)
Normalizes both the webhook message and a polled call object into one shape, reading `artifact.transcript`, `artifact.messages`, `analysis.summary`, `analysis.structuredData`, `artifact.recordingUrl`. The defensive multi-key fallbacks here encode real observed variance in Vapi responses — **keep them.**

**Disposition classification** — [callOutcome.js:11-58](../src/services/callOutcome.js#L11-L58)
A hand-built map of `endedReason` strings → `answered | no_answer | voicemail | failed`. This list was built by observing production and is not reproducible from docs. **Port it verbatim.**

**What it does *not* do:** no webhook signature verification, no `X-Vapi-Secret` check, no replay protection, no per-turn transcript persistence (only the flattened string), no recording download (URL only), no call-level cost capture, no `tool-calls` beyond `scheduleFollowup`, no voicemail-detection configuration, no DNC check at call time inside the webhook path.

---

## 3. State management

**Server:** none. State lives in SQLite and is read synchronously on every request. The only in-memory state is the dialer's `timer` and `ticking` re-entrancy flag ([engine.js:24-25](../src/dialer/engine.js#L24-L25)).

**Client:** none, in any structured sense. A module-scoped `cmpFilters` object [app.js:203](../public/app.js#L203), a `pollTimer` [app.js:67](../public/app.js#L67), and `VapiCtor`/`vapi` singletons. Every refresh re-fetches and re-renders `innerHTML` wholesale. There is no cache, no optimistic update, no request dedup, no stale-while-revalidate.

**Practical effect:** typing in the lead search box fires a request per keystroke ([app.js:286](../public/app.js#L286), no debounce), and the 4s poll blows away any in-flight DOM state. This is exactly what TanStack Query is for.

---

## 4. Styling system

`public/styles.css`, 662 lines, hand-written. It is better than it needs to be:

- A proper **CSS custom-property token layer** at `:root` — surfaces, text ramp, lines, primary, semantic `hot/warm/cold/skip/ok` each with a `-soft` companion, radii, three shadow tiers, focus ring, font stacks.
- A complete **`prefers-color-scheme: dark` override block** redefining the same tokens.
- Inter + JetBrains Mono loaded from Google Fonts ([index.html:9-12](../public/index.html#L9-L12)) — matches the target "one grotesque + one true monospace".

**But it is stylistically the opposite of the §9 design direction.** It is a *premium marketing dashboard*: 16px radii, layered radial-gradient page background, a gradient sidebar, `scroll-behavior: smooth`, glow shadows, emoji glyphs as iconography (`▤ 🎙 ⛔ 📅 ✅ 📵 📼`), decorative colour. The target is Linear/Stripe: 4px scale, flat surfaces, near-zero motion, colour only for state meaning, real icons.

The **token architecture** is reusable. The **token values and the visual language** are not.

---

## 5. Reusable as-is

Port these into the new packages with minimal change. They are correct, dependency-light, and encode real operational knowledge.

| Asset | Location | Destination | Why |
|---|---|---|---|
| Disposition classifier + reason lists | [callOutcome.js:11-58](../src/services/callOutcome.js#L11-L58) | `packages/adapters/voice/vapi` | Empirically derived; not in any doc |
| Vapi artifact normalizer | [callOutcome.js:31-47](../src/services/callOutcome.js#L31-L47) | same | Encodes observed response variance |
| `assistantOverrides` builder | [agentConfig.js](../src/services/agentConfig.js) | `packages/agents/call` | The exact hook for per-prospect assistants |
| E.164 normalizer | [lib/phone.js](../src/lib/phone.js) | `packages/shared/phone` | Needs `libphonenumber-js` upgrade, logic is sound |
| Calling-window math | [lib/schedule.js](../src/lib/schedule.js) | `packages/shared/time` | Correct `Intl` usage incl. midnight wrap. Extends to guardrails |
| CSV parser + fuzzy column mapper | [lib/csv.js](../src/lib/csv.js) | `packages/adapters/sources/csv` | Handles quotes/BOM/embedded newlines. Alias table is genuinely useful |
| Prefixed UUIDs | [lib/ids.js](../src/lib/ids.js) | `packages/shared/ids` | Trivial but the convention is good — keep it |
| Idempotent finalization pattern | [callOutcome.js:67-69](../src/services/callOutcome.js#L67-L69) | orchestrator | The guard-on-terminal-state idea carries straight over |
| Reconciler-as-safety-net pattern | [engine.js:132-161](../src/dialer/engine.js#L132-L161) | worker | Poll-to-recover-missed-webhooks is the right design. Reimplement on BullMQ |
| Bilingual agent system prompt | [prompts/systemPrompt.js](../src/prompts/systemPrompt.js) | `packages/agents/call/prompts` | Good structural skeleton. **Needs the §4.7 AI-disclosure rule added — it is currently absent** |
| Cal.com booking payload | [calcom.js:34-57](../src/services/calcom.js#L34-L57) | `packages/adapters/scheduling/calcom` | Carries an unresolved `VERIFY` note but the header set (`cal-api-version: 2024-06-14`) is real |
| CSS token architecture | [styles.css:6-77](../public/styles.css#L6-L77) | `apps/web` design tokens | Structure only — revalue for the target aesthetic |

### Reusable as *design precedent*, not code

- **Campaign preflight** ([campaigns.js:125-129](../src/routes/campaigns.js#L125-L129)) — refusing to start and returning a `problems[]` array is exactly the pattern the GuardrailEngine and the domain-auth gate need.
- **Env-status endpoint** ([api.js:14-43](../src/routes/api.js#L14-L43)) — the shape (`{name, key, required, set}` + `warnings[]`) is the direct ancestor of the Connections page health model. Same idea, moved from env vars to the credential vault.
- **In-app agent script editor** ([app.js:240-251](../public/app.js#L240-L251)) — the MVP already decided prompts belong in the product, not in code. Correct instinct; carry it forward.

---

## 6. Needs refactoring

| Item | Problem | Action |
|---|---|---|
| **All 5 repositories** | Zero tenant predicate. `leadsRepo.get(id)` returns any org's lead | Rewrite against Postgres with `org_id` + RLS. Not salvageable in place |
| **`db/index.js` migrator** | `ensureColumns()` hand-rolls ALTERs at boot ([index.js:21-34](../src/db/index.js#L21-L34)). No version table, no down, no ordering | Replace with a real migration tool |
| **`dialer/engine.js`** | Correct semantics, wrong runtime. `setInterval` in the web process; a second instance double-dials; `hasInFlight` is a read-then-act race; `reconcileInFlight` pulls 200 calls per lead per tick ([engine.js:138](../src/dialer/engine.js#L138)) | Re-express as BullMQ jobs in `apps/worker`. Keep the state machine, discard the loop |
| **`services/deepseek.js`** | Provider hardcoded; `JSON.parse` with no schema ([deepseek.js:45-63](../src/services/deepseek.js#L45-L63)); models `deepseek-v4-pro`/`-flash` hardcoded at [deepseek.js:82,93](../src/services/deepseek.js#L82); key from env | Becomes the first consumer of `lib/llm` gateway + Zod validation + repair retry. Keep the insufficient-balance degradation — that graceful-skip behaviour is good |
| **`routes/*.js`** | No input validation anywhere. `Number(b.maxAttempts)` can yield `NaN` into SQL ([campaigns.js:42](../src/routes/campaigns.js#L42)); unbounded list endpoints | Rewrite as typed handlers with Zod at every boundary |
| **`dial-next`** | Duplicates `dial()` ([campaigns.js:172-196](../src/routes/campaigns.js#L172-L196) vs [engine.js:81-119](../src/dialer/engine.js#L81-L119)) and bypasses the calling window entirely | One code path. Manual dial must still pass the GuardrailEngine |
| **`public/app.js`** | 590 lines of `innerHTML` string assembly, no build, no types, no tests | Rewrite in Next.js. The *screens* inform the new IA; the code does not port |
| **`styles.css`** | Wrong visual language (§4) | Keep token structure, revalue |

---

## 7. Must be deleted

| Path | Reason |
|---|---|
| `src/services/storage.js` | Dead. Never imported (verified by grep across `src/`). Superseded by SQLite |
| `src/data/leads.csv` | Dead data written by `storage.js`. Contains stale classification rows |
| `cloudflared.err.log` | **2.1 MB** of tunnel noise sitting in the repo |
| `cloudflared.log`, `server.log`, `server.err.log` | Runtime logs. Belong in `.gitignore` |
| `src/data/app.db`, `app.db-shm`, `app.db-wal` | Live DB in the source tree. Migrate contents out, then delete. Must be gitignored |
| `scripts/test-webhook.js` | Ad-hoc script that hits localhost. Becomes a real fixture test |
| `repositories/leads.requeueStuck` | Exported, never called ([leads.js:133](../src/repositories/leads.js#L133)) |

**`.env` is not deleted but must be handled.** There is no `.gitignore` in this repo and `git` is not initialised, so nothing has leaked to a remote — but the file holds live Vapi, DeepSeek, and Cal.com credentials in plaintext. Before `git init`: write `.gitignore`, then treat every key in it as needing rotation once it moves into the credential vault.

---

## 8. Security and correctness issues found

Ordered by severity. These are facts about the current code, not style opinions.

1. **Both webhook endpoints are unauthenticated.** [webhook.js:34,96](../src/routes/webhook.js#L34) accept any POST. Anyone who learns the tunnel URL can forge an `end-of-call-report`, poison a lead's classification, or drive `scheduleFollowup` to create Cal.com bookings at will. **Fix in Phase 5 at the latest; earlier if the tunnel stays up.**
2. **No tenancy.** Every query is global. The product cannot onboard a second customer as written.
3. **`/api/client-config` returns `VAPI_PUBLIC_KEY` to any caller** ([api.js:72](../src/routes/api.js#L72)). Public keys are lower-risk by design, but this is an unauthenticated endpoint on a public tunnel.
4. **No DNC check on the manual dial path.** [engine.js:73](../src/dialer/engine.js#L73) checks `dncRepo.has()`; `dial-next` ([campaigns.js:172](../src/routes/campaigns.js#L172)) does not. A DNC number can be dialled from the UI button.
5. **Calling window is bypassed by `dial-next`** — no `isWithinWindow` check. Same path, same fix.
6. **`applyFailedAttempt` off-by-one risk.** [engine.js:124](../src/dialer/engine.js#L124) uses `lead.attempts + 1` against a stale in-memory `lead` whose row was already incremented at [engine.js:85](../src/dialer/engine.js#L85). It happens to be correct today because `lead` is the pre-update snapshot — but it is correct by accident, and the comment at [engine.js:123](../src/dialer/engine.js#L123) is the only thing holding it together.
7. **Retry-vs-max-attempts inconsistency.** `finalizeCall` uses `lead.attempts < maxAttempts` ([callOutcome.js:108](../src/services/callOutcome.js#L108)); `applyFailedAttempt` uses `lead.attempts + 1 < maxAttempts` ([engine.js:124](../src/dialer/engine.js#L124)). The two paths disagree by one attempt.
8. **`reconcileInFlight` is O(leads × 200).** [engine.js:138](../src/dialer/engine.js#L138) fetches 200 campaign calls and filters in JS, once per in-flight lead, every tick.
9. **Unpaginated list endpoints** return every lead in a campaign. Fails the 100k-row bar by three orders of magnitude.
10. **No LLM output schema validation.** [deepseek.js:45](../src/services/deepseek.js#L45) `JSON.parse`s model output and reads properties off it.
11. **Zero tests.** No test runner, no test files, no CI.

---

## 9. What this means for the build plan

**Recommendation: port the logic, retire the shell.**

Concretely, my proposed amendment to Phase 1:

- `apps/web` is a **new** Next.js app. Nothing from `public/` moves into it as code. The four existing screens inform the new information architecture and nothing more.
- `apps/worker` is where the dialer's *semantics* land — as BullMQ jobs, not a `setInterval`.
- `packages/adapters/voice/vapi` receives `vapiCall.js` + `callOutcome.js` + `agentConfig.js`, converted to TypeScript, behind a `VoiceProvider` interface.
- `packages/shared` receives `lib/phone.js`, `lib/schedule.js`, `lib/ids.js`, `lib/csv.js`.
- The SQLite schema is **not** migrated. The new Postgres schema in `SCHEMA.sql` supersedes it; `campaigns`/`leads`/`calls`/`bookings`/`dnc` map onto `campaigns`/`prospects`/`calls`/`activities`/`suppressions` with tenancy added. A one-shot import script moves any live `app.db` rows into org #1 if you want the existing data — say the word and I will write it.
- **The existing Express app keeps running untouched during Phases 1–4.** It is the only working calling system you have. It is not decommissioned until Phase 5 has placed a real call through the new path. That is the practical meaning of "do not rebuild what works" here: don't turn it off before the replacement is proven.

**Open questions that block Phase 1** are listed in `ARCHITECTURE.md` §12, not here.
