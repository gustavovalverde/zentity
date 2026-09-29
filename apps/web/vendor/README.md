# Vendored Tarballs and Patches

This directory holds packages and patches that are not published to a public registry. Each `file:vendor/*.tgz` reference in `apps/web/package.json` resolves here, and each patch is registered under `patchedDependencies` in `pnpm-workspace.yaml`, which keeps every install reproducible from a clean checkout.

## Better Auth plugins

`@better-auth/ciba`, `@better-auth/haip`, `@better-auth/oidc4ida`, `@better-auth/oidc4vci`, and `@better-auth/oidc4vp` have no upstream release. They are built from the `feat/zentity-combined-v1.7.6` branch of the Better Auth fork, which ports the plugins onto Better Auth `v1.7.6` without changing any upstream package. Every tarball ships `dist` only and declares `better-auth`, `@better-auth/core`, and `@better-auth/oauth-provider` `^1.7.6` as peers, so the published Better Auth packages in `apps/web/package.json` provide the runtime.

| Tarball | Source commit | SHA-256 |
| --- | --- | --- |
| `better-auth-ciba-1.7.6.tgz` | `031c3dc2f8ad59ffcd11d882db750a2ed2934f96` | `4f02ad4b868d2f01effe6162f571702c43ac99253d3432c1df776293d51c66e6` |
| `better-auth-haip-1.7.6.tgz` | `031c3dc2f8ad59ffcd11d882db750a2ed2934f96` | `f03c43663dfcb6ca7c67150d044a1355e775382f05d52465f704e5b82342c0fb` |
| `better-auth-oidc4ida-1.7.6.tgz` | `031c3dc2f8ad59ffcd11d882db750a2ed2934f96` | `1c48b1242c2df419caaa163276c8e9dd946658f8adb4156bbb66ca9b16717864` |
| `better-auth-oidc4vci-1.7.6.tgz` | `031c3dc2f8ad59ffcd11d882db750a2ed2934f96` | `18f087fb6e20f3188f354a32594fbf3992734c4aedeaf839b6a171b7c2d6c89b` |
| `better-auth-oidc4vp-1.7.6.tgz` | `031c3dc2f8ad59ffcd11d882db750a2ed2934f96` | `5dc074e5f5c8a1bdb7cc4119abc4b6ad3cf49a330228771e7fee1d1af22fb579` |

To rebuild the tarballs from a checkout of the fork:

1. Check out `feat/zentity-combined-v1.7.6` and run `pnpm install`.
2. For each plugin, run `pnpm --filter @better-auth/<plugin> build`, then `pnpm pack` from `packages/<plugin>`. Use `pnpm pack`, not `npm pack`, so `workspace:` peer ranges resolve to concrete versions.
3. Copy the archives here, update the `file:` references in `apps/web/package.json` when the version changes, and record the new commit and `shasum -a 256` output in the table above.
4. Reinstall from scratch: `rm -rf node_modules apps/*/node_modules packages/*/node_modules && pnpm install`. pnpm reuses an installed tarball with an unchanged file name unless `node_modules` is removed.

## OAuth provider patch

`@better-auth__oauth-provider@1.7.6.patch` adds `verifyOAuthQueryParams` to the package root exports. Zentity's identity intent, stage, and unstage routes verify the signed authorization query with the provider's own verifier, so the canonicalization never drifts from the signer. Upstream PR [better-auth/better-auth#10611](https://github.com/better-auth/better-auth/pull/10611) makes the same export; drop the patch once a release includes it.

The patch is keyed to the exact version, so `pnpm install` fails when `@better-auth/oauth-provider` changes version without the patch being regenerated or removed. Regenerate it with `pnpm patch @better-auth/oauth-provider@<version>`, re-add the export to `dist/index.mjs` and `dist/index.d.mts`, then `pnpm patch-commit <dir> --patches-dir apps/web/vendor`.
