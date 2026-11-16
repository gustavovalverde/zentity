---
"@zentity/sdk": minor
---

Agent claims move to version 2 (`AAP_CLAIMS_VERSION = 2`), and the agent-configuration schema accepts only that version, so the SDK, the MCP server, and Zentity upgrade together.

Zentity's access tokens no longer carry agent control-plane claims. `AccessTokenClaims` is the standard claims plus an optional `act` and `authorization_details`, and `AccessTokenActClaim` is `{ sub, sub_profile }`: the agent session's pairwise identifier, with no `session_id`, `host_id`, `did`, `operator`, `host_attestation`, or `type`. `ACT_DID_EMISSION_POLICY` is `"never"`. `AapAccessTokenClaims`, `AccessTokenTaskClaim`, and `AccessTokenAuditClaim` are removed. `AccessTokenOversightClaim` drops `approval_id`, and `AccessTokenDelegationClaim` drops `parent_jti`.

`CibaTokenSet` gains `capabilities`, `delegation`, and `aapClaimsVersion`, read from the CIBA token response of an agent-backed approval; the new `AgentAuthorization` type names that set together with `oversight`. `agent.requestCapability` caches a token set by its `capabilities` rather than by decoding the access token, so it also caches opaque tokens. `decodeAccessToken` and `Agent.decodeAccessToken` are removed: a client must not read its access token (RFC 9068 §6).
