# Repository Guidelines

## Project Structure & Module Organization

This is a polyglot monorepo. Each service lives under `apps/`:

- `apps/web/` — Next.js 16 + React 19 frontend (App Router). Source in `src/`, static assets in `public/`, unit tests in `src/**/__tests__` / `*.test.ts`, E2E in `e2e/`. Includes client-side ZK proof generation via Noir.js + Barretenberg. Noir circuits in `noir-circuits/`.
- `apps/fhe/` — Rust/Axum fully homomorphic encryption service. Source in `src/`.
- `apps/ocr/` — Python/FastAPI OCR service. Source in `app/`, tests in `tests/`.

Shared docs are in `docs/`, and sample/test data in `fixtures/`.

## Build, Test, and Development Commands

- Full stack (recommended): `docker compose up --build` from repo root.
- Toolchain versions are pinned in `.mise.toml` (Node 24, Bun 1.3, Rust 1.91, Python 3.12).
- Web (`apps/web`): `bun install`, `bun run dev` (localhost:3000), `bun run build`, `bun run lint`, `bun run test`, `bun run test:e2e`, `bun run circuits:compile` (Noir), `bun run circuits:test`.
- FHE (`apps/fhe`): `cargo run` (port 5001), `cargo test`.
- OCR (`apps/ocr`): `pip install -e '.[test]'`, `PYTHONPATH=src uvicorn ocr_service.main:app --reload --port 5004`, `pytest`.

## Coding Style & Naming Conventions

- TypeScript/JavaScript/CSS: Biome is the formatter/linter (`biome.json`), 2‑space indentation. Prefer `camelCase` for variables/functions, `PascalCase` for React components, and `kebab-case` for route/feature folders.
- Python: follow PEP 8, 4‑space indentation, use type hints for public APIs.
- Rust: run `cargo fmt` and keep Clippy‑clean.

## Testing Guidelines

- Vitest for TS apps; name files `*.test.ts`/`*.spec.ts`.
- Playwright for web E2E (`bun run test:e2e`).
- Pytest for Python services; name files `test_*.py`.
- Keep tests close to the module they cover and avoid storing PII in fixtures.

## Commit & Pull Request Guidelines

- Use Conventional Commits (e.g., `feat(web): add onboarding step`, `fix(liveness): handle head‑turn edge case`).
- PRs should include: clear summary, how to test, linked issues, and UI screenshots when relevant. Keep changes scoped to one service unless coordinating a cross‑service feature.

## Security & Configuration Tips

Never commit secrets. Copy `.env.example` to `.env` / `.env.local` and override service URLs or auth keys locally.

## Database (Drizzle)

- Schema source of truth: `apps/web/src/lib/db/schema/`.
- Apply schema via `bun run db:push` (no runtime migrations; containers do not run drizzle-kit).
- Local + Docker Compose: create or reset `apps/web/.data/dev.db` with `DATABASE_PATH=./apps/web/.data/dev.db bun run db:push` before `docker compose up`.
- Railway (container): volumes are mounted at start; run `bun run db:push` as part of the start command or a one-off job with `DATABASE_PATH=$RAILWAY_VOLUME_MOUNT_PATH/web/dev.db`.
- `drizzle-kit push` requires a SQLite driver; in this repo we use `@libsql/client` (Bun-compatible).
- When wiping DBs, delete the SQLite file and rerun `bun run db:push` before starting the web app.

## E2E (Playwright/Synpress) - Web

E2E lives in `apps/web/e2e` and relies on a seeded SQLite DB plus MetaMask.

### Default (Hardhat, auto web server)

- Run: `cd apps/web && bun run test:e2e`
- Playwright will start its own dev server via `e2e/automation/start-web3-dev.js`:
  - Boots Hardhat node + deploys contracts from `../zama/zentity-fhevm-contracts`
  - Sets `NEXT_PUBLIC_ENABLE_HARDHAT=true`, `NEXT_PUBLIC_ENABLE_FHEVM=false`
  - Uses `apps/web/e2e/.data/e2e.db`
- If contracts repo lives elsewhere, set `E2E_CONTRACTS_PATH=/path/to/zentity-fhevm-contracts`.

### Existing dev server (port 3000)

- Start your own server with the correct envs.
- Run tests with: `E2E_EXTERNAL_WEB_SERVER=true bunx playwright test`
- **Important:** set `DATABASE_PATH` to the same file as `E2E_DATABASE_PATH` so server + tests share the same seed DB:
  - `DATABASE_PATH=apps/web/e2e/.data/e2e.db`

### Sepolia (fhEVM)

- Start server with fhEVM enabled and Hardhat disabled:
  - `NEXT_PUBLIC_ENABLE_FHEVM=true`
  - `NEXT_PUBLIC_ENABLE_HARDHAT=false`
- Required envs: `E2E_SEPOLIA=true`, `E2E_SEPOLIA_RPC_URL`, and `FHEVM_*` contract addresses + registrar key.
- Run: `E2E_EXTERNAL_WEB_SERVER=true E2E_SEPOLIA=true bunx playwright test e2e/web3-sepolia.spec.ts`
- The Sepolia test will **skip** if:
  - Required envs are missing, or
  - The MetaMask account has **no SepoliaETH** (grant compliance access is disabled).

### Logs / debugging

- Next dev logs: `apps/web/.next/dev/logs/next-development.log`
- If tests hang, check MetaMask popups and network balance (Sepolia requires gas).
