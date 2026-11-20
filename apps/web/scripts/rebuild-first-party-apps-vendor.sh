#!/usr/bin/env bash
set -euo pipefail

# Rebuild only the beta.11 first-party-apps archive from a disposable Better
# Auth checkout. This does not check out branches or replace other vendored
# packages.
#
# Usage:
#   ./apps/web/scripts/rebuild-first-party-apps-vendor.sh [path-to-better-auth-beta11]

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VENDOR_DIR="$SCRIPT_DIR/../vendor"
BA_REPO="${1:?Pass a clean Better Auth v1.8.0-beta.11 checkout}"
EXPECTED_COMMIT="60df7b02a309edaa611147d5fc05afe952cbd86f"
PATCH_FILE="$VENDOR_DIR/patches/better-auth-first-party-apps-beta11.patch"
TEMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TEMP_DIR"' EXIT

if [ ! -f "$BA_REPO/packages/better-auth/package.json" ]; then
	echo "Error: Better Auth checkout not found at $BA_REPO" >&2
	exit 1
fi

ACTUAL_COMMIT="$(git -C "$BA_REPO" rev-parse HEAD)"
if [ "$ACTUAL_COMMIT" != "$EXPECTED_COMMIT" ]; then
	echo "Error: expected Better Auth $EXPECTED_COMMIT, got $ACTUAL_COMMIT" >&2
	exit 1
fi

if [ -e "$BA_REPO/packages/first-party-apps" ]; then
	echo "Error: packages/first-party-apps already exists; use a clean checkout" >&2
	exit 1
fi

cd "$BA_REPO"
git apply --check "$PATCH_FILE"
git apply "$PATCH_FILE"
pnpm install --no-frozen-lockfile --filter @better-auth/first-party-apps...
pnpm exec turbo build --filter=@better-auth/first-party-apps...
pnpm --filter @better-auth/first-party-apps pack --pack-destination "$TEMP_DIR"
cp "$TEMP_DIR/better-auth-first-party-apps-1.8.0-beta.11.tgz" "$VENDOR_DIR/"

echo "Wrote $VENDOR_DIR/better-auth-first-party-apps-1.8.0-beta.11.tgz"
sha256sum "$VENDOR_DIR/better-auth-first-party-apps-1.8.0-beta.11.tgz"
