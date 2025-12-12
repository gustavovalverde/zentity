# Repository Guidelines

## Project Structure & Module Organization

This is a polyglot monorepo. Each service lives under `apps/`:

- `apps/web/` — Next.js 16 + React 19 frontend (App Router). Source in `src/`, static assets in `public/`, unit tests in `src/**/__tests__` / `*.test.ts`, E2E in `e2e/`.
- `apps/zk/` — TypeScript/Express zero‑knowledge service and Circom circuits. Source in `src/`, circuits in `circuits/`, generated artifacts in `artifacts/`.
- `apps/fhe/` — Rust/Axum fully homomorphic encryption service. Source in `src/`.
- `apps/ocr/` and `apps/liveness/` — Python/FastAPI services. Source in `app/`, tests in `tests/`.

Shared docs are in `docs/`, and sample/test data in `fixtures/`.

## Build, Test, and Development Commands

- Full stack (recommended): `docker compose up --build` from repo root.
- Toolchain versions are pinned in `.mise.toml` (Node 20, Rust 1.91, Python 3.12).
- Web (`apps/web`): `pnpm install`, `pnpm dev` (localhost:3000), `pnpm build`, `pnpm lint`, `pnpm test`, `pnpm test:e2e`.
- ZK (`apps/zk`): `pnpm install`, `pnpm dev`, `pnpm test`, `pnpm run circuit:build:nationality`.
- FHE (`apps/fhe`): `cargo run` (port 5001), `cargo test`.
- Python services (`apps/ocr`, `apps/liveness`): `pip install -r requirements.txt`, `uvicorn app.main:app --reload --port 5004` (or 5003), `pytest`.

## Coding Style & Naming Conventions

- TypeScript/JavaScript/CSS: Biome is the formatter/linter (`biome.json`), 2‑space indentation. Prefer `camelCase` for variables/functions, `PascalCase` for React components, and `kebab-case` for route/feature folders.
- Python: follow PEP 8, 4‑space indentation, use type hints for public APIs.
- Rust: run `cargo fmt` and keep Clippy‑clean.

## Testing Guidelines

- Vitest for TS apps; name files `*.test.ts`/`*.spec.ts`.
- Playwright for web E2E (`pnpm test:e2e`).
- Pytest for Python services; name files `test_*.py`.
- Keep tests close to the module they cover and avoid storing PII in fixtures.

## Commit & Pull Request Guidelines

- Use Conventional Commits (e.g., `feat(web): add onboarding step`, `fix(liveness): handle head‑turn edge case`).
- PRs should include: clear summary, how to test, linked issues, and UI screenshots when relevant. Keep changes scoped to one service unless coordinating a cross‑service feature.

## Security & Configuration Tips

Never commit secrets. Copy `.env.example` to `.env` / `.env.local` and override service URLs or auth keys locally.

