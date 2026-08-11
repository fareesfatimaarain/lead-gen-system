# Phase 1 — Foundation

**Status:** complete. 116 tests passing, including 17 integration tests against a real Postgres.

Nothing in this phase contacts a prospect. There is no discovery, no enrichment, no sending, and no dialer. That is deliberate: no send path exists before the GuardrailEngine in Phase 4.

---

## Running it

```bash
cp .env.example .env
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # → CREDENTIAL_ENCRYPTION_KEY
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # → SESSION_SECRET

npm install
npm run infra:up        # Postgres on 5455, Redis on 6399
npm run db:migrate      # extensions → tables → app role → triggers → RLS
npm run db:seed         # owner@example.com / development-password
npm run dev             # http://localhost:3000
```

`npm test` runs everything. Integration tests skip themselves when `DATABASE_URL` is unset, so the suite is runnable with no infrastructure — but then it is not proving isolation, only logic.

The frozen legacy calling agent still runs independently: `npm run legacy:start`.

---

## The one thing worth reading

**A Postgres superuser bypasses row-level security even when the table has `FORCE ROW LEVEL SECURITY`.**

Every policy was written correctly, `relrowsecurity` and `relforcerowsecurity` were both true on all 25 tenant tables, and every tenant could still read every other tenant's rows. Silently. No error, no warning — the queries just returned everything.

The cause is that the `POSTGRES_USER` created by the official Docker image is a superuser with `BYPASSRLS`, and the application was connecting as it.

This was caught by `packages/db/src/rls.integration.test.ts` — seven assertions that all failed at once on their first run. Unit tests could not have caught it: the policies were fine, the schema was fine, and only a real connection as a real role reveals it.

**The fix, and the standing rule:**

- `DATABASE_ADMIN_URL` — owns the schema, runs DDL, used by `db:migrate` only.
- `DATABASE_URL` — `outreach_app`, explicitly `NOSUPERUSER NOBYPASSRLS`, used by everything at runtime.

`migrate.ts` re-asserts `NOSUPERUSER NOBYPASSRLS` on every run and aborts the migration if either has drifted, because a role that quietly gains `BYPASSRLS` disables tenant isolation everywhere at once.

Two guards keep this honest going forward:

1. The migration fails if any table with an `org_id` column lacks forced RLS. Adding a tenant table and forgetting to police it is now a migration error, not a silent leak.
2. The integration tests assert isolation both ways — reads, writes, updates, deletes, primary-key lookups, and pooled-connection claim leakage.

---

## Row-level security

**Forced on all 25 tenant tables.** Every one carries `org_id`; the policy is `org_id = app.current_org_id()` with a matching `WITH CHECK`. `app.current_org_id()` reads a transaction-local setting established by `withOrg()`, which is the only sanctioned path to tenant data. The org id comes from the server-side session — never a header, never a request body.

Because the setting is transaction-local, an unconfigured connection sees zero rows rather than all of them. Isolation fails closed.

**Not enabled on four tables:** `orgs`, `users`, `org_members`, `sessions`. This changed from the plan in `ARCHITECTURE.md`, which proposed membership-derived policies. Three things made that unworkable:

1. **Sign-in is pre-authentication.** `getSession()` looks a session up by token hash before it knows whose it is. There is no claim to filter on.
2. **Sign-up has no membership to check.** A user, an org, and a membership are created in one transaction; the first two rows are written before any membership exists.
3. **A membership policy on `org_members` recurses.** Reading `org_members` to authorize `org_members` is rejected by Postgres outright — this surfaced as `infinite recursion detected in policy`.

The compensating control is a hard boundary: those four tables are read and written by exactly one module, `apps/web/src/lib/session.ts`. **No customer data lives in them** — no prospects, no messages, no credentials. Everything that holds any is in the forced list.

---

## What shipped

