#!/bin/sh
# Empty string host tells asyncio to bind to all interfaces (creates both IPv4 and IPv6 sockets)
# This works around Python asyncio's explicit IPV6_V6ONLY=True setting
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
export PYTHONPATH="${PYTHONPATH:-${SCRIPT_DIR}/src}"
exec uvicorn ocr_service.main:app --host "" --port "${PORT:-5004}"
