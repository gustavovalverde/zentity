# RFC-0016: OIDC for Verifiable Credential Issuance & Presentation

| Field | Value |
|-------|-------|
| **Status** | Proposed |
| **Created** | 2026-01-07 |
| **Updated** | 2026-01-07 |
| **Author** | Gustavo Valverde |

## Summary

Adopt **OpenID for Verifiable Credential Issuance (OIDC4VCI)** and **OpenID for
Verifiable Presentations (OIDC4VP)** to make Zentity interoperable with external
wallets and verifiers, while preserving the current privacy model: **no server
decryptable PII**, **passkey-secured secrets**, and **FHE/zk‑derived minimal
claims**. The OAuth Provider plugin remains the Authorization Server; new
Credential Issuer and Verifier endpoints are added to the web app.

## Problem Statement

Zentity produces high‑assurance verification artifacts (OCR, liveness, face
match, ZK proofs, and FHE-derived attributes), but there is no standards-based
way to issue **portable credentials** or accept **verifiable presentations**
from external wallets. This limits interoperability with Relying Parties (RPs)
and prevents a clear, consent-driven disclosure flow.

The system needs:

- A standards-based issuance API for VCs (OIDC4VCI).
- A standards-based presentation flow for verifiers (OIDC4VP).
- A privacy-preserving claim model that avoids raw PII.
- A holder-binding strategy that is compatible with passkeys and external
  wallets.

## Goals

- Implement OIDC4VCI issuance flows using existing OAuth server capabilities.
- Implement OIDC4VP verifier flows to request and validate presentations.
- Issue **derived minimal claims** only (no raw PII).
- Preserve passkey/FHE architecture and privacy guarantees.
- Support external wallets and future ecosystem interoperability.
- Provide explicit consent and scope-based access to credential types.

## Non-goals

- Replace the current verification pipeline or ZK/FHE design.
- Store plaintext PII on the server to satisfy VC claims.
- Implement every VC format in the first iteration.
- Provide backwards compatibility for legacy non‑OIDC integrations.

## Background

OIDC4VCI defines how an issuer exposes a **Credential Issuer** API protected by
OAuth 2.0. OIDC4VP defines how a verifier requests and validates **presentations**
from a wallet. Both are designed for wallet interoperability.

The stack already includes:

- Better Auth OAuth Provider plugin (authorization server + consent).
- Passkey‑protected secrets for local decryption.
- ZK/FHE pipeline to compute derived claims without disclosing PII.

## Architecture Overview

### Roles

- **Authorization Server (AS)**: issues access tokens and handles consent.
  - Backed by Better Auth OAuth Provider plugin.
- **Credential Issuer**: exposes issuer metadata + credential endpoint.
  - Implemented via Better Auth plugins under `/api/auth/oidc4vci/*` with public
    `.well-known` routing.
- **Wallet**: holds VC and proves possession (internal web wallet or external).
- **Verifier/RP**: requests a presentation (OIDC4VP).

### Boundaries

- The **server never stores plaintext PII**.
- The **client wallet** holds VC material and uses passkeys to protect local
  keys or envelopes.
- Derived claims are computed from already verified artifacts (OCR, liveness,
  face match, ZK proofs, FHE).

## Design Decisions

### 1) OAuth Provider plugin is the Authorization Server

Use the Better Auth **OAuth Provider** plugin as the AS. The OIDC Provider
plugin is not selected because issuance and presentation are OAuth-centric and
the plugin is marked as deprecating in favor of OAuth.

**Scopes**

- `openid` (OIDC identity baseline)
- `profile`, `email`, `offline_access` (standard scopes)
- `proof:identity` (credential issuance scope)

### 2) OIDC4VCI Issuer API (new routes)

Add a credential issuer surface:

- `/.well-known/openid-credential-issuer`
- `/api/auth/oidc4vci/credential` (credential endpoint)
- `/api/auth/oidc4vci/nonce` (proof nonce)
- `/api/auth/oidc4vci/credential-offer` (pre-authorized issuance)
- `/api/auth/oidc4vci/credential/deferred` (async issuance)
- `/api/auth/oidc4vci/status-list` (credential status list)
- `/api/auth/oidc4vci/credential/status` (revocation / status updates)

Issuer metadata includes:

- `credential_issuer`: issuer identifier
- `authorization_server`: OAuth AS URL
- `credentials_supported`: types, formats, and claims
- `proof_types_supported`: `jwt` (and `cwt` later if needed)

### 3) OIDC4VP Verifier API (new routes)

Add a verifier surface for RPs:

- `/api/auth/oidc4vp/verify`
- `/api/auth/oidc4vp/response`

Support:

- `presentation_definition` (PEX)
- `vp_token` response types
- verifier side validation of holder binding + signature

### 4) Derived Minimal Claims (privacy‑preserving)

Credentials only include **derived** or **non‑PII** claims:

