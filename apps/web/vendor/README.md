# Vendored Tarballs

This directory holds tarballs that are not (yet) published to a public registry. Each `file:vendor/*.tgz` reference in `apps/web/package.json` (and `apps/demo-rp/package.json`) resolves here, which keeps every install reproducible from a clean checkout.

## Better Auth

The Better Auth tarballs are patched builds, not copies of the public npm packages. The `1.6.0` `better-auth` and `@better-auth/core` tarballs add the extension registry used by the OAuth provider and CIBA integration (`extensions`, `dependencies`, and `ctx.getExtensions`). `apps/demo-rp` points at these same tarballs with `file:../web/vendor/...` dependencies so the demo relying party exercises the same auth runtime as the issuer app without duplicating binaries.

When replacing one with an upstream npm version, first confirm upstream includes the local extension contracts and remove this note in the same change.
