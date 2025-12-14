# FHE Service Dockerfile
# Multi-stage build for smaller final image
# Cache bust: 2024-12-14-v2

# Build stage
FROM rust:1.91-trixie AS builder

WORKDIR /app

# Install build dependencies
RUN apt-get update && apt-get install -y \
    pkg-config \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy manifests
COPY Cargo.toml Cargo.lock* ./

# Create dummy src for dependency caching
RUN mkdir src && echo "fn main() {}" > src/main.rs

# Build dependencies only (this will be cached)
RUN cargo build --release && rm -rf src

# Copy actual source code
COPY src ./src

# Touch main.rs to force rebuild of our code (not deps)
RUN touch src/main.rs

# Build the application
RUN cargo build --release

# Runtime stage
FROM debian:bookworm-slim

WORKDIR /app

# Install runtime dependencies (curl for healthcheck, gosu for privilege drop)
RUN apt-get update && apt-get install -y \
    ca-certificates \
    curl \
    gosu \
    && rm -rf /var/lib/apt/lists/*

# Copy binary from builder
COPY --from=builder /app/target/release/fhe-service /app/fhe-service

# Create non-root user + state directory (persist via volume mount)
RUN groupadd --system --gid 1001 zentity && \
    useradd --system --uid 1001 --gid zentity zentity && \
    mkdir -p /var/lib/zentity/fhe && \
    touch /var/lib/zentity/fhe/.keep && \
    chown -R zentity:zentity /app /var/lib/zentity

# Copy startup script (handles permission fixing + privilege drop)
COPY start.sh .
RUN chmod +x start.sh

# Set environment variables
ENV RUST_LOG=info

ARG PORT=5001
ARG HOST="::"
ENV PORT=${PORT}
ENV HOST=${HOST}

EXPOSE ${PORT}

# Note: Container starts as root to fix volume permissions, then drops to zentity via gosu in start.sh

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:${PORT}/health || exit 1

CMD ["./start.sh"]
