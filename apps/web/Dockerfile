# syntax=docker/dockerfile:1

# Global build arguments
ARG SOURCE_DATE_EPOCH=0
ARG GIT_SHA=unknown
ARG BUILD_TIME=unknown

# User configuration (APP_ prefix avoids system variable collision)
ARG APP_UID=10001
ARG APP_GID=${APP_UID}
ARG APP_USER=nextjs
ARG APP_HOME=/app

# --- Stage 1: Dependencies ---
FROM oven/bun:1-debian@sha256:9d9504d425a8b85c5cf162c1c354f9403e15583e0f3e1de3750ce3723d3e89ac AS deps
SHELL ["/bin/bash", "-o", "pipefail", "-c"]

ARG SOURCE_DATE_EPOCH
ARG APP_HOME

ENV SOURCE_DATE_EPOCH=${SOURCE_DATE_EPOCH}

# Build tools for tfjs-node native compilation
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/* /tmp/*

WORKDIR ${APP_HOME}

# Copy package files first for dependency caching
COPY --link package.json bun.lock ./

# Install dependencies with BuildKit cache mount for Bun
# Cache persists across builds, significantly speeds up installs
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile

# --- Stage 2: Builder ---
FROM deps AS builder
COPY --link . .

ARG GIT_SHA
ARG BUILD_TIME
ARG NEXT_PUBLIC_APP_URL=http://localhost:3000

ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL}
ENV DATABASE_PATH=/tmp/dev.db
ENV GIT_SHA=${GIT_SHA}
ENV BUILD_TIME=${BUILD_TIME}

# Build with secret mount - REQUIRED (build fails without it)
# This prevents running with insecure defaults
# Pass via: docker build --secret id=better_auth_secret,src=<file> ...
RUN --mount=type=secret,id=better_auth_secret,required=true \
    touch /tmp/dev.db && \
    BETTER_AUTH_SECRET=$(cat /run/secrets/better_auth_secret) bun run build

# --- Stage 3: Runtime ---
FROM oven/bun:1-slim@sha256:10c077f99e1d7dd7fa2947d8ed0a8c2094fa85577856062e43c8967dc97e9fc6 AS runner
SHELL ["/bin/bash", "-o", "pipefail", "-c"]

ARG GIT_SHA
ARG BUILD_TIME
ARG APP_UID
ARG APP_GID
ARG APP_USER
ARG APP_HOME

RUN apt-get update && apt-get install -y --no-install-recommends sqlite3 gosu curl \
    && rm -rf /var/lib/apt/lists/* /tmp/*

WORKDIR ${APP_HOME}

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV GIT_SHA=${GIT_SHA}
ENV BUILD_TIME=${BUILD_TIME}
ENV NODE_OPTIONS="--max-old-space-size=2048"

# Create non-root user (high UID/GID avoids host user namespace conflicts)
RUN groupadd --gid ${APP_GID} nodejs && \
    useradd --uid ${APP_UID} --gid nodejs --shell /sbin/nologin ${APP_USER}

# Copy Next.js standalone output
COPY --link --from=builder --chown=${APP_UID}:${APP_GID} ${APP_HOME}/public ./public
COPY --link --from=builder --chown=${APP_UID}:${APP_GID} ${APP_HOME}/.next/standalone ./
COPY --link --from=builder --chown=${APP_UID}:${APP_GID} ${APP_HOME}/.next/static ./.next/static

# Copy native modules (tfjs-node + human.js - can't be traced by standalone)
COPY --link --from=deps --chown=${APP_UID}:${APP_GID} ${APP_HOME}/node_modules/@tensorflow ./node_modules/@tensorflow
COPY --link --from=deps --chown=${APP_UID}:${APP_GID} ${APP_HOME}/node_modules/@vladmandic ./node_modules/@vladmandic
COPY --link --from=deps --chown=${APP_UID}:${APP_GID} ${APP_HOME}/node_modules/@vladmandic/human-models/models ./human-models

# Copy scripts
COPY --link --from=builder --chown=${APP_UID}:${APP_GID} ${APP_HOME}/scripts ./scripts
RUN chmod +x ./scripts/docker-entrypoint.sh

RUN mkdir -p /var/lib/zentity/web && chown -R ${APP_UID}:${APP_GID} /var/lib/zentity

# Note: Container starts as root to fix volume permissions, then drops to ${APP_USER} via gosu

ARG PORT=3000
ARG HOSTNAME="::"
ENV PORT=${PORT}
ENV HOSTNAME=${HOSTNAME}

EXPOSE ${PORT}

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:${PORT}/api/health || exit 1

CMD ["./scripts/docker-entrypoint.sh"]
