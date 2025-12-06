FROM python:3.11-slim

WORKDIR /app

# Install system dependencies for OpenCV and DeepFace
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

# Pre-download DeepFace models to avoid runtime download
# This includes RetinaFace detector and FasNet anti-spoofing model
RUN python -c "from deepface import DeepFace; DeepFace.build_model('Facenet')" || true

# Copy application code
COPY app/ ./app/

# Copy and set up entrypoint script
COPY entrypoint.sh .
RUN chmod +x entrypoint.sh

# Expose port
ENV PORT=5003
EXPOSE 5003

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:5003/health || exit 1

# Run the application via entrypoint (warms up models first)
CMD ["./entrypoint.sh"]
