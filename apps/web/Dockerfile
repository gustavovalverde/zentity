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

# Install all dependencies (including native ones)
RUN pnpm install --frozen-lockfile

# Copy source code
COPY . .

# Build arguments for NEXT_PUBLIC_* variables (must be set at build time)
ARG NEXT_PUBLIC_APP_URL=http://localhost:3000

# Set build-time environment variables
ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL}

# Build the application
RUN pnpm build

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
