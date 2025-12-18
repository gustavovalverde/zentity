#!/usr/bin/env bash
#
# Run all code quality checks across the monorepo.
# This mirrors what pre-commit hooks and CI will run.
#
# Usage: ./scripts/check-all.sh
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

echo "========================================"
echo "Running all code quality checks"
echo "========================================"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

success() { echo -e "${GREEN}$1${NC}"; }
error() { echo -e "${RED}$1${NC}"; }
warn() { echo -e "${YELLOW}$1${NC}"; }

# Track failures
FAILED=0

# ============================================
# TypeScript/JavaScript (apps/web)
# ============================================
echo ""
echo "--- TypeScript/JavaScript (apps/web) ---"

cd "$ROOT_DIR/apps/web"

echo "Running Biome lint check..."
if bun run lint:check; then
    success "Biome (web): passed"
else
    error "Biome (web): failed"
    FAILED=1
fi

echo "Running TypeScript type-check..."
if bun run type-check; then
    success "TypeScript (web): passed"
else
    error "TypeScript (web): failed"
    FAILED=1
fi

cd "$ROOT_DIR"

echo "Running markdownlint (repo-wide)..."
if bunx markdownlint-cli "**/*.md" --ignore "**/node_modules/**" --ignore "**/venv/**" --ignore "docs/archive/**"; then
    success "Markdownlint: passed"
else
    error "Markdownlint: failed"
    FAILED=1
fi

cd "$ROOT_DIR/apps/web"

# ============================================
# TypeScript/JavaScript (apps/landing)
# ============================================
echo ""
echo "--- TypeScript/JavaScript (apps/landing) ---"

cd "$ROOT_DIR/apps/landing"

echo "Running Biome lint check..."
if bun run lint:check; then
    success "Biome (landing): passed"
else
    error "Biome (landing): failed"
    FAILED=1
fi

echo "Running TypeScript type-check..."
if bun run type-check; then
    success "TypeScript (landing): passed"
else
    error "TypeScript (landing): failed"
    FAILED=1
fi

# ============================================
# Python (apps/ocr)
# ============================================
echo ""
echo "--- Python ---"

cd "$ROOT_DIR"

echo "Running Ruff lint..."
if ruff check apps/ocr; then
    success "Ruff lint: passed"
else
    error "Ruff lint: failed"
    FAILED=1
fi

echo "Running Ruff format check..."
if ruff format --check apps/ocr; then
    success "Ruff format: passed"
else
    error "Ruff format: failed"
    FAILED=1
fi

# ============================================
# Rust (apps/fhe)
# ============================================
echo ""
echo "--- Rust ---"

echo "Running cargo fmt check..."
if cargo fmt --manifest-path apps/fhe/Cargo.toml -- --check; then
    success "cargo fmt: passed"
else
    error "cargo fmt: failed"
    FAILED=1
fi

echo "Running cargo clippy..."
if cargo clippy --manifest-path apps/fhe/Cargo.toml -- -D warnings; then
    success "cargo clippy: passed"
else
    error "cargo clippy: failed"
    FAILED=1
fi

# ============================================
# Summary
# ============================================
echo ""
echo "========================================"
if [ $FAILED -eq 0 ]; then
    success "All checks passed!"
    exit 0
else
    error "Some checks failed. Please fix the issues above."
    exit 1
fi
