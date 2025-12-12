# Frontend Dockerfile
# Multi-stage build for Next.js with native dependencies (better-sqlite3)

# Build stage
FROM node:20-alpine AS builder

# Install build dependencies for native modules
RUN apk add --no-cache python3 make g++ libc6-compat

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy package files
COPY package.json pnpm-lock.yaml* ./

# Install all dependencies
RUN pnpm install --frozen-lockfile

# Build TensorFlow.js native bindings (pnpm 10+ blocks postinstall scripts by default)
# This downloads pre-built binaries or compiles from source
RUN TFJS_DIR=$(find /app/node_modules/.pnpm -path "*/@tensorflow/tfjs-node" -type d | head -1) && \
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

# Build the application
RUN pnpm build

# Prepare TensorFlow.js native bindings for standalone deployment
# Next.js standalone doesn't copy native .node binaries from pnpm store
RUN TFJS_PATH=$(find /app/node_modules/.pnpm -name "tfjs-node" -type d -path "*/@tensorflow/tfjs-node" | head -1) && \
    mkdir -p /app/tfjs-native && \
    if [ -n "$TFJS_PATH" ] && [ -d "$TFJS_PATH/lib" ]; then \
      cp -r "$TFJS_PATH/lib" /app/tfjs-native/; \
    fi

# Production stage
FROM node:20-alpine AS runner

# Install runtime dependencies for native modules and sqlite3 CLI
RUN apk add --no-cache libc6-compat sqlite

WORKDIR /app

# Set production environment
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Create non-root user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy necessary files from builder
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# Copy Human.js models into runtime (used by /human-models route and server-side Human)
COPY --from=builder /app/node_modules/@vladmandic/human-models/models ./human-models

# Copy TensorFlow.js native bindings for server-side Human.js
COPY --from=builder /app/tfjs-native/lib ./node_modules/@tensorflow/tfjs-node/lib

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
