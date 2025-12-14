#!/bin/sh
exec uvicorn app.main:app --host "${HOST:-::}" --port "${PORT:-5004}"
