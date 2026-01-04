# Verifying Zentity Deployments

This guide explains how to verify that deployed Zentity services match the public source code.

## Quick Verification

### Using GitHub CLI

```bash
# Verify container attestations (SLSA Level 3 provenance)
gh attestation verify oci://ghcr.io/gustavovalverde/zentity/fhe-service:latest --owner gustavovalverde
gh attestation verify oci://ghcr.io/gustavovalverde/zentity/ocr-service:latest --owner gustavovalverde
gh attestation verify oci://ghcr.io/gustavovalverde/zentity/web:latest --owner gustavovalverde
```

### Using Cosign

```bash
# Verify cryptographic signatures
cosign verify ghcr.io/gustavovalverde/zentity/fhe-service:latest \
  --certificate-identity-regexp="https://github.com/gustavovalverde/zentity/.github/workflows/reusable-build-service.yml@.*" \
  --certificate-oidc-issuer="https://token.actions.githubusercontent.com"
```

## Build Info Endpoints

Each service exposes build metadata for verification:

| Service | Endpoint | Example |
|---------|----------|---------|
| Web | `GET /api/build-info` | `https://zentity.app/api/build-info` |
| FHE | `GET /build-info` | `https://fhe.zentity.app/build-info` |
| OCR | `GET /build-info` | `https://ocr.zentity.app/build-info` |

Response format:

```json
{
  "service": "web",
  "version": "1.0.0",
  "gitSha": "d3647fd...",
  "buildTime": "2024-12-17T10:30:00Z"
}
```

## Manual Verification Steps

1. **Get deployed build info:**

   ```bash
   curl -s https://zentity.app/api/build-info | jq
   ```

2. **Compare with GitHub:**
   - Visit `https://github.com/gustavovalverde/zentity/commit/<gitSha>`
   - Verify the commit exists and matches expected code

3. **Verify attestation for that commit:**

   ```bash
   gh attestation verify oci://ghcr.io/gustavovalverde/zentity/web:<gitSha> --owner gustavovalverde
   ```

## What We Guarantee

Every Zentity release provides:

- **SLSA Level 3 Provenance** - Cryptographic proof that artifacts were built from specific source commits using hardened CI infrastructure
- **Sigstore Signatures** - Keyless signatures logged in public transparency logs (Rekor)
- **Reproducible Build Configuration** - Pinned dependencies, deterministic build IDs, and SOURCE_DATE_EPOCH timestamps
- **Software Bill of Materials (SBOM)** - Complete dependency inventory for each container image

## What We Cannot Guarantee (Without TEEs)

> **Important:** While we can prove *what* was built from *which* source code, we cannot cryptographically prove that deployment platforms (Vercel, Railway) are running the exact signed artifacts.

Current limitations:

| Claim | Verifiable? | Method |
|-------|-------------|--------|
| "This build came from commit X" | **Yes** | SLSA provenance |
| "Zentity published this artifact" | **Yes** | Cosign signature |
| "No one tampered with the artifact" | **Yes** | Rekor transparency log |
| "The deployed service runs this exact code" | **No** | Requires TEE (future roadmap) |

For maximum verifiability of the FHE service, we are evaluating Trusted Execution Environment (TEE) options including AWS Nitro Enclaves. See our [verifiable deployments research](./verifiable-deployments.md) for details.

## Transparency Logs

All signatures are recorded in public transparency logs:

- **Rekor** (Sigstore): <https://search.sigstore.dev/>
- **GitHub Attestations**: Viewable via `gh attestation verify`

## Client Integrity Roadmap

We are planning additional safeguards so users can verify the **exact client code**
their browser executes:

- **Signed build manifests + SRI + CSP** (RFC-0011)
- **Public build transparency log** (RFC-0012)

These are not yet enforced in production, but will raise the guarantee that
client code matches audited builds.

## Security Contact

If you discover a discrepancy between attested builds and deployed services, please report it to <security@zentity.app>.

## References

- [SLSA Framework](https://slsa.dev/)
- [Sigstore Documentation](https://docs.sigstore.dev/)
- [GitHub Artifact Attestations](https://docs.github.com/en/actions/security-for-github-actions/using-artifact-attestations)
- [Zentity Verifiable Deployments Research](./verifiable-deployments.md)
