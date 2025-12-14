#!/bin/sh
set -e

# Use DATABASE_PATH env var or default to a standard state directory
DB_PATH="${DATABASE_PATH:-/var/lib/zentity/web/dev.db}"

# Ensure the database directory exists
DB_DIR=$(dirname "$DB_PATH")
if [ ! -d "$DB_DIR" ]; then
  echo "Creating database directory: $DB_DIR"
  mkdir -p "$DB_DIR"
fi

# Initialize database if tables don't exist
if [ -f /app/scripts/init-db.sql ]; then
  echo "Initializing database at $DB_PATH..."
  sqlite3 "$DB_PATH" < /app/scripts/init-db.sql
  echo "Database initialized."
fi

# Start the application
exec bun server.js
