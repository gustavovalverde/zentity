#!/usr/bin/env bash
set -euo pipefail

# Rebuild the vendored Better Auth plugin tarballs from the fork branch.
#
# Usage:
#   ./scripts/rebuild-vendor.sh [path-to-better-auth-repo]
#   BETTER_AUTH_BRANCH=<branch> ./scripts/rebuild-vendor.sh [path-to-better-auth-repo]
#
# Defaults to ../../../better-auth (sibling checkout convention) and the
# feat/first-party-apps-plugin branch, the only one that holds all four
# plugins.
# The script:
#   1. Checks out the fork branch
#   2. Installs dependencies
#   3. Builds the vendored plugins
#   4. Packs each into a .tgz
#   5. Copies them into apps/web/vendor/

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VENDOR_DIR="$SCRIPT_DIR/../vendor"
BA_REPO="${1:-$(cd "$SCRIPT_DIR" && cd ../../../.. && pwd)/better-auth}"
BRANCH="${BETTER_AUTH_BRANCH:-feat/first-party-apps-plugin}"

PACKAGES=(
  packages/first-party-apps
  packages/haip
  packages/oidc4vci
  packages/oidc4vp
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
echo "==> Checking out $BRANCH..."
git checkout "$BRANCH"
trap 'cd "$BA_REPO" && git checkout --quiet "$ORIGINAL_BRANCH"' EXIT

for pkg in "${PACKAGES[@]}"; do
  if [ ! -f "$BA_REPO/$pkg/package.json" ]; then
    echo "Error: $BRANCH has no $pkg. Set BETTER_AUTH_BRANCH to a branch with all of: ${PACKAGES[*]}"
    exit 1
  fi
done

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
trap 'rm -rf "$TMPDIR"; cd "$BA_REPO" && git checkout --quiet "$ORIGINAL_BRANCH"' EXIT

echo "==> Packing..."
for pkg in "${PACKAGES[@]}"; do
  cd "$BA_REPO/$pkg"
  pnpm pack --pack-destination "$TMPDIR"
done

echo "==> Replacing vendor tgz files..."
rm -f "$VENDOR_DIR"/better-auth-*.tgz
cp "$TMPDIR"/*.tgz "$VENDOR_DIR/"

echo ""
echo "Done. Updated vendor files:"
ls -lh "$VENDOR_DIR"/*.tgz
echo ""
echo "Remember to update version references in package.json if versions changed,"
echo "record the commit and sha256 values in vendor/README.md, then run: pnpm install"
