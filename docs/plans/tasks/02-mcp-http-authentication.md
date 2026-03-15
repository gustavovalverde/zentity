# Task 02: MCP HTTP Authentication

> Source: `security-findings-remediation.md` Finding 2
> Priority: **P0** — MCP HTTP transport creates unauthenticated sessions
> Estimate: ~1 day

## Architectural decisions

- **Token verification**: JWT local verification as primary (using `jose` + Zentity JWKS via `createRemoteJWKSet`), introspection fallback for opaque tokens
- **Auth schemes**: Support both `Bearer` and `DPoP` token types (Zentity issues DPoP-bound access tokens by default)
- **CORS**: Restrict from `origin: "*"` to localhost origins only, configurable via `config.allowedOrigins`
- **Unauthenticated endpoints**: `GET /health` and `GET /.well-known/oauth-protected-resource` remain public
- **Error format**: RFC 6750 Section 3 (`WWW-Authenticate` headers with `error`, `resource_metadata`)

---

## What to build

Implement a Hono middleware that validates OAuth bearer tokens on all `/mcp` endpoints in `apps/mcp`. Currently, `POST /mcp` creates a live MCP session without validating any bearer token, and `origin: "*"` CORS makes it callable from arbitrary browser origins.

End-to-end: Hono auth middleware → extract `Authorization` header → JWT + JWKS verification → DPoP proof validation against `cnf.jkt` → set auth context for tool handlers via `authInfo` → CORS lockdown → proper `WWW-Authenticate` challenges → integration tests.

### Acceptance criteria

- [x] No `Authorization` header → 401 with `WWW-Authenticate: Bearer resource_metadata="<url>"`
- [x] Valid JWT → session created, tools accessible
- [x] Expired JWT → 401 with `error="invalid_token"`
- [x] JWT with wrong audience/issuer → 401
- [x] Valid JWT but insufficient scopes → 403 with `error="insufficient_scope"`
- [x] DPoP-bound token with valid proof → accepted
- [x] DPoP-bound token without proof → 401
- [x] Health endpoint → accessible without auth
- [x] Metadata endpoint → accessible without auth
- [x] CORS restricted to localhost origins only
- [x] `authInfo` passed to `transport.handleRequest(req, { authInfo })` so `requireAuth()` succeeds in tool handlers
- [x] JWKS cached via `createRemoteJWKSet` (handles rotation and TTL)
- [x] Unit test: verification middleware in isolation with mocked JWKS
- [x] Integration test: full auth flow with real token

> **Status**: Complete (already implemented in apps/mcp)