- `verification_level` (`none` | `basic` | `full`)
- `verified`
- `document_verified`, `liveness_verified`, `face_match_verified`
- `age_proof_verified`, `doc_validity_proof_verified`, `nationality_proof_verified`
- `policy_version`, `issuer_id`, `verification_time`, `attestation_expires_at`

No raw PII such as:

- Full name
- DOB
- Document number
- Raw document scans

If a claim must be revealable in controlled contexts, use **selective
disclosure** (SD‑JWT VC) instead of full plaintext.

### 5) Credential Formats

Primary format:

- **SD‑JWT VC** (`vc+sd-jwt`) for selective disclosure and minimal leakage.

Secondary formats (optional, later):

- `jwt_vc_json` (compatibility)
- `mso_mdoc` (mobile driving license / ID scenarios)

### 6) Holder Binding Strategy

Holder binding ensures the VC is tied to a cryptographic key.

Two supported paths:

1) **External Wallet Key**
   - Wallet uses its own key pair (standard OIDC4VCI flow).
2) **Internal Web Wallet Key**
   - Generate a wallet key pair in WebCrypto.
   - Encrypt private key locally with passkey-derived PRF key.
   - Store encrypted key in client storage (not server).

The issuer validates proof of possession via `proof.jwt` and includes `cnf.jwk`
in the VC.

### 7) Issuance Flows

**Pre‑Authorized Code Flow** (default)

Used after verification is completed:

1) User completes verification in Zentity.
2) Server issues a pre‑authorized code + optional PIN.
3) User scans QR or deep link in wallet.
4) Wallet exchanges code for access token.
5) Wallet requests credential with proof of possession.

**Authorization Code Flow** (external clients)

Used when a third‑party client initiates issuance:

1) Client redirects user to consent page.
2) User approves VC scopes.
3) Client receives code + exchanges for token.
4) Client requests credential.

### 8) Verification & FHE Integration

Issuance uses existing verification data as eligibility gates:

- Require completed verification status.
- Use FHE-derived attributes for age/nationality flags.
- Include proof/policy hashes for auditability.

No cryptographic material is exposed beyond what is already derived for proofs.

### 9) Data Model (proposed)

New tables (minimal):

- `vc_issuance_sessions`
  - `id`, `user_id`, `credential_type`, `status`, `expires_at`
  - `pre_authorized_code`, `tx_code_hash`
- `vc_status_lists` (optional)
  - `id`, `issuer_id`, `list_type`, `bitstring`, `updated_at`
- `vc_issued_records`
  - `id`, `user_id`, `credential_type`, `format`, `issuer_key_id`
  - `subject_hash` (pairwise pseudonymous identifier)
  - `issued_at`, `status_list_ref`

Server does **not** store full credentials; it keeps issuance metadata only.

### 10) Pairwise Subject Identifiers

To reduce correlation across RPs:

- Compute `sub` as HMAC(user_id, client_id, issuer_secret).
- Use `sub` per RP / client.

This prevents linking credentials across contexts.

### 11) Revocation / Status

Two options:

- **Status List 2021** (bitstring) for privacy-preserving revocation.
- **No revocation** in phase 1, only short-lived credentials.

Recommendation: use Status List 2021 for production, keep the list encrypted at
rest, and rotate periodically.

## Security Considerations

- Enforce PKCE for authorization code flow.
- Use short-lived access tokens for issuance.
- Validate `nonce` in proof JWT to prevent replay.
- Require holder binding (`cnf.jwk`).
- Do not store plaintext VC or raw PII server-side.
- Audit consent events and scope grants.

## UX Considerations

- Issuance should be **post‑verification** and explicit.
- Wallet‑agnostic QR issuance flow for external wallets.
- Internal wallet experience uses passkey to unlock the holder key.
- Consent UI surfaces **which minimal claims** are issued.

## Migration / Phased Delivery

**Phase 1: Issuer API + Pre‑Authorized Flow**

- Issuer metadata
- Credential endpoint
- Pre‑authorized code issuance
- SD‑JWT VC issuance with minimal claims

**Phase 2: Authorization Code Flow**

- OAuth consent integration
- VC scopes for third‑party clients

**Phase 3: OIDC4VP Verifier**

- Presentation request/response
- Policy‑driven validation

**Phase 4: Revocation / Status Lists**

- Status List service + rotation

## Alternatives Considered

1) **Better Auth OIDC Provider plugin**
   - Rejected: deprecation path and not focused on OIDC4VCI/4VP.

2) **Custom non‑OIDC issuer API**
   - Rejected: loses wallet interoperability and standard compliance.

3) **Embed raw PII in VCs**
   - Rejected: violates privacy model and increases breach risk.

## Open Questions

- Do we require selective disclosure for all credential types or only PII‑risk
  claims?
- Which VC formats are required for target wallet interoperability?
- Do we need a verifier registry or allow open verifier requests?

## Success Criteria

- External wallet can obtain a VC from Zentity via OIDC4VCI.
- VC includes only derived minimal claims.
- Holder binding is validated and credentials are accepted by at least one
  third‑party verifier using OIDC4VP.
- No new server‑side PII is introduced.
