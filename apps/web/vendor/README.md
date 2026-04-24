# Vendored Better Auth Packages

The Better Auth tarballs in this directory are intentionally vendored patched builds, not copies of the public npm packages.

The `1.6.0` `better-auth` and `@better-auth/core` tarballs add the extension registry used by the OAuth provider and CIBA integration (`extensions`, `dependencies`, and `ctx.getExtensions`). `apps/demo-rp` points at these same tarballs with `file:../web/vendor/...` dependencies so the demo relying party exercises the same auth runtime as the issuer app without duplicating binaries.

When replacing a tarball with an upstream npm version, first confirm the upstream package includes the local extension contracts and remove this note in the same change.
