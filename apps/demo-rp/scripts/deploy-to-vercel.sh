#!/usr/bin/env bash
set -euo pipefail

# Deploy demo-rp to Vercel from the repo root.
#
# The repo-root .vercel/project.json is normally linked to the `landing`
# project (per CLAUDE.md). Vercel's CLI uses that link to filter the upload,
# so we temporarily swap to demo-rp's link, deploy, then restore landing.
#
# The Vercel project's Root Directory is set to `apps/demo-rp` and the
# Install Command is `pnpm install`, so the upload goes from the repo root
# (gives Vercel access to apps/web/vendor/* tarballs and packages/sdk).
#
# Usage: ./apps/demo-rp/scripts/deploy-to-vercel.sh [--prod]

REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
LINK_FILE="$REPO_ROOT/.vercel/project.json"
LINK_BACKUP="$REPO_ROOT/.vercel/.project.json.bak"
DEMO_RP_LINK='{"projectId":"prj_3JM9PeBALtKyGJZuYByEgqqtoPmR","orgId":"team_DnXQMmVP2wIrIgA82C11jlXa","projectName":"demo-rp"}'

PROD_FLAG=""
if [[ "${1:-}" == "--prod" ]]; then
  PROD_FLAG="--prod"
fi

cd "$REPO_ROOT"

if [[ ! -f "$LINK_FILE" ]]; then
  echo "Error: $LINK_FILE not found. Run 'vercel link' from repo root first."
  exit 1
fi

cp "$LINK_FILE" "$LINK_BACKUP"
trap 'mv "$LINK_BACKUP" "$LINK_FILE" 2>/dev/null && echo "Restored link." || true' EXIT

echo "$DEMO_RP_LINK" > "$LINK_FILE"

echo "Deploying demo-rp to Vercel ${PROD_FLAG:+(prod)}..."
vercel deploy $PROD_FLAG --yes
