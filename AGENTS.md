# Repository Guidelines

## Project Structure & Module Organization
- `apps/web` — Next.js 16 + React 19 frontend (App Router, Tailwind 4); UI, API routes, and Playwright specs.
- `apps/zk` — TypeScript/Express Groth16 proof service; artifacts in `apps/zk/artifacts`.
- `apps/fhe` — Rust/Axum FHE age service; keys in `apps/fhe/keys`.
- `apps/liveness` and `apps/ocr` — Python/FastAPI services for face and document flows; tests under `apps/*/tests`.
- Supporting: `docs/` architecture notes, `fixtures/` sample payloads, `tooling/bruno-collection` API collection, `docker-compose.yml` orchestration.

## Setup & Tooling
- Toolchain: Node.js 20+ (pnpm), Rust 1.70+, Python 3.10+. `mise install` works if you use mise.
- Frontend env: create `apps/web/.env.local` (values in README) and keep secrets such as `BETTER_AUTH_SECRET` out of git.
- One-shot stack: `docker-compose up` (ports 3000, 5001–5004).

## Build, Test, and Development Commands
- Frontend: `cd apps/web && pnpm dev` (live), `pnpm build`, `pnpm start`, `pnpm lint`, `pnpm test`, `pnpm test:e2e`.
- ZK: `cd apps/zk && pnpm install && pnpm dev` or `pnpm build && pnpm start`.
- FHE: `cd apps/fhe && cargo build --release`; run with `cargo run --release`.
- Liveness/OCR: create venv, `pip install -r requirements.txt`, run `uvicorn app.main:app --port 5003|5004 --reload`.

## Testing Guidelines
- Frontend: Vitest (`pnpm test`) and Playwright e2e in `apps/web/e2e` (`pnpm test:e2e`). Place new component tests near `src/components`.
- Python services: pytest with coverage (`pytest --cov`); tests follow `tests/unit/test_*.py` per `pyproject.toml`.
- Rust: add unit/integration tests and run `cargo test` for `apps/fhe`.

## Coding Style & Naming Conventions
- TypeScript/React: ESLint `next/core-web-vitals`; PascalCase components, camelCase helpers, kebab-case route folders. Default to Server Components; add `"use client"` only when needed.
- Tailwind 4 available; prefer CSS variables for shared tokens.
- Python: PEP8, async FastAPI routes, use fixtures/mocks instead of external calls.
- Rust: `cargo fmt` and `cargo clippy -- -D warnings`; keep handlers/modules tidy under `src/`.

## Commit & Pull Request Guidelines
- Commit messages: imperative, optionally scoped (e.g., `web: tighten onboarding validation`, `fhe: add age proof test`). Keep changes focused.
- PRs: brief summary, tests executed, screenshots or terminal output for UI/API changes, linked issue if any, and doc updates (`docs/` or READMEs) when interfaces change.

## Security & Configuration Tips
- Never commit real IDs/PII; reuse redacted samples in `fixtures/`.
- Keep secrets (`BETTER_AUTH_SECRET`, service URLs) out of git; generated FHE keys stay under the mounted `apps/fhe/keys` volume.
- Ensure `.env.local` and any new config files stay ignored before pushing.
