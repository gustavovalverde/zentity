# Zentity Landing Site

Marketing site for Zentity’s privacy‑preserving compliance and identity verification platform.

## Summary

The landing site reflects the current architecture:

- **ZK proofs** for eligibility (age, document validity, nationality membership, face match threshold)
- **FHE encryption** for sensitive attributes (birth_year_offset, country_code, compliance_level, liveness score)
- **Evidence pack** (`policy_hash` + `proof_set_hash`) for auditability without exposing PII
- **Passkeys (auth + key custody)** for passwordless login and PRF-derived profile sealing
- **User‑only decryption** (client keys stay in the browser; FHE keys are passkey-wrapped)
- **Multi‑document identity model** (document‑scoped proofs + claims)

These are the four cryptographic pillars of the product: passkeys, ZK proofs, FHE, and commitments.

For the technical details, see:

- `../../docs/attestation-privacy-architecture.md`
- `../../docs/architecture.md`
- `../../docs/zk-architecture.md`
- `../../docs/web3-architecture.md`

## Development

```bash
pnpm install
pnpm run dev
```

## Build

```bash
pnpm run build
pnpm run preview
```

## Notes

This is a static marketing site (Vite). It does not run verification flows or store data.
