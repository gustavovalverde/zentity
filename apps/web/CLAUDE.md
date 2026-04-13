# apps/web — directory map

Concise index for agents and humans. Deeper architecture lives in the repo root `CLAUDE.md`; code style lives in `.claude/CLAUDE.md`.

## Before writing code

1. **Glob before write.** Search `*{domain}*` in the target directory. If a file already owns the domain, read and extend it — don't create a sibling.
2. **Deep modules win.** One cohesive 1000-line file beats ten 100-line files that must be understood together. Size is never a reason to split; directive/tree-shaking/history are.
3. **`{domain}-{concern}.ts` naming.** Every filename must predict its content: `password.ts`, `well-known.ts`, `agent-schemas.ts`. No `utils.ts`, `helpers.ts`, `shared.ts`, `common.ts`.
4. **Sub-directory only with 4+ files.** A directory with one or two files is a shallow module at the directory level. Use a domain-prefixed filename at the parent level instead.
5. **No barrel files.** Import from specific files directly.

## Where things live

### `src/app/` — Next.js App Router

| Path | Purpose |
|---|---|
| `(auth)/` | Sign-in, sign-up, recovery, 2FA, magic link — route group shares provider shell |
| `(consent)/` | Standalone consent screens (no dashboard chrome): OAuth consent, MCP interactive, CIBA approve |
| `.well-known/` | OAuth/OIDC/agent discovery endpoints |
| `api/` | REST endpoints grouped by domain noun: `fhe/`, `zk/`, `ciba/`, `oauth2/`, `status/`, `rp-admin/`, `secrets/`, `ocr/`, `password/`, `assets/` |
| `api/trpc/[trpc]/` | tRPC handler — all typed API calls flow through here |
| `dashboard/` | Authenticated user area: `verify/`, `settings/`, `agents/`, `developer/`, `(web3)/` |

Co-located components live in `_components/` next to their page. Cross-route components go to `src/components/`.

### `src/lib/` — business logic

Each sub-directory is a bounded context; the filename inside identifies the concern.

| Path | Bounded context |
|---|---|
| `agents/` | Agent host/session model, capabilities, pairwise IDs, approval engine, web push |
| `assurance/` | Assurance tier computation, OIDC claims, feature gating |
| `auth/` | Better-auth config, session management, auth modes + sub-dirs per method: `eip712/`, `opaque/`, `passkey/`, `oidc/` |
| `auth/oidc/` | OIDC provider: JWT signing, disclosure, HAIP (DPoP/PAR/JARM), back-channel logout, step-up |
| `blockchain/` | FHEVM provider + hooks (`fhevm/`), on-chain attestation (`attestation/`), wagmi config |
| `db/` | Drizzle schema (`schema/`) + queries (`queries/`), one file per bounded context |
| `email/` | Resend transport + domain mailers (auth, CIBA, recovery) |
| `http/` | Rate limiting, URL safety, binary transport, API route response helpers |
| `identity/` | Verification flows: `document/` (OCR), `liveness/` (multi-gesture), `verification/` (orchestration) |
| `logging/` | Pino logger, error logger, redaction |
| `observability/` | Metrics, telemetry, request context, warmup |
| `privacy/` | `zk/` (Noir + UltraHonk), `fhe/` (TFHE keys), `secrets/` (encrypted blobs + vault), `credentials/` (passkey/OPAQUE/wallet wrapping), `primitives/` (crypto base), `bbs/` (BBS+ signatures) |
| `recovery/` | FROST threshold recovery, guardian JWT |
| `trpc/` | Server/client setup + `routers/` (one file per domain: `identity.ts`, `zk.ts`, `agent.ts`, etc.) |

### `src/components/`

- `ui/` — shadcn primitives (flat, ~31 files)
- `chrome/` — layout/branding: logo, page-header, mode-toggle
- `providers/` — top-level React providers
- Root — cross-route shared components only (`agent-approval-view.tsx`, `vault-unlock.tsx`, `tier-badge.tsx`)

## When you are tempted to split

Walk the decision procedure. If none of these holds, put it in one file.

1. **Framework boundary**: `"use client"` / `"server-only"` / worker entry.
2. **Independent heavy consumers**: disjoint importers AND side effects or heavy imports that tree-shaking can't eliminate.
3. **Independent change axes**: `git log -- <file>` shows divergent commit history for unrelated reasons.

## Testing

- Unit tests: `pnpm test:unit [pattern]`. Config: `vitest.unit.config.mts`.
- Integration tests: `pnpm test:integration`. Config: `vitest.config.mts`.
- E2E: `pnpm test:e2e` (Playwright). See root `CLAUDE.md` for Hardhat vs Sepolia env.
- Type check + lint: `pnpm check-all` before sending a PR.
- Tests live in `__tests__/` sub-directories, co-located with the code under test.

## Pointers

- Repo-wide architecture, data flow, deployment: `../../CLAUDE.md`
- TypeScript / React style rules enforced by Biome: `.claude/CLAUDE.md`
- Detailed feature docs: `../../docs/`
