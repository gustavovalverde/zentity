# Zentity Landing Site

Marketing site for Zentity’s privacy‑preserving compliance and identity verification platform.

## Summary

The landing site reflects the current architecture:

- **ZK proofs** for eligibility (age, document validity, nationality membership, face match threshold)
- **FHE encryption** for sensitive attributes (birth_year_offset, country_code, compliance_level, liveness score)
- **Evidence pack** (`policy_hash` + `proof_set_hash`) for auditability without exposing PII
- **User‑only decryption** (client keys stay in the browser)
- **Multi‑document identity model** (document‑scoped proofs + claims)

For the technical details, see:

- `../../docs/attestation-privacy-architecture.md`
- `../../docs/architecture.md`
- `../../docs/zk-architecture.md`
- `../../docs/web3-architecture.md`

## Development

```bash
bun install
bun run dev
```

## Build

```bash
bun run build
bun run preview
```

## Notes

This is a static marketing site (Vite). It does not run verification flows or store data.
