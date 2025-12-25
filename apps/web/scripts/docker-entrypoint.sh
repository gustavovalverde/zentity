#!/bin/sh
set -e

echo "[entrypoint] Starting Zentity Web service..."

# Use DATABASE_PATH env var or default to a standard state directory
DB_PATH="${DATABASE_PATH:-/var/lib/zentity/web/dev.db}"
DB_DIR=$(dirname "$DB_PATH")

echo "[entrypoint] Database path: $DB_PATH"

# Optional CRS pre-warm for bb.js (best-effort)
if [ -n "${BB_CRS_PATH:-}" ]; then
  mkdir -p "$BB_CRS_PATH" 2>/dev/null || true
  if [ -z "$(ls -A "$BB_CRS_PATH" 2>/dev/null)" ]; then
    echo "[entrypoint] Pre-warming CRS cache in ${BB_CRS_PATH}..."
    node -e "import { Crs } from '@aztec/bb.js'; const crs = await Crs.new(2**14+1, process.env.BB_CRS_PATH || process.env.CRS_PATH); await crs.init(); console.log('[entrypoint] CRS cache ready');" || true
  fi
fi

# Fix volume permissions if running as root
if [ "$(id -u)" = "0" ]; then
  echo "[entrypoint] Running as root, fixing volume permissions..."
  chown -R nextjs:nodejs "$DB_DIR" 2>/dev/null || true
fi

# Ensure the database directory exists and is writable
if [ ! -d "$DB_DIR" ]; then
  echo "[entrypoint] Creating database directory: $DB_DIR"
  mkdir -p "$DB_DIR" || echo "[entrypoint] Warning: Could not create $DB_DIR (might be mounted)"
fi

# Create database file if it doesn't exist
if [ ! -f "$DB_PATH" ]; then
  echo "[entrypoint] Creating database file..."
  touch "$DB_PATH" || echo "[entrypoint] Warning: Could not create $DB_PATH"
fi

# Initialize database if tables don't exist
if [ -f /app/scripts/init-db.sql ]; then
  echo "[entrypoint] Initializing database schema..."
  sqlite3 "$DB_PATH" < /app/scripts/init-db.sql 2>&1 || echo "[entrypoint] Warning: Schema init had issues (tables may already exist)"
  echo "[entrypoint] Database initialized."
fi

echo "[entrypoint] Starting Next.js server..."

# Drop to nextjs user if running as root
if [ "$(id -u)" = "0" ]; then
  exec gosu nextjs bun server.js
else
  exec bun server.js
fi
