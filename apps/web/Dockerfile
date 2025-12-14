# Frontend Dockerfile - Optimized for Railway (<4GB limit)
# Uses official Bun images and Next.js standalone output

# =============================================================================
# Stage 1: Build dependencies with native module support
# =============================================================================
FROM oven/bun:1-debian AS deps

# Build tools for tfjs-node native compilation
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json bun.lock ./

# bun install runs postinstall scripts which downloads tfjs-node binaries
RUN bun install --frozen-lockfile

# =============================================================================
# Stage 2: Build Next.js application
# =============================================================================
FROM deps AS builder

COPY . .

ARG NEXT_PUBLIC_APP_URL=http://localhost:3000
ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL}
ENV DATABASE_PATH=/tmp/dev.db
ENV BETTER_AUTH_SECRET=build-time-secret-do-not-use-32-chars-minimum!!

RUN touch /tmp/dev.db && bun run build

# =============================================================================
# Stage 3: Production runtime
# =============================================================================
FROM oven/bun:1-slim AS runner

RUN apt-get update && apt-get install -y --no-install-recommends sqlite3 gosu curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 --gid nodejs nextjs

# Copy Next.js standalone output
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Copy native modules (tfjs-node + human.js - can't be traced by standalone)
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/@tensorflow ./node_modules/@tensorflow
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/@vladmandic ./node_modules/@vladmandic

# Copy Human.js models for face detection
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/@vladmandic/human-models/models ./human-models

# Copy scripts
COPY --from=builder --chown=nextjs:nodejs /app/scripts ./scripts
RUN chmod +x ./scripts/docker-entrypoint.sh

RUN mkdir -p /var/lib/zentity/web && chown -R nextjs:nodejs /var/lib/zentity

# Note: Container starts as root to fix volume permissions, then drops to nextjs via gosu in entrypoint

ARG PORT=3000
ARG HOSTNAME="::"
ENV PORT=${PORT}
ENV HOSTNAME=${HOSTNAME}

EXPOSE ${PORT}

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:${PORT}/api/health || exit 1

CMD ["./scripts/docker-entrypoint.sh"]
