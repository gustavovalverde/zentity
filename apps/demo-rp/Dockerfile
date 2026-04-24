# syntax=docker/dockerfile:1

ARG APP_UID=10001
ARG REPO_HOME=/workspace/zentity
ARG APP_HOME=/workspace/zentity/apps/demo-rp

# --- Stage 1: Dependencies ---
FROM node:24-slim@sha256:b83af04d005d8e3716f542469a28ad2947ba382f6b4a76ddca0827a21446a540 AS deps
SHELL ["/bin/bash", "-o", "pipefail", "-c"]

ARG APP_HOME
ARG REPO_HOME

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR ${REPO_HOME}

COPY --link package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY --link apps/demo-rp/package.json ./apps/demo-rp/package.json
COPY --link apps/web/vendor ./apps/web/vendor
COPY --link apps/web/patches ./apps/web/patches
COPY --link packages/sdk/package.json ./packages/sdk/package.json

RUN --mount=type=cache,id=demo-rp-pnpm-store,target=/pnpm/store \
    pnpm --filter demo-rp... install --frozen-lockfile

# --- Stage 2: Builder ---
FROM deps AS builder

ARG REPO_HOME
ARG APP_HOME
ARG NEXT_PUBLIC_APP_URL=http://localhost:3102
ARG NEXT_PUBLIC_ZENTITY_URL=http://localhost:3000

COPY --link . .

RUN pnpm --filter @zentity/sdk build && pnpm --filter demo-rp build

# --- Stage 3: Runner ---
FROM node:24-slim@sha256:b83af04d005d8e3716f542469a28ad2947ba382f6b4a76ddca0827a21446a540 AS runner

ARG APP_UID
ARG APP_HOME
ARG REPO_HOME

ENV NODE_ENV=production
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV HOSTNAME="0.0.0.0"
ENV PORT=3102

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR ${REPO_HOME}

RUN adduser --system --uid ${APP_UID} nextjs

COPY --from=builder --chown=${APP_UID}:${APP_UID} ${APP_HOME}/.next/standalone ./
COPY --from=builder --chown=${APP_UID}:${APP_UID} ${APP_HOME}/.next/static ./apps/demo-rp/.next/static
COPY --from=builder --chown=${APP_UID}:${APP_UID} ${APP_HOME}/public ./apps/demo-rp/public

RUN mkdir -p ${APP_HOME}/.data && chown ${APP_UID}:${APP_UID} ${APP_HOME}/.data

WORKDIR ${APP_HOME}

USER ${APP_UID}

EXPOSE 3102

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://localhost:3102/api/health').then(r=>{if(!r.ok)throw 1}).catch(()=>process.exit(1))"]

CMD ["node", "server.js"]
