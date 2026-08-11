# Architecture

**Version:** 0.1 — written before Phase 1
**Companion docs:** [EXISTING_AUDIT.md](./EXISTING_AUDIT.md), [PHASE1.md](./PHASE1.md), [SCHEMA.sql](./SCHEMA.sql)

> **Phase 1 is built.** The open questions in §12 are all resolved, and several
> decisions here changed once they met a real database — most importantly the
> row-level security model in §10, which does not work as described. Read
> [PHASE1.md](./PHASE1.md) for what actually shipped and why it differs.
>
> §§1–9 (principles, adapters, agents, guardrails, orchestrator) are unchanged
> and remain the plan for Phases 2–7.

Everything here is adapted to what the audit found actually exists. Where the build prompt assumed something that isn't true (a Next.js MVP), the deviation is called out explicitly.

---

## 1. Principles that decide arguments

When two designs are defensible, these break the tie. In priority order:

1. **The prospect's experience outranks the customer's volume.** Any feature that raises throughput at the cost of recipient experience does not get built. This is the product.
2. **Nothing reaches a prospect that isn't traceable to a source.** A claim in an email or a call must resolve to a `prospect_signals` row with a URL and a confidence ≥ 0.7. No exceptions, no "the model probably knows".
3. **One chokepoint per outbound channel.** Every send and every dial passes `GuardrailEngine.authorize()`. There is no second path. If you find yourself writing one, the design is wrong.
4. **Providers are replaceable; business logic is not.** No provider SDK is imported outside `packages/adapters/`. Grep-enforceable, and enforced by lint rule.
5. **Unverified is stubbed, never guessed.** An adapter for an API we haven't confirmed ships as an interface + `NotImplementedError` + `TODO(verify)` + a docs link. It does not ship as a plausible-looking fetch call.
6. **Types at every boundary.** HTTP in, provider out, LLM out, queue payloads. Zod, not `as`.

---

## 2. Stack

| Layer | Choice | Status |
|---|---|---|
| Web | Next.js 15 App Router, TypeScript strict | **New.** No existing app to fold in (audit §0) |
| UI | Tailwind + shadcn/ui, TanStack Query, TanStack Table (virtualized) | New |
| API | Next route handlers for CRUD | Replaces Express routes |
| Worker | Node + TS, BullMQ consumers | Replaces `setInterval` dialer |
| DB | Postgres + RLS | Replaces SQLite |
| Migrations | Drizzle Kit | Replaces the ad-hoc `ensureColumns()` |
| Queue | BullMQ + Redis | New |
| LLM | `packages/llm` gateway; Anthropic default, DeepSeek retained | Wraps existing DeepSeek call |
| Voice | Vapi, ported from `src/services/` | **Reused** |
| Scheduling | Cal.com, ported | **Reused** |
| Email send | Adapter: Resend / SMTP / Gmail+Outlook OAuth | New — **see §12 Q3** |
| Auth | Supabase Auth or Clerk | New — **see §12 Q2** |

**Deviation from the prompt:** the prompt lists `/packages/db`. I'm calling it `packages/db` still, but Drizzle rather than raw SQL client — it gives us the typed client the prompt asks for and generated migrations in one tool. `SCHEMA.sql` remains the human-readable source of truth and the Drizzle schema is derived from it.

**Hosting assumption:** Postgres on Supabase (RLS is native, auth is bundled, and it removes a moving part). Neon is a drop-in swap if you prefer — the only coupling is the auth choice in §12 Q2.

---

## 3. Repository layout

```
apps/
  web/                     Next.js — UI + CRUD route handlers + webhook receivers
  worker/                  BullMQ consumers; the only process that talks to prospects
packages/
  db/                      schema, migrations, RLS policies, typed client, seed
  shared/                  zod schemas, domain types, constants, phone/time/id/csv utils
  adapters/                every external provider, behind interfaces + registry
    email-send/  email-receive/  voice/  lead-source/  enrichment/
    verification/  search/  crm/  scheduling/  llm/
  agents/                  the 9 agents: prompts, IO schemas, cost ceilings
  guardrails/              GuardrailEngine + policy evaluation (own package, own tests)
  orchestrator/            sequence state machine
docs/
legacy/                    the existing Express app, frozen, still runnable
```