| Area | Detail |
|---|---|
| Monorepo | npm workspaces. `apps/web`, `packages/{shared,db,adapters}`, `legacy/` |
| Legacy | Original Express + SQLite app frozen, still runnable, deps intact |
| Schema | 29 tables, 14 enums, forced RLS on 25, partial indexes on the hot paths |
| Migrations | Drizzle-generated + three hand-written idempotent SQL passes |
| Auth | Self-hosted sessions, scrypt passwords, opaque cookie, org-scoped RBAC |
| Vault | AES-256-GCM, split ciphertext/IV/tag, masked reads, audit log |
| Adapters | Anthropic, Vapi, SMTP, Resend — all four with real `testConnection` |
| Registry | Data-driven; the Connections page has zero per-provider markup |
| UI | App shell, ⌘K palette, dashboard, Connections, Settings, both themes |
| Tests | 116 total: 99 unit, 17 integration against real Postgres |

### Ported from the legacy MVP

Per the audit, the valuable part of the old app was operational knowledge, not infrastructure:

- **`classifyDisposition`** — the `endedReason` → disposition map, built by watching real calls. Ported verbatim with tests pinning each observed reason.
- **`extractCallState`** — normalizes a polled Vapi call and a webhook message into one shape. The multi-key fallbacks encode real observed variance between the two.
- **Phone, schedule, CSV, ids** — converted to TypeScript, extended, and now tested (they had no tests before).

Two bugs were found while porting, both by the new tests:

- `jitteredDelaySeconds(-10, -5)` returned `-7`. A negative delay schedules a send in the past, which the queue runs immediately — defeating the pacing that function exists to provide.
- `normalizePhone` with no default country code silently produced a malformed number from a national one. It now returns `null`. Guessing a country here dials a real stranger.

### Deviations from the plan

| Plan | Shipped | Why |
|---|---|---|
| Supabase Auth or Clerk | Self-hosted sessions behind an interface | Runs with zero vendor signup. Swapping is one module |
| `SCHEMA.sql` as source of truth | Drizzle schema is; `SCHEMA.sql` is design rationale | Two schemas drift; a drifted schema doc is worse than none |
| `citext` | `text` + lowercasing at the zod boundary | One fewer extension, identical behaviour |
| Membership RLS on auth tables | Documented single-writer exception | See above — it is not expressible |
| One database role | Two, admin and app | Isolation does not work otherwise |

---

## Verified end to end

A signed-in run against a production build, 15/15 checks:

- Pages render; signed-out requests to `/`, `/connections`, `/settings` all redirect rather than leaking.
- Unauthenticated `POST /api/credentials` → 401.
- A saved key is stored as ciphertext — the plaintext appears nowhere in the row, in any encoding.
- The API response carries `sk-ant…1234` and never the secret.
- **Test connection makes a real call to `api.anthropic.com`.** With a deliberately fake key it returns: *"Anthropic rejected this API key. Check it was copied in full from console.anthropic.com."* — and persists `status = failing` with the reason.
- Invalid provider config → 422 naming the field.
- Credential deletion works; both save and delete are written to `audit_log`.

---

## Known gaps carried into later phases

- **`TODO(verify)` on Vapi's webhook signing scheme.** The adapter implements both an HMAC branch and a shared-secret branch and rejects anything unverified, but which one Vapi actually uses is unconfirmed. Must be resolved before Phase 5 places a call. The legacy app's endpoints were entirely unauthenticated (audit §8.1); that does not carry forward.
- **Resend is marked `verified: false`** in the registry and shows an "unverified" badge. Written from public docs, never run against a live account from this codebase.
- **Anthropic pricing table** is hardcoded and needs re-checking each phase. Numbers that are too low make the spend cap cut off too late.
- **`libphonenumber-js`** should replace the hand-rolled E.164 validator before anything dials. Normalization is sound; validation only checks shape.
- **The `zod` / `zod/v4` split.** Agent IO schemas use `zod/v4` because that is what the Anthropic SDK's `zodOutputFormat` accepts; everything else uses classic `zod`. Zod 3.25 ships both, so this is one package boundary rather than a migration — but it is a sharp edge worth knowing about.

## Phase 2 starts with

ICP builder with live preview, Source Strategist, four source adapters, discovery runner, dedup, prospects table.
