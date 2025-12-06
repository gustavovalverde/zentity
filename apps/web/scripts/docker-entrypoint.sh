#!/bin/sh
set -e

# Initialize database if tables don't exist
if [ -f /app/scripts/init-db.sql ]; then
  echo "Initializing database..."
  sqlite3 /app/dev.db < /app/scripts/init-db.sql
  echo "Database initialized."
fi

# Start the application
exec node server.js
