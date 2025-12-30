#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$ROOT_DIR/apps/ocr"

tmp_file="$(mktemp)"
normalized_current="$(mktemp)"
normalized_generated="$(mktemp)"
trap 'rm -f "$tmp_file" "$normalized_current" "$normalized_generated"' EXIT

pip-compile --quiet --no-strip-extras --output-file="$tmp_file" pyproject.toml >/dev/null

grep -v '^#    pip-compile ' requirements.lock > "$normalized_current"
grep -v '^#    pip-compile ' "$tmp_file" > "$normalized_generated"

if ! cmp -s "$normalized_current" "$normalized_generated"; then
  echo "apps/ocr/requirements.lock is out of date." >&2
  echo "Run: (cd apps/ocr && pip-compile --no-strip-extras --output-file=requirements.lock pyproject.toml)" >&2
  diff -u requirements.lock "$tmp_file" || true
  exit 1
fi
