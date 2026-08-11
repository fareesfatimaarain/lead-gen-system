# Outreach

An outbound lead generation system. A company configures its ICP once, and the system runs the loop:

> ICP → source selection → discovery → enrichment → research → personalized email and AI call → reply handling → a unified prospect profile with the sources behind every claim.

Nothing about the vertical is hardcoded. Behaviour comes from configuration, prompts, and source selection.

**The differentiator is restraint.** Most outbound tools optimize for volume and burn the customer's domain and phone reputation doing it. This one optimizes for prospects not being annoyed, and every design decision defers to that.

---

## Status

129 tests passing, 24 of them integration tests against a real Postgres.

| | State |
|---|---|
| Foundation — auth, tenancy, RLS, credential vault, adapter registry | Built |
| Discovery and ingest — lead sources, the worker, the job queue, dedup | Built |
| Enrichment and research | Partly built |
| GuardrailEngine | **Not started** |
| Email sending and the dialer | **Not started** |

**Nothing contacts a prospect yet, and that is deliberate.** No send path may exist before the GuardrailEngine that every outbound action has to pass through. `EmailSender` and `VoiceProvider` adapters exist and their `testConnection` calls are real, but nothing calls `send`.

The original Vapi calling agent is frozen in [legacy/](legacy/) and still runs. It stays the working system until the new stack places a real call.

[docs/PHASE1.md](docs/PHASE1.md) is the record of the foundation phase — history, not current status. Its test count and scope notes describe the point at which it was written.

---

## Quick start

Requires Node 20+ and Docker.

```bash
cp .env.example .env
```

Generate the two secrets and paste them into `.env`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # CREDENTIAL_ENCRYPTION_KEY
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # SESSION_SECRET
```

> `CREDENTIAL_ENCRYPTION_KEY` is what every stored provider key is sealed with. Rotating or losing it makes all of them undecryptable. Back it up.

```bash
npm install
npm run infra:up     # Postgres :5455, Redis :6399
npm run db:migrate
npm run db:seed      # owner@example.com / development-password
npm run dev          # http://localhost:3000
```

Then sign in and connect a provider on **Connections**. Test connection makes a real call to the provider and shows you exactly what it said.

---

## Layout

```
apps/web            Next.js — UI, CRUD routes, webhook receivers
apps/worker         the job runner: discovery, geocoding, source queries
packages/shared     zod schemas, domain types, phone/time/csv/id utils
packages/db         schema, migrations, RLS, typed client, credential vault
packages/adapters   every external provider, behind interfaces + a registry
packages/ingest     turning a raw lead into a deduplicated prospect
packages/jobs       the Postgres-backed queue, leases and backoff
legacy/             the original calling agent. Frozen, still runnable
docs/               audit, architecture, schema rationale, phase records
```

Planned but not yet created: `packages/agents`, `packages/guardrails`, `packages/orchestrator`.

The workspace packages have no build step — they export `src/*.ts` and the app transpiles them in place. One fewer artifact to keep in sync, and stack traces point at real files.

**Import rule:** no provider SDK is imported outside `packages/adapters`. Business logic depends on interfaces, never on Anthropic's or Vapi's shapes.

---

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Web app on :3000 |
| `npm run worker:dev` | The job runner, watching for changes |
| `npm test` | Full suite. Integration tests skip without `DATABASE_URL` |
| `npm run typecheck` | Type-check every package |
| `npm run lint` | ESLint across the workspace |
| `npm run build` | Production build of the web app |
| `npm run db:generate` | Regenerate migrations after a schema change |
| `npm run db:migrate` | Extensions → tables → app role → triggers → RLS |
| `npm run db:seed` | A demo workspace: one owner plus sample prospects, emails and calls |
| `npm run infra:up` / `:down` | Postgres and Redis |
| `npm run legacy:start` | The frozen calling agent |

> `npm test` reports green with no database, because the integration suites skip themselves. It is then proving logic and nothing about tenant isolation. CI fails if any test skips, so that state cannot reach a branch unnoticed.

---

## Two things to know before changing anything

**1. The app connects as an unprivileged role, on purpose.**

`DATABASE_URL` points at `outreach_app` (`NOSUPERUSER`, `NOBYPASSRLS`). `DATABASE_ADMIN_URL` owns the schema and is used only by migrations.

This is not defence in depth — it is load-bearing. A Postgres superuser bypasses row-level security *even with* `FORCE ROW LEVEL SECURITY`, so pointing `DATABASE_URL` at the admin role silently disables every tenant policy at once, with no error anywhere. It happened during this build; see [docs/PHASE1.md](docs/PHASE1.md).

**2. Adding a tenant table means adding it to the RLS list.**

Any table with an `org_id` must be listed in `packages/db/src/sql/99-rls.sql`. The migration fails if one is missing, so you will find out immediately rather than through a leak.

Adding a provider, by contrast, needs no UI work at all: one entry in `packages/adapters/src/registry.ts` plus an adapter file. The Connections page renders from the registry.

---

## Deploying

Two images from one [Dockerfile](Dockerfile), sharing a dependency layer:

```bash
docker build --target web    -t outreach-web    .
docker build --target worker -t outreach-worker .
```

Migrations are a deploy step, not something the app does at boot — two instances starting at once would otherwise race on the same DDL:

```bash
docker run --rm --env-file .env outreach-worker \
  node_modules/.bin/tsx packages/db/src/migrate.ts
```

`GET /api/health` queries Postgres and returns 503 if it cannot reach it, so an instance that is listening but has lost its database is taken out of rotation instead of serving errors. Point the load balancer at it.

The web image runs as the unprivileged `node` user and carries only the traced standalone server — no npm, no source, no build tooling.

**Redis is in `docker-compose.yml` but nothing uses it.** The job queue is Postgres-backed. It is there for a future BullMQ migration and can be dropped from a deployment today.

**Terminate TLS at a proxy that overwrites `x-forwarded-for`.** Sign-in and sign-up are rate-limited per address, and that header is the only source of one. A proxy that appends to a client-supplied value instead of replacing it lets a caller rotate their own bucket. The per-account limit still holds either way, so this weakens the defence rather than removing it.

---

## Documentation

| Document | What it covers |
|---|---|
| [docs/EXISTING_AUDIT.md](docs/EXISTING_AUDIT.md) | The original MVP: what was reused, refactored, deleted, and the security issues found |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Principles, agent layer, guardrails, orchestrator, phase plan |
| [docs/SCHEMA.sql](docs/SCHEMA.sql) | Design rationale for the data model. Superseded as source of truth by `packages/db/src/schema/` |
| [docs/PHASE1.md](docs/PHASE1.md) | What shipped in Phase 1, and every deviation from the plan |
