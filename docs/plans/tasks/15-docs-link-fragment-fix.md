# Task 15: Docs Link Fragment Fix

> Source: `security-findings-remediation.md` Finding 3
> Priority: **P3** — docs cross-document anchor links 404 in the SPA
> Estimate: ~30 minutes

## Architectural decisions

- **Fix location**: `transformHref` in the landing page markdown renderer
- **Approach**: Split `href` on `#` before the `.md` check, rewrite path portion, re-append fragment

---

## What to build

The landing page markdown renderer's `transformHref` gates link rewriting on `href.endsWith(".md")`. Links with `#fragment` suffixes (e.g., `agentic-authorization.md#binding-chains`) bypass the rewriter and emit bare relative URLs that 404 in the SPA.

End-to-end: split href on `#` at top of `transformHref` → apply `.md` → `/docs/slug` rewriting to path portion only → re-append `#fragment` to resolved URL → handle edge cases (anchor-only, external URLs, unknown docs) → unit tests.

### Acceptance criteria

- [ ] `"architecture.md#section"` → `/docs/architecture#section`
- [ ] `"../docs/zk-architecture.md#bn254"` → `/docs/zk-architecture#bn254`
- [ ] `"unknown-doc.md#foo"` → GitHub link with `#foo`
- [ ] `"#anchor-only"` → `"#anchor-only"` (unchanged)
- [ ] `"https://example.com/page#hash"` → unchanged
- [ ] `"architecture.md"` → `/docs/architecture` (regression: existing behavior preserved)
- [ ] Unit test: `transformHref` as a pure function with all cases above