`legacy/` is deliberate. The current app is the only working calling system; it stays runnable until Phase 5 proves the replacement (audit §9).

**Import rule, lint-enforced:** `packages/agents`, `packages/orchestrator`, `packages/guardrails` and `apps/*` may not import a provider SDK. Only `packages/adapters/*` may.

---

## 4. Runtime topology

```
Browser ──► apps/web ──► Postgres (RLS, request-scoped org claim)
                │
                └──► Redis ──► apps/worker ──► adapters ──► providers
                                    │
Provider webhooks ──► apps/web/api/webhooks/* ──► verify sig ──► enqueue ──► worker
```

Three rules that fall out of this:

- **The web process never talks to a prospect.** No send, no dial, no enqueue-and-await from a route handler. Route handlers write rows and enqueue jobs.
- **Webhooks verify, persist raw, enqueue, return 200 fast.** No processing inline. The current code processes inline and has no signature check (audit §8.1) — both change.
- **Every job is idempotent and keyed.** BullMQ `jobId` is derived from the domain event (`send:{campaign}:{prospect}:{step}`), so a duplicate enqueue is a no-op rather than a second email.

### Job families

| Queue | Jobs | Concurrency |
|---|---|---|
| `discovery` | `source.search`, `discovery.dedupe` | per-provider rate-limited |
| `enrich` | `enrich.waterfall`, `verify.email` | high |
| `research` | `research.prospect`, `score.prospect` | medium |
| `compose` | `compose.email`, `validate.email` | medium |
| `send` | `email.send`, `mailbox.health` | **1 per mailbox**, jittered |
| `voice` | `call.place`, `call.ingest` | 1 per phone number |
| `reply` | `reply.ingest`, `reply.classify` | high |
| `orchestrate` | `sequence.tick`, `sequence.advance` | high |

---

## 5. Adapter layer

One interface per category. Every adapter is constructed from a decrypted credential, never from `process.env`.

```ts
interface LeadSource {
  readonly id: string;
  search(q: SourceQuery, ctx: AdapterCtx): Promise<RawLead[]>;
  estimateCost(q: SourceQuery): CostEstimate;
  testConnection(ctx: AdapterCtx): Promise<TestResult>;
}

interface EmailSender  { send(m: OutboundEmail, ctx): Promise<SendReceipt>; testConnection(ctx): Promise<TestResult>; }
interface EmailReceiver{ poll(since: Date, ctx): Promise<InboundEmail[]>; }
interface Enricher     { enrich(p: EnrichInput, ctx): Promise<Partial<EnrichedFields>>; }
interface EmailVerifier{ verify(email: string, ctx): Promise<VerificationResult>; }
interface VoiceProvider{ place(c: CallRequest, ctx): Promise<CallHandle>; get(id, ctx): Promise<CallState>; }
```

Every method returns Zod-parsed output. A provider that returns an unexpected shape fails loudly at the adapter boundary, not three layers up.

### Registry

`packages/adapters/registry.ts` declares each provider as data: category, display name, credential fields (name, label, type, validation, whether secret), docs URL, and a `testConnection` reference. **The Connections page renders entirely from this.** Adding a provider = one registry entry + one adapter file. Zero UI changes. This is the mechanism that satisfies §7 of the brief.

### Verification status

| Provider | Status |
|---|---|
| Vapi — `POST /call`, `GET /call/:id`, override shape, webhook message types | **Verified** by working code in `src/services/`. Ported as-is |
| Vapi — assistant-create payload, `transferCall` schema, Deepgram lang detect | **Unverified.** Three unresolved `VERIFY` comments in `vapiAssistant.js`. Re-check against docs in Phase 5 |
| Vapi — webhook signature scheme | **Unverified.** Must resolve before Phase 5 |
| Cal.com v2 bookings | **Partially verified** — header set is real, payload carries an unresolved `VERIFY` note |
| DeepSeek via OpenAI SDK | **Verified** by working code |
| Anthropic Messages API | Verified from the `claude-api` skill at implementation time, not from memory |
| Apollo / Hunter / Resend / Explorium / everything else | **Unverified. Ships stubbed** until docs are read. See §12 Q3 |

