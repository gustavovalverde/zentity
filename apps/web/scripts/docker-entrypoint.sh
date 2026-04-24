#!/bin/sh
set -e

echo "[entrypoint] Starting Zentity Web service..."

DB_URL="${TURSO_DATABASE_URL:-file:/var/lib/zentity/web/dev.db}"
echo "[entrypoint] Database URL: $DB_URL"

DB_PATH=""
DB_DIR=""
if [ "${DB_URL#file:}" != "$DB_URL" ]; then
  DB_PATH="${DB_URL#file:}"
  if [ "$DB_PATH" != ":memory:" ] && [ "$DB_PATH" != "::memory:" ]; then
    DB_DIR=$(dirname "$DB_PATH")
  fi
fi

# Ensure CRS cache directory exists (actual warming happens in instrumentation.ts)
if [ -n "${BB_CRS_PATH:-}" ]; then
  mkdir -p "$BB_CRS_PATH" 2>/dev/null || true
fi

# Ensure the database directory exists and is writable (local file URL only).
if [ -n "$DB_DIR" ] && [ ! -d "$DB_DIR" ]; then
  echo "[entrypoint] Creating database directory: $DB_DIR"
  mkdir -p "$DB_DIR" || echo "[entrypoint] Warning: Could not create $DB_DIR (might be mounted)"
fi

# Fix volume permissions if running as root (after files exist)
if [ "$(id -u)" = "0" ]; then
  echo "[entrypoint] Running as root, fixing volume permissions..."
  if [ -n "$DB_DIR" ]; then
    chown -R nextjs:nodejs "$DB_DIR" 2>/dev/null || true
  fi
  if [ -n "${BB_CRS_PATH:-}" ]; then
    chown -R nextjs:nodejs "$BB_CRS_PATH" 2>/dev/null || true
  fi
fi

if [ "${ZENTITY_DB_PUSH_ON_START:-false}" = "true" ]; then
  if [ "${DB_URL#file:}" = "$DB_URL" ]; then
    echo "[entrypoint] ZENTITY_DB_PUSH_ON_START only supports local file: SQLite URLs."
    exit 1
  fi

  echo "[entrypoint] Applying local SQLite schema with drizzle-kit push..."
  if [ "$(id -u)" = "0" ]; then
    gosu nextjs ./node_modules/.bin/drizzle-kit push --config drizzle.config.ts
  else
    ./node_modules/.bin/drizzle-kit push --config drizzle.config.ts
  fi
else
  echo "[entrypoint] Schema push disabled; expecting database schema to exist."
fi

echo "[entrypoint] Starting Next.js server with Socket.io..."

# Drop to nextjs user if running as root
# Use tsx directly for full TypeScript support (handles path aliases via tsconfig.json)
if [ "$(id -u)" = "0" ]; then
  exec gosu nextjs ./node_modules/.bin/tsx server.mjs
else
  exec ./node_modules/.bin/tsx server.mjs
fi
