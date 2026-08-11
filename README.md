# Outreach

An outbound lead generation system. A company configures its ICP once, and the system runs the loop:

> ICP → source selection → discovery → enrichment → research → personalized email and AI call → reply handling → a unified prospect profile with the sources behind every claim.

Nothing about the vertical is hardcoded. Behaviour comes from configuration, prompts, and source selection.

**The differentiator is restraint.** Most outbound tools optimize for volume and burn the customer's domain and phone reputation doing it. This one optimizes for prospects not being annoyed, and every design decision defers to that.

---

## Status

**Phase 1 of 7 — foundation. Complete.**

Nothing contacts a prospect yet. There is no discovery, no enrichment, no sending, and no dialer, because no send path may exist before the GuardrailEngine that every outbound action has to pass through (Phase 4).

The original Vapi calling agent is frozen in [legacy/](legacy/) and still runs. It stays the working system until Phase 5 places a real call through the new stack.

See [docs/PHASE1.md](docs/PHASE1.md) for what shipped and what changed along the way.

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
packages/shared     zod schemas, domain types, phone/time/csv/id utils
packages/db         schema, migrations, RLS, typed client, credential vault
packages/adapters   every external provider, behind interfaces + a registry
legacy/             the original calling agent. Frozen, still runnable
docs/               audit, architecture, schema rationale, phase records
```

Planned but not yet created: `apps/worker`, `packages/agents`, `packages/guardrails`, `packages/orchestrator`.

**Import rule:** no provider SDK is imported outside `packages/adapters`. Business logic depends on interfaces, never on Anthropic's or Vapi's shapes.

---

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Web app on :3000 |
| `npm test` | Full suite. Integration tests skip without `DATABASE_URL` |
| `npm run typecheck` | Type-check every package |
| `npm run db:generate` | Regenerate migrations after a schema change |
| `npm run db:migrate` | Extensions → tables → app role → triggers → RLS |
| `npm run db:seed` | One workspace and an owner. No fake prospects |
| `npm run infra:up` / `:down` | Postgres and Redis |
| `npm run legacy:start` | The frozen calling agent |

---

## Two things to know before changing anything

**1. The app connects as an unprivileged role, on purpose.**

`DATABASE_URL` points at `outreach_app` (`NOSUPERUSER`, `NOBYPASSRLS`). `DATABASE_ADMIN_URL` owns the schema and is used only by migrations.

This is not defence in depth — it is load-bearing. A Postgres superuser bypasses row-level security *even with* `FORCE ROW LEVEL SECURITY`, so pointing `DATABASE_URL` at the admin role silently disables every tenant policy at once, with no error anywhere. It happened during this build; see [docs/PHASE1.md](docs/PHASE1.md).

**2. Adding a tenant table means adding it to the RLS list.**

Any table with an `org_id` must be listed in `packages/db/src/sql/99-rls.sql`. The migration fails if one is missing, so you will find out immediately rather than through a leak.

Adding a provider, by contrast, needs no UI work at all: one entry in `packages/adapters/src/registry.ts` plus an adapter file. The Connections page renders from the registry.

---

## Documentation

| Document | What it covers |
|---|---|
| [docs/EXISTING_AUDIT.md](docs/EXISTING_AUDIT.md) | The original MVP: what was reused, refactored, deleted, and the security issues found |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Principles, agent layer, guardrails, orchestrator, phase plan |
| [docs/SCHEMA.sql](docs/SCHEMA.sql) | Design rationale for the data model. Superseded as source of truth by `packages/db/src/schema/` |
| [docs/PHASE1.md](docs/PHASE1.md) | What shipped in Phase 1, and every deviation from the plan |