---

## 6. Agent layer

Nine agents in `packages/agents`. Each one is a directory containing `prompt.md`, `io.ts` (Zod in/out), `index.ts`, and `cost.ts` (token ceiling + model binding read from org settings).

Shared execution contract, implemented once in `packages/agents/runtime`:

1. Resolve model from org settings (per-task, not hardcoded).
2. Check org spend cap. Over cap → fail closed, alert, do not call the provider.
3. Call via `packages/adapters/llm`.
4. Zod-parse the output. On failure, **one** repair attempt with the validation error appended. On second failure, dead-letter with the raw output attached.
5. Write `agent_runs` (input, output, model, tokens, cost, latency) — this is what feeds screen 10.

| # | Agent | Notes on the interesting ones |
|---|---|---|
| 4.1 | Source Strategist | Reasons about where *this* ICP lives. Reads `source_performance` for prior yield/fit/cost and re-ranks. Outputs a per-source plan with expected yield, fit and cost |
| 4.2 | Discovery Runner | Not an LLM agent — deterministic executor. Dedupes on company domain + prospect (email ∥ linkedin_url), checks suppressions, per-provider rate limits, never blocks on one failing source |
| 4.3 | Enrichment Waterfall | Cheapest-source-first, escalate only on miss. **Email verification is a gate, not a step:** unverified or catch-all-risky → `needs_review`, never into a sequence |
| 4.4 | Research Agent | Writes `prospect_signals` only. Every row needs `source_url` + `confidence`. No source → the signal is discarded, not stored with a null |
| 4.5 | Scoring Agent | Per-criterion breakdown persisted so the UI can show *and the user can dispute* the score. Below org threshold → auto-disqualified with reason |
| 4.6 | Message Composer | See §7 |
| 4.7 | Call Agent | Builds `assistantOverrides` per prospect using the proven mechanism from `agentConfig.js`. **AI disclosure inside the first two sentences is a template invariant, not a prompt suggestion** — asserted by a test, and the current system prompt does not have it (audit §5) |
| 4.8 | Reply Handler | Any human reply → **pause all automation for that prospect, immediately**, then notify. Unsubscribe/not-interested → permanent org-wide suppression. Referral → new linked prospect. OOO → parse date, reschedule. Hard bounce → suppress + flag the enrichment source that supplied the address |
| 4.9 | Orchestrator | See §8 |

---

## 7. Message composition and validation

The composer's prompt constraints are necessary but not sufficient — a prompt can be ignored. So generation is followed by a **deterministic validator** in `packages/guardrails/content`, and the validator is the authority.

```ts
validate(draft, ctx): { ok: true } | { ok: false, violations: Violation[] }
```

Checks, all mechanical:

- word count ≤ 120 (first touch)
- ≥ 1 cited `signal_id`, and every cited signal exists with confidence ≥ 0.7
- banned-phrase list (org-configurable; ships with "quick question", "circling back", "just bumping", "hope this finds you well", "I was so impressed", "Love what you're doing at", …)
- link count, caps ratio, image ratio, text-to-link ratio, spam-trigger words → composite score under threshold
- first touch: no links, no tracking pixel, plain text only
- opt-out line present and resolvable
- follow-ups: must introduce a signal or angle not present in prior emails of the same thread — otherwise rejected

Violation → regenerate with violations appended, max 2 retries, then route to human review. The composer's reasoning trace is stored on `emails.reasoning` so the user can see why it wrote what it wrote.

**Approval Mode is on by default for every new org.** Auto-send unlocks per campaign only after 25 approvals in that org — a counter on `orgs`, checked server-side, not a UI toggle.

---

## 8. Orchestrator

A pure state machine over `(prospect, campaign, sequence)`. Pure in the strict sense: `(state, event, policy, clock) → decision[]`. No IO, no `Date.now()` inside, clock injected. That is what makes it testable, and it is the component the brief says to test hardest.

