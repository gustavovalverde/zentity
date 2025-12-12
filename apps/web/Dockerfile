# Frontend Dockerfile
# Multi-stage build for Next.js with native dependencies (better-sqlite3, tfjs-node)

# Build stage - using Debian slim for glibc compatibility with tfjs-node
FROM node:20-slim AS builder

# Provided by BuildKit; used to avoid cross-arch cache poisoning for tfjs-node binaries.
ARG TARGETARCH

# Install build dependencies for native modules
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy package files
COPY package.json pnpm-lock.yaml* ./

# Install all dependencies
RUN pnpm install --frozen-lockfile

# Build TensorFlow.js native bindings (pnpm 10+ blocks postinstall scripts by default)
# This downloads pre-built binaries or compiles from source
RUN echo "Installing tfjs-node native bindings for TARGETARCH=${TARGETARCH}" && \
    NPM_ARCH="$([ "${TARGETARCH}" = "amd64" ] && echo x64 || echo "${TARGETARCH}")" && \
    export npm_config_platform=linux && \
    export npm_config_arch="${NPM_ARCH}" && \
    TFJS_DIR=$(find /app/node_modules/.pnpm -path "*/@tensorflow/tfjs-node" -type d | head -1) && \
    cd "$TFJS_DIR" && \
    export PATH="$TFJS_DIR/node_modules/.bin:$PATH" && \
    node scripts/install.js

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
RUN touch /tmp/dev.db && pnpm build

# Prune devDependencies for the runtime image.
RUN pnpm prune --prod

# Production stage - using Debian slim for glibc compatibility with tfjs-node
FROM node:20-slim AS runner

# Install runtime dependencies (sqlite3 CLI for database management)
RUN apt-get update && apt-get install -y \
    sqlite3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

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

# Replace standalone-traced `node_modules` with the pruned pnpm install from the builder.
# This preserves pnpm's symlinked dependency graph, which tfjs-node relies on at runtime.
RUN rm -rf ./node_modules
COPY --from=builder /app/node_modules ./node_modules

# Copy Human.js models into runtime (used by /human-models route and server-side Human)
COPY --from=builder /app/node_modules/@vladmandic/human-models/models ./human-models

# Copy scripts for database initialization
COPY --from=builder /app/scripts ./scripts
RUN chmod +x ./scripts/docker-entrypoint.sh

# Create data directory for persistent database storage
RUN mkdir -p ./data

# Create empty database file (will be initialized by entrypoint)
RUN touch ./dev.db ./data/dev.db

# Set correct permissions
RUN chown -R nextjs:nodejs /app

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Use entrypoint script to initialize database before starting
CMD ["./scripts/docker-entrypoint.sh"]
