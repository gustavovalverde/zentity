# syntax=docker/dockerfile:1

# Global build arguments
ARG SOURCE_DATE_EPOCH=0
ARG GIT_SHA=unknown
ARG BUILD_TIME=unknown

# User configuration (APP_ prefix avoids system variable collision)
ARG APP_UID=10001
ARG APP_GID=${APP_UID}
ARG APP_USER=zentity
ARG APP_HOME=/app

# --- Stage 1: Builder ---
FROM rust:1.100-trixie@sha256:e19840879045c951c905d0eaa9887f3439c62000e429963371b376bac8d38c31 AS builder
SHELL ["/bin/bash", "-o", "pipefail", "-c"]

ARG APP_HOME
WORKDIR ${APP_HOME}

ARG SOURCE_DATE_EPOCH
ARG GIT_SHA
ARG BUILD_TIME
ENV SOURCE_DATE_EPOCH=${SOURCE_DATE_EPOCH}

# Install build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/* /tmp/*

# Copy manifests and the toolchain pin first for dependency caching. rustup reads
# rust-toolchain.toml, so the build uses the same compiler as CI and local development.
COPY --link Cargo.toml Cargo.lock rust-toolchain.toml ./

# Create dummy src for dependency caching
RUN mkdir src && \
    echo "fn main() {}" > src/main.rs && \
    echo "pub fn dummy() {}" > src/lib.rs

# Build dependencies only with cache mounts (this layer is cached)
# --locked ensures reproducible builds using Cargo.lock
RUN --mount=type=cache,id=s/6bb539e1-aad1-4b72-baf0-6e9253435464-/usr/local/cargo/registry,target=/usr/local/cargo/registry \
    --mount=type=cache,id=s/6bb539e1-aad1-4b72-baf0-6e9253435464-/app/target,target=${APP_HOME}/target \
    cargo build --locked --release && \
    rm -rf src

COPY --link src ./src
RUN touch src/main.rs src/lib.rs

# Build with build info (option_env! reads these at compile time)
ENV GIT_SHA=${GIT_SHA}
ENV BUILD_TIME=${BUILD_TIME}
RUN --mount=type=cache,id=s/6bb539e1-aad1-4b72-baf0-6e9253435464-/usr/local/cargo/registry,target=/usr/local/cargo/registry \
    --mount=type=cache,id=s/6bb539e1-aad1-4b72-baf0-6e9253435464-/app/target,target=${APP_HOME}/target \
    cargo build --locked --release && \
    cp ${APP_HOME}/target/release/fhe-service ${APP_HOME}/fhe-service

# --- Stage 2: Runtime ---
FROM debian:trixie-slim@sha256:a72b4433de1cf7d6bae0c4cee74d0547f58601a643b3375f070c51600d63b6b2 AS runtime

ARG APP_UID
ARG APP_GID
ARG APP_USER
ARG APP_HOME

WORKDIR ${APP_HOME}

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    gosu \
    && rm -rf /var/lib/apt/lists/* /tmp/*

COPY --link --from=builder ${APP_HOME}/fhe-service ${APP_HOME}/fhe-service

# Create non-root user (high UID/GID avoids host user namespace conflicts)
RUN groupadd --gid ${APP_GID} ${APP_USER} && \
    useradd --uid ${APP_UID} --gid ${APP_USER} --shell /sbin/nologin ${APP_USER} && \
    mkdir -p /var/lib/zentity/fhe && \
    touch /var/lib/zentity/fhe/.keep && \
    chown -R ${APP_UID}:${APP_GID} ${APP_HOME} /var/lib/zentity

COPY --link start.sh .
RUN chmod +x start.sh

ENV RUST_LOG=info

ARG PORT=5001
ENV PORT=${PORT}

EXPOSE ${PORT}

# Note: Container starts as root to fix volume permissions, then drops to ${APP_USER} via gosu

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:${PORT}/health || exit 1

CMD ["./start.sh"]
