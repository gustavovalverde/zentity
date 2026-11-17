# syntax=docker/dockerfile:1

# Global build arguments
ARG SOURCE_DATE_EPOCH=0
ARG GIT_SHA=unknown
ARG BUILD_TIME=unknown

# User configuration (APP_ prefix avoids system variable collision)
ARG APP_UID=10001
ARG APP_GID=${APP_UID}
ARG APP_USER=ocr
ARG APP_HOME=/app

# --- Stage 1: Builder ---
FROM python:3.12-slim@sha256:5e2bdb1b0d542d5039cffb8181c65930093949194a65c365dfb1b0fe13a4fa5b AS builder
SHELL ["/bin/bash", "-o", "pipefail", "-c"]
WORKDIR /build

ARG SOURCE_DATE_EPOCH
ENV SOURCE_DATE_EPOCH=${SOURCE_DATE_EPOCH}
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    gcc \
    g++ \
    python3-dev \
    && rm -rf /var/lib/apt/lists/* /tmp/*

# Copy requirements first for dependency caching
COPY --link requirements.lock .

# Pre-compile wheels for all dependencies
# This separates compilation from installation, enabling better caching
RUN --mount=type=cache,id=s/c844c584-828c-402c-9dc4-ee20eb39d936-/root/.cache/pip,target=/root/.cache/pip \
    pip wheel --no-cache-dir --wheel-dir /wheels -r requirements.lock

# --- Stage 2: Runtime ---
FROM python:3.12-slim@sha256:5e2bdb1b0d542d5039cffb8181c65930093949194a65c365dfb1b0fe13a4fa5b AS runtime

ARG GIT_SHA
ARG BUILD_TIME
ARG APP_UID
ARG APP_GID
ARG APP_USER
ARG APP_HOME

WORKDIR ${APP_HOME}

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV OTEL_SERVICE_NAME=zentity-ocr

COPY --link requirements.lock .

# Copy and install pre-built wheels from builder stage
COPY --from=builder /wheels /wheels
RUN pip install --no-cache-dir --no-index --find-links /wheels -r requirements.lock \
    && rm -rf /wheels

# Set cache location BEFORE pre-downloading models
ENV XDG_CACHE_HOME=/var/cache/zentity/ocr
ENV PYTHONPATH=${APP_HOME}/src
RUN mkdir -p /var/cache/zentity/ocr

# Pre-download RapidOCR models
RUN python -c "from rapidocr import RapidOCR; RapidOCR()"

# Create non-root user (high UID/GID avoids host user namespace conflicts)
RUN groupadd --gid ${APP_GID} ${APP_USER} && \
    useradd --uid ${APP_UID} --gid ${APP_USER} --create-home --home-dir /home/${APP_USER} --shell /sbin/nologin ${APP_USER}

RUN mkdir -p /var/lib/zentity/ocr && \
    chown -R ${APP_UID}:${APP_GID} /var/cache/zentity /var/lib/zentity

COPY --link --chown=${APP_UID}:${APP_GID} src/ ./src/
COPY --link --chown=${APP_UID}:${APP_GID} start.sh .
RUN chmod +x start.sh

ENV GIT_SHA=${GIT_SHA}
ENV BUILD_TIME=${BUILD_TIME}

ARG PORT=5004
ENV PORT=${PORT}

EXPOSE ${PORT}

USER ${APP_USER}

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD ["python", "-c", "import os, urllib.request; urllib.request.urlopen(f'http://localhost:{os.environ[\"PORT\"]}/health', timeout=5)"]

# Run uvicorn via startup script (exec form for proper signal handling)
CMD ["./start.sh"]
