#!/bin/sh
set -e

# Fix volume permissions if running as root
if [ "$(id -u)" = "0" ]; then
    chown -R zentity:zentity /var/lib/zentity 2>/dev/null || true
    exec gosu zentity /app/fhe-service
else
    exec /app/fhe-service
fi
