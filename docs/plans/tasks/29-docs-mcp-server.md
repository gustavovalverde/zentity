# Task 29: Documentation — MCP Server

> Source PRD: [prd-production-launch.md](../prd-production-launch.md) — Module 4
> Source plan: [documentation-sync-ciba-branch.md](../documentation-sync-ciba-branch.md) — Task 16
> Status: Complete
> Priority: P2
> User Stories: 14

## What to build

Add the MCP server to all architecture documents where services are listed. The MCP server (`apps/mcp`) is currently undocumented in the architecture tables.

**Documents to update:**

- `CLAUDE.md` (root) — service table, MCP section
- `apps/web/README.md` — if it references sibling services
- `docs/architecture.md` — service architecture table, data flow diagrams
- `docs/cryptographic-pillars.md` — if MCP touches any crypto boundary

**Key content:**

- Port 3200 (HTTP) / stdio transport
- OAuth auth chain: FPA OPAQUE 3-round, PKCE, DPoP
- Tools: whoami, my_proofs, check_compliance, purchase, request_approval
- CIBA integration for agent authorization
- Env vars: `ZENTITY_URL`, `MCP_ALLOWED_ORIGINS`

## Acceptance criteria

- [ ] MCP server appears in every service listing table in the repo
- [ ] OAuth auth chain (FPA + DPoP) documented
- [ ] All 5 MCP tools listed with brief descriptions
