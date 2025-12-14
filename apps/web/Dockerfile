# Frontend Dockerfile
# Multi-stage build for Next.js with native dependencies (tfjs-node) and Bun runtime (bun:sqlite)

ARG TARGETARCH

FROM node:24-slim AS base

# Provided by BuildKit; used to avoid cross-arch cache poisoning for tfjs-node binaries.
ARG TARGETARCH

# Install build dependencies for native modules and Bun install
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    curl \
    bash \
    unzip \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Bun (used to run Next.js with bun:sqlite)
RUN curl -fsSL https://bun.sh/install | bash
ENV BUN_INSTALL=/root/.bun
ENV PATH=/root/.bun/bin:$PATH

FROM base AS deps
ARG TARGETARCH

# Copy package files
COPY package.json bun.lock ./

# Install all dependencies
RUN bun install --frozen-lockfile

# Build TensorFlow.js native bindings (ensures correct binary for TARGETARCH)
RUN echo "Installing tfjs-node native bindings for TARGETARCH=${TARGETARCH}" && \
    NPM_ARCH="$([ "${TARGETARCH}" = "amd64" ] && echo x64 || echo "${TARGETARCH}")" && \
    export npm_config_platform=linux && \
    export npm_config_arch="${NPM_ARCH}" && \
    TFJS_DIR=/app/node_modules/@tensorflow/tfjs-node && \
    cd "$TFJS_DIR" && \
    export PATH="/app/node_modules/.bin:$PATH" && \
    node scripts/install.js

FROM base AS builder

COPY --from=deps /app/node_modules ./node_modules

# Copy source code
COPY . .

# Build arguments for NEXT_PUBLIC_* variables (must be set at build time)
ARG NEXT_PUBLIC_APP_URL=http://localhost:3000

# Set build-time environment variables
ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL}

# Avoid runtime-only config failures during `next build` (builder stage only).
# The runner stage receives the real values via docker-compose environment.
ENV DATABASE_PATH=/tmp/dev.db
ENV BETTER_AUTH_SECRET=build-time-secret-do-not-use-32-chars-minimum!!

# Build the application
RUN touch /tmp/dev.db && bun run build

FROM base AS prod-deps
ARG TARGETARCH

COPY package.json bun.lock ./

RUN bun install --frozen-lockfile --production

# Build TensorFlow.js native bindings for production deps (runtime)
RUN echo "Installing tfjs-node native bindings (prod) for TARGETARCH=${TARGETARCH}" && \
    NPM_ARCH="$([ "${TARGETARCH}" = "amd64" ] && echo x64 || echo "${TARGETARCH}")" && \
    export npm_config_platform=linux && \
    export npm_config_arch="${NPM_ARCH}" && \
    TFJS_DIR=/app/node_modules/@tensorflow/tfjs-node && \
    cd "$TFJS_DIR" && \
    export PATH="/app/node_modules/.bin:$PATH" && \
    node scripts/install.js

# Production stage - using Debian slim for glibc compatibility with tfjs-node
FROM node:24-slim AS runner

# Install runtime dependencies (sqlite3 CLI for database management)
RUN apt-get update && apt-get install -y \
    sqlite3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy Bun runtime (needed for bun:sqlite at runtime)
COPY --from=base /root/.bun /opt/bun
ENV BUN_INSTALL=/opt/bun
ENV PATH=/opt/bun/bin:$PATH
RUN chmod -R a+rX /opt/bun

# Set production environment
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Create non-root user
RUN groupadd --system --gid 1001 nodejs
RUN useradd --system --uid 1001 --gid nodejs nextjs

# Copy necessary files from builder
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# Replace standalone-traced `node_modules` with production dependencies (ensures tfjs-node works at runtime).
RUN rm -rf ./node_modules
COPY --from=prod-deps /app/node_modules ./node_modules

# Copy Human.js models into runtime (used by /human-models route and server-side Human)
COPY --from=prod-deps /app/node_modules/@vladmandic/human-models/models ./human-models

# Copy scripts for database initialization
COPY --from=builder /app/scripts ./scripts
RUN chmod +x ./scripts/docker-entrypoint.sh

# Create data directory for persistent database storage
RUN mkdir -p /var/lib/zentity/web

# Create empty database file (will be initialized by entrypoint)
RUN touch /var/lib/zentity/web/dev.db

# Set correct permissions
RUN chown -R nextjs:nodejs /app /var/lib/zentity

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Use entrypoint script to initialize database before starting
CMD ["./scripts/docker-entrypoint.sh"]
