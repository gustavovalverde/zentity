#!/usr/bin/env bash
set -euo pipefail

# Deploy the web service to Railway from a clean staged tree.
#
# Why staging: railway up's HTTP upload times out on multi-hundred-MB tarballs,
# and the CLI honors .gitignore (not .dockerignore) which doesn't filter
# tightly enough. We rsync only what apps/web/Dockerfile needs into a temp dir.
#
# Why repo-root context: apps/web/Dockerfile copies workspace siblings
# (packages/sdk, root pnpm-workspace.yaml). --path-as-root apps/web won't work.
#
# Usage: ./scripts/deploy-to-railway.sh [--detach]

REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
STAGE_DIR="${TMPDIR:-/tmp}/zentity-railway-deploy"
PROJECT_ID="a86ddee5-5f77-4b8c-aad3-6100e3b7575e"
SERVICE="web"
ENVIRONMENT="production"
DETACH_FLAG=""

if [[ "${1:-}" == "--detach" ]]; then
  DETACH_FLAG="--detach"
fi

echo "Staging deploy tree at $STAGE_DIR ..."
rm -rf "$STAGE_DIR"
mkdir -p "$STAGE_DIR"

cd "$REPO_ROOT"

rsync -a \
  --exclude='node_modules' --exclude='.next' --exclude='.next-prod' \
  --exclude='.cache-synpress' --exclude='.synpress-wallet-setup-dist' \
  --exclude='.data' --exclude='coverage' --exclude='playwright-report' \
  --exclude='test-results' --exclude='e2e' --exclude='.claude' \
  --exclude='.cursor' --exclude='*.tsbuildinfo' --exclude='dist' \
  --exclude='build' --exclude='public/bb' --exclude='public/fhevm' \
  --exclude='public/tfhe' --exclude='public/tfhe_bg.wasm' \
  --exclude='public/kms_lib_bg.wasm' --exclude='public/workerHelpers.js' \
  --exclude='apps' \
  apps/web "$STAGE_DIR/apps/"

rsync -a --exclude='node_modules' --exclude='dist' packages "$STAGE_DIR/"
cp package.json pnpm-lock.yaml pnpm-workspace.yaml "$STAGE_DIR/"

# Place railway.toml at the upload root so [deploy] settings (healthcheck,
# restart policy) get applied. apps/web/railway.toml is only read when the
# upload root is apps/web (--path-as-root flow).
cp apps/web/railway.toml "$STAGE_DIR/railway.toml"

echo "Stage tree size:"
du -sh "$STAGE_DIR"

cd "$STAGE_DIR"
echo "Running railway up ..."
railway up \
  --project "$PROJECT_ID" \
  --environment "$ENVIRONMENT" \
  --service "$SERVICE" \
  --message "deploy from $(git -C "$REPO_ROOT" rev-parse --short HEAD)" \
  $DETACH_FLAG \
  --verbose
