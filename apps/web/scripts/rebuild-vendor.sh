#!/usr/bin/env bash
set -euo pipefail

# Rebuild better-auth vendor tgz files from the combined feature branch.
#
# Usage:
#   ./scripts/rebuild-vendor.sh [path-to-better-auth-repo]
#
# Defaults to ../../../better-auth (sibling checkout convention).
# The script:
#   1. Checks out feat/zentity-combined
#   2. Installs dependencies
#   3. Builds all required packages
#   4. Packs each into a .tgz
#   5. Copies them into apps/web/vendor/

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VENDOR_DIR="$SCRIPT_DIR/../vendor"
BA_REPO="${1:-$(cd "$SCRIPT_DIR" && cd ../../../.. && pwd)/better-auth}"

PACKAGES=(
  packages/better-auth
  packages/core
  packages/passkey
  packages/oauth-provider
  packages/telemetry
  packages/oidc4vci
  packages/oidc4vp
  packages/oidc4ida
)

if [ ! -d "$BA_REPO/packages/better-auth" ]; then
  echo "Error: better-auth repo not found at $BA_REPO"
  echo "Usage: $0 [path-to-better-auth-repo]"
  exit 1
fi

echo "==> Using better-auth repo at: $BA_REPO"

# Save current branch to restore later
ORIGINAL_BRANCH="$(cd "$BA_REPO" && git rev-parse --abbrev-ref HEAD)"

cd "$BA_REPO"
echo "==> Checking out feat/zentity-combined..."
git checkout feat/zentity-combined

echo "==> Installing dependencies..."
pnpm install --frozen-lockfile

FILTER_ARGS=""
for pkg in "${PACKAGES[@]}"; do
  name=$(cd "$BA_REPO/$pkg" && node -p "require('./package.json').name")
  FILTER_ARGS="$FILTER_ARGS --filter=$name"
done

echo "==> Building packages..."
pnpm turbo build $FILTER_ARGS

TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

echo "==> Packing..."
for pkg in "${PACKAGES[@]}"; do
  cd "$BA_REPO/$pkg"
  pnpm pack --pack-destination "$TMPDIR"
done

echo "==> Replacing vendor tgz files..."
rm -f "$VENDOR_DIR"/better-auth-*.tgz
cp "$TMPDIR"/*.tgz "$VENDOR_DIR/"

echo "==> Restoring original branch ($ORIGINAL_BRANCH)..."
cd "$BA_REPO"
git checkout "$ORIGINAL_BRANCH"

echo ""
echo "Done. Updated vendor files:"
ls -lh "$VENDOR_DIR"/*.tgz
echo ""
echo "Remember to update version references in package.json if versions changed,"
echo "then run: pnpm install"