```
discovered → enriching → enriched → qualified → queued → contacted → engaged
                                        │                    │
                                        └► disqualified      ├► meeting_booked → won
                                                             └► unsubscribed | bounced | do_not_contact
```

Every tick:

1. Load prospect state + campaign policy + org settings.
2. Compute the next due step from `sequence_steps`.
3. Ask `GuardrailEngine.authorize(action)`.
4. Allowed → enqueue exactly one channel job with a deterministic `jobId`.
5. Denied → persist the reason and the retry-after. **The reason surfaces in the UI** — "why is nothing sending" must always be answerable.

Channel coordination rules (§5 of the brief) live here, as guards, not scattered:

- never call and email the same prospect on the same calendar day (prospect-local)
- no call before ≥ 1 email, unless the campaign is explicitly call-first
- call script must reference the prior email — enforced by requiring the last `emails` row as composer input
- 3+ opens without reply → promote a call
- call ended in "send me information" → next email is composed from the **transcript**, not the sequence template

---

## 9. GuardrailEngine

Its own package, its own test suite, no dependencies on the rest of the system. Single entry point:

```ts
authorize(action: OutboundAction, ctx: GuardrailCtx):
  Promise<{ allow: true } | { allow: false; rule: RuleId; reason: string; retryAfter?: Date }>
```

Rules evaluate in a fixed order, **fail-closed**, first denial wins. Grouped:

**Consent and suppression** (checked first, always) — org + global suppression list; DNC (national + org lists) before every call; permanent opt-out honoured across both channels.

**Frequency** — max touches per prospect per campaign (default 4 email / 2 call, hard ceiling); cross-campaign cooldown (default 90d); one contact per company at a time; max 2 call attempts ≥ 4 days apart; never after 2 voicemails.

**Timing** — prospect-local business hours from enriched timezone; calls 09:00–18:00 local; no weekends; no public holidays in the prospect's country; randomized intervals, never a fixed cadence.

**Reputation** — per-mailbox daily cap (default 40, 4-week ramp); mailbox rotation; auto-pause on bounce > 3% or complaints > 0.1%; SPF/DKIM/DMARC must all pass before a campaign can activate; warmup state gate.

**Content** — the validator from §7.

Two hard invariants, asserted by tests:

- No code path sends or dials without an `allow: true`. Enforced by putting the provider call behind a token that only `authorize` mints.
- A denial is never silent. Every denial writes a row and is renderable in the **Sending Health** panel — which guardrail is throttling, and why.

**Timezone/holiday data** is a dependency question — see §12 Q4.

---

## 10. Tenancy and security

- Every table carries `org_id`. RLS on every table, `USING (org_id = current_setting('app.org_id')::uuid)`.
- The org claim is set per-request from the session, server-side. Never from a header or a client-supplied body field.
- **Credential vault:** AES-256-GCM, key from the server environment (the *only* thing that stays in env — everything tenant-scoped moves to the DB, per §7 of the brief). Ciphertext + IV + auth tag stored separately. Plaintext never crosses the API boundary; the client only ever receives `sk-…4f2a`. Decryption happens in the worker at call time.
- **Webhook auth from day one.** Signature verification on every inbound provider webhook. The current unauthenticated endpoints (audit §8.1) do not get carried forward.
- `audit_log` on credential access, sending-policy changes, campaign activation, suppression edits, manual sends.

---

## 11. Testing

Not uniform coverage — weighted at the places where a bug damages a customer's sending reputation or a prospect's experience.

| Area | Depth |
|---|---|
| `packages/guardrails` | **Exhaustive.** Table-driven across every rule, boundary values, DST transitions, mailbox ramp week-by-week, fail-closed on every error path |
| `packages/orchestrator` | **Exhaustive.** Every transition, replay-idempotency, out-of-order events, clock injection, channel-coordination guards |
| ICP matching / scoring | Fixture-based, incl. disqualifier precedence and threshold edges |
| Content validator | Per-rule cases + a corpus of real spam-trigger emails that must be rejected |
| Adapters | Contract tests against recorded fixtures. No live calls in CI |
| Agents | Schema-conformance + repair-path tests. Prompt quality is reviewed, not asserted |

