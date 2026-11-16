# Changelog

## 0.1.0

- Added the first public `@zentity/sdk` release surface for agents, relying parties, first-party auth, Node installed-client helpers, and testing utilities.
- Added `@zentity/sdk/testing` with fixture keys, PoH token mocks, and a mock issuer helper.
- Stabilized exported protocol types around `AccessTokenClaims`, `CapabilityClaim`, `did:key`, and documented error code unions.
- Kept `verifyAccessToken` out of the surface. It checked a bearer token only and skipped the DPoP binding. Use `createOpenIdTokenVerifier` and verify the DPoP proof as described in the README.
- `DpopClient.proofFor` and `DpopClient.fetch` drop the query and fragment from `htu` (RFC 9449 section 4.2) instead of throwing on a URL with a fragment.
