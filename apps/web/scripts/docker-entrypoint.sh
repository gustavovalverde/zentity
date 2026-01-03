#!/bin/sh
set -e

echo "[entrypoint] Starting Zentity Web service..."

# Use DATABASE_PATH env var or default to a standard state directory
DB_PATH="${DATABASE_PATH:-/var/lib/zentity/web/dev.db}"
DB_DIR=$(dirname "$DB_PATH")

echo "[entrypoint] Database path: $DB_PATH"

# Ensure CRS cache directory exists (actual warming happens in instrumentation.ts)
if [ -n "${BB_CRS_PATH:-}" ]; then
  mkdir -p "$BB_CRS_PATH" 2>/dev/null || true
fi

# Ensure the database directory exists and is writable
if [ ! -d "$DB_DIR" ]; then
  echo "[entrypoint] Creating database directory: $DB_DIR"
  mkdir -p "$DB_DIR" || echo "[entrypoint] Warning: Could not create $DB_DIR (might be mounted)"
fi

# Fix volume permissions if running as root (after files exist)
if [ "$(id -u)" = "0" ]; then
  echo "[entrypoint] Running as root, fixing volume permissions..."
  chown -R nextjs:nodejs "$DB_DIR" 2>/dev/null || true
fi

echo "[entrypoint] Schema is managed via manual drizzle-kit push (no runtime migrations)."

echo "[entrypoint] Starting Next.js server..."

# Drop to nextjs user if running as root
if [ "$(id -u)" = "0" ]; then
  exec gosu nextjs bun server.js
else
  exec bun server.js
fi