Vitest. CI runs typecheck + lint + tests + a migration dry-run.

---

## 12. Open questions — resolved

> All six were answered before Phase 1 began; the resolutions are recorded after
> each one. Kept rather than deleted because the reasoning still applies to the
> phases that consume these choices.

**Q1 — Frontend rewrite.** The audit found no Next.js app. My recommendation: `apps/web` is new; the existing `public/` SPA informs the IA and is not ported; the Express app is frozen in `legacy/` and keeps running until Phase 5 proves the replacement. **Confirm.**

> **Resolved: confirmed.** `apps/web` is new; `public/` informed the IA only. The Express app is frozen in `legacy/` and still runs.

**Q2 — Auth.** No auth exists. Supabase Auth (bundles with Postgres+RLS, one fewer vendor, free tier) vs Clerk (better org/role UX, paid past ~10k MAU). I lean Supabase for the RLS integration. **Your call.**

> **Resolved: neither.** Self-hosted sessions behind an interface — scrypt passwords, opaque cookie, server-side session rows. Runs with no vendor signup; swapping to Supabase or Clerk is one module.

**Q3 — Paid providers.** The brief names Apollo, Hunter, Resend, Explorium. All are paid, and the standing rule says ask before adding cost or vendor lock-in. **Phase 1 needs three working `testConnection` implementations** — I propose Vapi (already have a key), Anthropic, and one email sender. Tell me which email sender you have or want an account with, and which lead-data provider to build first in Phase 2. Everything unnamed ships stubbed.

> **Resolved: four adapters, no paid signup required.** Anthropic, Vapi, SMTP, and Resend all ship with a real `testConnection`. Resend is marked `verified: false` until it runs against a live account. Lead-data providers are deferred to Phase 2.

**Q4 — Timezone and holiday data.** Business-hours and no-holidays guardrails need a holiday dataset. Options: `date-holidays` (npm, free, MIT, broad country coverage) or a paid API. I recommend `date-holidays` — free, no lock-in, good enough. **Confirm, since it's a dependency.**

> **Resolved: deferred to Phase 4**, where the guardrail that needs it is built. `date-holidays` remains the recommendation. No dependency added yet.

**Q5 — Existing data.** Do you want the live `src/data/app.db` rows (campaigns, leads, calls, bookings, DNC) imported into the new schema as org #1, or is it disposable test data? A one-shot import script is ~an hour if you want it.

> **Resolved: disposable.** No import script. The legacy SQLite database was deleted and is gitignored.

**Q6 — LinkedIn.** The brief flags direct scraping as a legal risk and asks me to raise it before building. **Raising it: I won't build a direct LinkedIn scraper.** It breaches their ToS and carries real CFAA/GDPR exposure. LinkedIn-derived data comes from a licensed provider API or not at all. Say if you disagree and we'll talk about it, but I'd need a specific licensed source to build against.

> **Resolved: no scraper.** Licensed provider API or nothing.

---

## 13. Phase 1 scope, restated against reality

Given the audit, Phase 1 is:

1. Monorepo scaffold; existing app moved to `legacy/`, still runnable; `.gitignore`; logs and `app.db` removed from the tree.
2. `packages/db` — full schema, migrations, RLS policies on every table, typed client, seed.
3. Auth + org model + `org_members` roles (owner/operator/viewer).
4. Credential vault — AES-256-GCM, masked reads, `last_verified_at` / `last_error`.
5. Adapter registry + three real `testConnection` implementations (per Q3).
6. Connections page rendered from the registry, with live test results.
7. App shell — navigation, design tokens, dark mode, `cmd+K` scaffold, the §9 motion budget enforced in the token layer.
8. `packages/shared` — phone, schedule, ids, csv ported to TypeScript with tests.

Phase 1 explicitly does **not** include: any agent, any send, any dial, any discovery. Nothing contacts a prospect until the GuardrailEngine exists in Phase 4.
