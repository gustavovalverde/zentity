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
FROM node:24-slim AS deps
SHELL ["/bin/bash", "-o", "pipefail", "-c"]

ARG SOURCE_DATE_EPOCH
ARG APP_HOME

ENV SOURCE_DATE_EPOCH=${SOURCE_DATE_EPOCH}
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

# Enable pnpm via corepack
RUN corepack enable && corepack prepare pnpm@latest --activate

# Build tools for tfjs-node native compilation
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/* /tmp/*

WORKDIR ${APP_HOME}

# Copy package files first for dependency caching
COPY --link package.json pnpm-lock.yaml .npmrc ./
# Include patches needed for pnpm patchedDependencies resolution
COPY --link patches ./patches

# Install dependencies with BuildKit cache mount for pnpm
# Cache persists across builds, significantly speeds up installs
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# --- Stage 2: Builder ---
FROM deps AS builder
COPY --link . .

ARG GIT_SHA
ARG BUILD_TIME
ARG NEXT_PUBLIC_APP_URL=http://localhost:3000
ARG NEXT_PUBLIC_PROJECT_ID
ARG NEXT_PUBLIC_ENABLE_FHEVM=true
ARG NEXT_PUBLIC_ENABLE_HARDHAT=false
ARG NEXT_PUBLIC_COOP=same-origin
ARG NEXT_PUBLIC_ENABLE_COEP=true
ARG NEXT_PUBLIC_FHEVM_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
ARG NEXT_PUBLIC_FHEVM_NETWORK_ID=fhevm_sepolia
ARG NEXT_PUBLIC_FHEVM_CHAIN_ID=11155111
ARG NEXT_PUBLIC_FHEVM_NETWORK_NAME="fhEVM (Sepolia)"
ARG NEXT_PUBLIC_FHEVM_EXPLORER_URL=https://sepolia.etherscan.io
ARG NEXT_PUBLIC_FHEVM_PROVIDER_ID=zama
ARG NEXT_PUBLIC_ATTESTATION_DEMO=false
# Debug flags (baked at build time)
ARG NEXT_PUBLIC_APP_ENV=production
ARG NEXT_PUBLIC_NOIR_DEBUG=false
# Sepolia fhEVM contract addresses (from zentity-fhevm-contracts deployment)
ARG FHEVM_IDENTITY_REGISTRY=0x05c6FB879BbF0Cab2B0206523583F94E49Ba62e2
ARG FHEVM_COMPLIANCE_RULES=0x78dE340fc7A6ba470a5dD8b0a5f5933cD48dC164
ARG FHEVM_COMPLIANT_ERC20=0x2CBEF5Da4F16346bBb34C3D7a81bFC0D9882c711
# TODO: We should revert this to a secret mount once Railway supports it
# Railway injects this as build arg (multi-stage build discards it from final image)
ARG BETTER_AUTH_SECRET
ENV BETTER_AUTH_SECRET=${BETTER_AUTH_SECRET}

ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL}
ENV NEXT_PUBLIC_PROJECT_ID=${NEXT_PUBLIC_PROJECT_ID}
ENV NEXT_PUBLIC_ENABLE_FHEVM=${NEXT_PUBLIC_ENABLE_FHEVM}
ENV NEXT_PUBLIC_ENABLE_HARDHAT=${NEXT_PUBLIC_ENABLE_HARDHAT}
ENV NEXT_PUBLIC_COOP=${NEXT_PUBLIC_COOP}
ENV NEXT_PUBLIC_ENABLE_COEP=${NEXT_PUBLIC_ENABLE_COEP}
ENV NEXT_PUBLIC_FHEVM_RPC_URL=${NEXT_PUBLIC_FHEVM_RPC_URL}
ENV NEXT_PUBLIC_FHEVM_NETWORK_ID=${NEXT_PUBLIC_FHEVM_NETWORK_ID}
ENV NEXT_PUBLIC_FHEVM_CHAIN_ID=${NEXT_PUBLIC_FHEVM_CHAIN_ID}
ENV NEXT_PUBLIC_FHEVM_NETWORK_NAME=${NEXT_PUBLIC_FHEVM_NETWORK_NAME}
ENV NEXT_PUBLIC_FHEVM_EXPLORER_URL=${NEXT_PUBLIC_FHEVM_EXPLORER_URL}
ENV NEXT_PUBLIC_FHEVM_PROVIDER_ID=${NEXT_PUBLIC_FHEVM_PROVIDER_ID}
ENV NEXT_PUBLIC_ATTESTATION_DEMO=${NEXT_PUBLIC_ATTESTATION_DEMO}
ENV NEXT_PUBLIC_APP_ENV=${NEXT_PUBLIC_APP_ENV}
ENV NEXT_PUBLIC_NOIR_DEBUG=${NEXT_PUBLIC_NOIR_DEBUG}
ENV FHEVM_IDENTITY_REGISTRY=${FHEVM_IDENTITY_REGISTRY}
ENV FHEVM_COMPLIANCE_RULES=${FHEVM_COMPLIANCE_RULES}
ENV FHEVM_COMPLIANT_ERC20=${FHEVM_COMPLIANT_ERC20}
ENV GIT_SHA=${GIT_SHA}
ENV BUILD_TIME=${BUILD_TIME}

# Build Next.js
# NODE_OPTIONS increases heap size for Next build (trace generation can be memory intensive)
ENV NODE_OPTIONS="--max-old-space-size=6144"
RUN pnpm run build

# --- Stage 3: Runtime ---
FROM node:24-slim AS runner
SHELL ["/bin/bash", "-o", "pipefail", "-c"]

ARG GIT_SHA
ARG BUILD_TIME
ARG APP_UID
ARG APP_GID
ARG APP_USER
ARG APP_HOME

RUN apt-get update && apt-get install -y --no-install-recommends gosu curl ca-certificates \
    && rm -rf /var/lib/apt/lists/* /tmp/*

WORKDIR ${APP_HOME}

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV GIT_SHA=${GIT_SHA}
ENV BUILD_TIME=${BUILD_TIME}
ENV NODE_OPTIONS="--max-old-space-size=2048"
ENV BB_NODE_BINARY=/usr/bin/node
ENV BB_CRS_PATH=/var/lib/zentity/bb-crs
ENV SECRET_BLOB_DIR=/var/lib/zentity/web/secret-blobs

# Create non-root user (high UID/GID avoids host user namespace conflicts)
RUN groupadd --gid ${APP_GID} nodejs && \
    useradd --uid ${APP_UID} --gid nodejs --shell /sbin/nologin ${APP_USER}

# Copy app metadata
COPY --link --from=builder --chown=${APP_UID}:${APP_GID} ${APP_HOME}/package.json ./package.json

# Copy Next.js standalone output
COPY --link --from=builder --chown=${APP_UID}:${APP_GID} ${APP_HOME}/public ./public
COPY --link --from=builder --chown=${APP_UID}:${APP_GID} ${APP_HOME}/.next/standalone ./
COPY --link --from=builder --chown=${APP_UID}:${APP_GID} ${APP_HOME}/.next/static ./.next/static

# Copy native modules (tfjs-node + human.js - can't be traced by standalone)
COPY --link --from=deps --chown=${APP_UID}:${APP_GID} ${APP_HOME}/node_modules/@tensorflow ./node_modules/@tensorflow
COPY --link --from=deps --chown=${APP_UID}:${APP_GID} ${APP_HOME}/node_modules/@vladmandic ./node_modules/@vladmandic
# Copy bb.js (Noir/Barretenberg) assets + workers (server-side verification)
COPY --link --from=deps --chown=${APP_UID}:${APP_GID} ${APP_HOME}/node_modules/@aztec ./node_modules/@aztec
# Copy Poseidon2 dependency used by bb-worker (not traced into standalone output)
COPY --link --from=deps --chown=${APP_UID}:${APP_GID} ${APP_HOME}/node_modules/@zkpassport ./node_modules/@zkpassport
# Copy noir-lang WASM modules for client-side proof generation in Web Worker
COPY --link --from=deps --chown=${APP_UID}:${APP_GID} ${APP_HOME}/node_modules/@noir-lang ./node_modules/@noir-lang
COPY --link --from=deps --chown=${APP_UID}:${APP_GID} ${APP_HOME}/node_modules/@vladmandic/human-models/models ./human-models

# Copy scripts
COPY --link --from=builder --chown=${APP_UID}:${APP_GID} ${APP_HOME}/scripts ./scripts
RUN chmod +x ./scripts/docker-entrypoint.sh

# Copy bb-worker for server-side Noir verification (not traced into standalone output)
COPY --link --from=builder --chown=${APP_UID}:${APP_GID} ${APP_HOME}/src/lib/zk/bb-worker.mjs ./src/lib/zk/bb-worker.mjs

RUN mkdir -p /var/lib/zentity/web && chown -R ${APP_UID}:${APP_GID} /var/lib/zentity
RUN mkdir -p /var/lib/zentity/bb-crs && chown -R ${APP_UID}:${APP_GID} /var/lib/zentity/bb-crs

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
