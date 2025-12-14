FROM python:3.12-slim

WORKDIR /app

# Install system dependencies for OpenCV and image processing
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first for better caching
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Set cache location BEFORE pre-downloading models (so they're baked into correct location)
ENV XDG_CACHE_HOME=/var/cache/zentity/ocr
RUN mkdir -p /var/cache/zentity/ocr

# Pre-download RapidOCR models to the runtime cache location
RUN python -c "from rapidocr import RapidOCR; RapidOCR()"

# Create non-root user
RUN groupadd --system --gid 1001 ocr && \
    useradd --system --uid 1001 --gid ocr --create-home --home-dir /home/ocr ocr

# Create runtime directories and fix ownership of pre-downloaded models
RUN mkdir -p /var/lib/zentity/ocr && \
    chown -R ocr:ocr /var/cache/zentity /var/lib/zentity

# Copy application code
COPY --chown=ocr:ocr app/ ./app/

# Copy startup script (uses exec for proper signal handling)
COPY --chown=ocr:ocr start.sh .
RUN chmod +x start.sh

# Runtime environment
ENV PYTHONUNBUFFERED=1

ARG PORT=5004
ENV PORT=${PORT}

EXPOSE ${PORT}

USER ocr

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:${PORT}/health || exit 1

# Run uvicorn via startup script (exec form for proper signal handling)
CMD ["./start.sh"]
