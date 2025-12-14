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

# Pre-download RapidOCR models for faster startup
RUN python -c "from rapidocr import RapidOCR; RapidOCR()" || true

# Create non-root user
RUN groupadd --system --gid 1001 ocr && \
    useradd --system --uid 1001 --gid ocr --create-home --home-dir /home/ocr ocr

# Create standard runtime state/cache directories (not persisted by default)
RUN mkdir -p /var/cache/zentity/ocr /var/lib/zentity/ocr && \
    chown -R ocr:ocr /var/cache/zentity /var/lib/zentity

# Copy application code
COPY --chown=ocr:ocr app/ ./app/

# Copy and set up entrypoint script
COPY --chown=ocr:ocr entrypoint.sh .
RUN chmod +x entrypoint.sh

# Expose port
ENV PYTHONUNBUFFERED=1
ENV XDG_CACHE_HOME=/var/cache/zentity/ocr
ENV PORT=5004
EXPOSE 5004

USER ocr

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:5004/health || exit 1

# Run the application via entrypoint (warms up models first)
CMD ["./entrypoint.sh"]
