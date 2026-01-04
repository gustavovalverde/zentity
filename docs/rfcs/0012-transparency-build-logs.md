# RFC-0012: Transparency Logs for Build Verification

| Field | Value |
|-------|-------|
| **Status** | Proposed |
| **Created** | 2026-01-04 |
| **Updated** | 2026-01-04 |
| **Author** | Gustavo Valverde |

## Summary

Publish an append-only transparency log of build hashes so users and relying
parties can verify which code ran for a given deployment. This complements
signed build manifests by providing a public, auditable record.

## Problem Statement

Signed manifests help verify integrity, but users also need **public evidence**
of which builds were deployed, when, and where. Without a transparency log,
there is no simple, external way to audit deployment history.

## Goals

- Publish a **public build log** containing signed build hashes.
- Make logs easy to validate by users and partners.
- Provide a stable **build identifier** surfaced in UI and headers.

## Non-goals

- A full CT-style witness network.
- Guaranteeing absolute non-repudiation without external witnesses.

## Design Decisions

1. **Append-only build log**
   - A simple JSONL log stored at `/.well-known/zentity/build-log.jsonl`.
   - Each entry includes build hash, timestamp, environment, and signature.

2. **Signed entries**
   - Each log entry is signed using the same key as the build manifest.
   - Signature is stored per-entry to allow independent verification.

3. **Build identifiers**
   - Add `X-Zentity-Build` header with the build hash.
   - Display build hash in the dashboard "About" section.

4. **Public verification**
   - Publish the public key in repo + docs + well-known endpoint.

## Architecture Overview

```text
CI build -> build hash -> append log entry -> sign entry
         -> publish log to /.well-known/
client   -> read X-Zentity-Build -> verify against log
```

## Implementation Plan

- **CI**
  - Append a signed entry on each deploy.
  - Upload to `/.well-known/zentity/build-log.jsonl`.

- **App**
  - Expose build hash header.
  - Add a simple UI surface for the current build ID.

## Migration Strategy

- Backfill existing deployments with a "historical" log entry.
- Start logging from next deploy onward.

## Risks

- Log availability and uptime (mitigate with CDN caching).
- If a private key is compromised, logs must rotate keys and annotate.

## Testing Plan

- Validate log entry signature with the public key.
- Verify that build hash headers match log entries in staging.

## Open Questions

- Should we mirror logs in GitHub releases for redundancy?
- Do we need an external witness in the long term?
