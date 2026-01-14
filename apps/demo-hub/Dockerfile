# syntax=docker/dockerfile:1

# Demo Hub Dockerfile
# Multi-stage build optimized for Next.js standalone output

ARG NODE_VERSION=24
ARG APP_UID=10001
ARG APP_GID=${APP_UID}
ARG APP_USER=nextjs
ARG APP_HOME=/app

# --- Stage 1: Dependencies ---
FROM node:${NODE_VERSION}-alpine AS deps

ARG APP_HOME
WORKDIR ${APP_HOME}

# Enable pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy package files for dependency caching
COPY package.json pnpm-lock.yaml* ./

# Install dependencies
RUN --mount=type=cache,id=demo-hub-pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# --- Stage 2: Builder ---
FROM deps AS builder

ARG APP_HOME
WORKDIR ${APP_HOME}

COPY . .

# Build environment variables (baked at build time)
ARG NEXT_PUBLIC_DEMO_HUB_URL=http://localhost:3100
ARG NEXT_PUBLIC_WALLET_URL=http://localhost:3101
ARG NEXT_PUBLIC_WALTID_WALLET_URL=http://localhost:7101
ARG NEXT_PUBLIC_ZENTITY_BASE_URL=http://localhost:3000

ENV NEXT_PUBLIC_DEMO_HUB_URL=${NEXT_PUBLIC_DEMO_HUB_URL}
ENV NEXT_PUBLIC_WALLET_URL=${NEXT_PUBLIC_WALLET_URL}
ENV NEXT_PUBLIC_WALTID_WALLET_URL=${NEXT_PUBLIC_WALTID_WALLET_URL}
ENV NEXT_PUBLIC_ZENTITY_BASE_URL=${NEXT_PUBLIC_ZENTITY_BASE_URL}
ENV NEXT_TELEMETRY_DISABLED=1

# Build the application
RUN pnpm build

# --- Stage 3: Runtime ---
FROM node:${NODE_VERSION}-alpine AS runner

ARG APP_UID
ARG APP_GID
ARG APP_USER
ARG APP_HOME
ARG PORT=3000

WORKDIR ${APP_HOME}

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=${PORT}
ENV HOSTNAME="0.0.0.0"

# Create non-root user
RUN addgroup --system --gid ${APP_GID} nodejs && \
    adduser --system --uid ${APP_UID} --ingroup nodejs ${APP_USER}

# Copy standalone output
COPY --from=builder --chown=${APP_UID}:${APP_GID} ${APP_HOME}/.next/standalone ./
COPY --from=builder --chown=${APP_UID}:${APP_GID} ${APP_HOME}/.next/static ./.next/static
COPY --from=builder --chown=${APP_UID}:${APP_GID} ${APP_HOME}/public ./public

USER ${APP_USER}

EXPOSE ${PORT}

# Health check (using 127.0.0.1 to avoid IPv6 resolution issues in containers)
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=3 \
    CMD wget -q --spider http://127.0.0.1:${PORT}/ || exit 1

CMD ["node", "server.js"]
