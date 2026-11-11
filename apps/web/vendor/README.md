# Vendored Tarballs

This directory holds packages that are not published to a public registry. Each `file:vendor/*.tgz` reference in `apps/web/package.json` resolves here, which keeps every install reproducible from a clean checkout.

## Better Auth plugins

`@better-auth/haip`, `@better-auth/oidc4vci`, and `@better-auth/oidc4vp` have no upstream release. They are built from the [`feat/zentity-plugins-v1.8`](https://github.com/gustavovalverde/better-auth/tree/feat/zentity-plugins-v1.8) branch of the Better Auth fork, which adds the three plugins on top of Better Auth `v1.8.0-beta.8` without changing any upstream package. Every tarball ships `dist` only and declares `better-auth`, `@better-auth/core`, and `@better-auth/oauth-provider` `^1.8.0-beta.8` as peers, so the published Better Auth packages in `apps/web/package.json` provide the runtime.

| Tarball | Source commit | SHA-256 |
| --- | --- | --- |
| `better-auth-haip-1.8.0-beta.8.tgz` | `edfdd80d1f695709b97cecb0a017bce93dd3b40f` | `0492eed4b61ecddaecab719ecba1c8da791246541660b7b03198c577e08aa5ff` |
| `better-auth-oidc4vci-1.8.0-beta.8.tgz` | `edfdd80d1f695709b97cecb0a017bce93dd3b40f` | `70f4e779fb44d7be042f5f4221bac062b12ffaf187d127f8c1b2ecf3f89a7e93` |
| `better-auth-oidc4vp-1.8.0-beta.8.tgz` | `edfdd80d1f695709b97cecb0a017bce93dd3b40f` | `3359f1ec39c59abb248193507625614339d5f5e29767f1f0ee6db130d26a24c1` |

CIBA comes from the published `@better-auth/ciba` package. OpenID Connect for Identity Assurance (`verified_claims`) is implemented in Zentity itself as an OAuth provider claims extension, so it has no tarball.

To rebuild the tarballs from a checkout of the fork, run `apps/web/scripts/rebuild-vendor.sh [path-to-better-auth]`, or by hand:

1. Check out `feat/zentity-plugins-v1.8` and run `pnpm install`.
2. For each plugin, run `pnpm --filter @better-auth/<plugin> build`, then `pnpm pack` from `packages/<plugin>`. Use `pnpm pack`, not `npm pack`, so `workspace:` peer ranges resolve to concrete versions.
3. Copy the archives here, update the `file:` references in `apps/web/package.json` when the version changes, and record the new commit and `shasum -a 256` output in the table above.
4. Reinstall from scratch: `rm -rf node_modules apps/*/node_modules packages/*/node_modules && pnpm install`. pnpm reuses an installed tarball with an unchanged file name unless `node_modules` is removed.
