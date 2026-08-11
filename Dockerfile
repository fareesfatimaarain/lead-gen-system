# syntax=docker/dockerfile:1

# Two images from one file: `--target web` and `--target worker`. They share a
# dependency layer, so the second build is nearly free, and neither can drift
# onto a different Node version or a different lockfile than the other.

ARG NODE_VERSION=22-alpine

# ---------------------------------------------------------------------------
# Dependencies
#
# Only manifests are copied first. Source changes then invalidate the build
# layer without re-running npm ci, which is the difference between a ten second
# rebuild and a two minute one.
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS deps
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/adapters/package.json packages/adapters/
COPY packages/db/package.json packages/db/
COPY packages/ingest/package.json packages/ingest/
COPY packages/jobs/package.json packages/jobs/
COPY packages/shared/package.json packages/shared/
# A workspace listed in package.json must exist or npm ci refuses to resolve
# the tree, even though nothing in either image imports the legacy agent.
COPY legacy/package.json legacy/

RUN npm ci --ignore-scripts

# ---------------------------------------------------------------------------
# Production-only dependencies, for the worker runtime
#
# A separate install rather than pruning the layer above, so the build stage
# keeps its full tree. The worker lists tsx as a runtime dependency, not a dev
# one, because it genuinely runs TypeScript in production — the packages export
# `src/*.ts` and have no build step.
# ---------------------------------------------------------------------------
FROM deps AS deps-prod
# Scoped to the one workspace this image runs. Without --workspace, npm installs
# every workspace's production dependencies, and Next alone is a few hundred
# megabytes the worker never loads.
RUN npm ci --omit=dev --ignore-scripts --workspace=@outreach/worker --include-workspace-root

# ---------------------------------------------------------------------------
# Build the web app
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Next reads the root .env at config time to find shared infrastructure values.
# Nothing here needs a real one, and baking secrets into an image layer is how
# they end up in a registry — the runtime supplies them as environment.
RUN npm run build --workspace=@outreach/web

# ---------------------------------------------------------------------------
# Web runtime
#
# Carries the traced standalone server and nothing else: no npm, no source, no
# build tooling.
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS web
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Run unprivileged. The node image ships a `node` user for exactly this.
RUN mkdir -p /app && chown node:node /app
USER node

# The standalone tree mirrors the monorepo, so the server lands at
# apps/web/server.js with the traced node_modules beside it at the root.
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
# Static assets are the one thing tracing cannot infer, so they are copied
# separately. There is no public/ directory in this app; add a COPY for it here
# if one is ever introduced.
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static

EXPOSE 3000

# Checked against the endpoint that queries Postgres, so an instance that has
# lost its database is reported unhealthy rather than merely listening.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/web/server.js"]

# ---------------------------------------------------------------------------
# Worker runtime
#
# Runs TypeScript through tsx rather than a compiled bundle, matching how the
# packages are consumed everywhere else in this repo: they export `src/*.ts` and
# have no build step. One less artifact to keep in sync, and stack traces point
# at real files.
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS worker
WORKDIR /app

ENV NODE_ENV=production
USER node

COPY --from=deps-prod --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json ./
COPY --chown=node:node tsconfig.base.json ./
COPY --chown=node:node apps/worker ./apps/worker
COPY --chown=node:node packages ./packages

# tsx directly rather than `npm run --workspace=...`: this image deliberately
# carries no apps/web and no legacy/, and npm refuses to resolve a workspace
# tree whose directories are missing. The env-file flag from the npm script is
# dropped too — a container is configured by its environment.
#
# Migrations ship here as well, because this is the only image with the database
# tooling. The deploy step is:
#   docker run --rm --env-file .env <image> node_modules/.bin/tsx packages/db/src/migrate.ts
CMD ["node_modules/.bin/tsx", "apps/worker/src/index.ts"]
