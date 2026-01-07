#!/bin/sh
set -e

# Fix volume permissions if running as root
if [ "$(id -u)" = "0" ]; then
    chown -R signer:signer /var/lib/zentity 2>/dev/null || true
    exec gosu signer /app/coordinator
else
    exec /app/coordinator
fi
