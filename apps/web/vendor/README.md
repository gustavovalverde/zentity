# Vendored Tarballs

This directory holds packages that are not published to a public registry. Each `file:vendor/*.tgz` reference in `apps/web/package.json` resolves here, which keeps every install reproducible from a clean checkout.

## Better Auth plugins

`@better-auth/haip`, `@better-auth/oidc4vci`, and `@better-auth/oidc4vp` have no upstream release. They are built from the [`feat/zentity-plugins-v1.8`](https://github.com/gustavovalverde/better-auth/tree/feat/zentity-plugins-v1.8) branch of the Better Auth fork, which adds the three plugins on top of Better Auth `v1.8.0-beta.10` without changing any upstream package. Every tarball ships `dist` only and declares `better-auth`, `@better-auth/core`, and `@better-auth/oauth-provider` `^1.8.0-beta.10` as peers, so the published Better Auth packages in `apps/web/package.json` provide the runtime.

| Tarball | Source commit | SHA-256 |
| --- | --- | --- |
| `better-auth-haip-1.8.0-beta.10.tgz` | `6d5975a3c01d325d80cf8bac6f3f03a1d195f1c5` | `9da2507f3bc28b7650b6e9dade72508180ee31521b2c2789aaeef90dca9552f9` |
| `better-auth-oidc4vci-1.8.0-beta.10.tgz` | `6d5975a3c01d325d80cf8bac6f3f03a1d195f1c5` | `173be454fa9703726fefda5a5ec8196619f44502518267350dc8029627cce90f` |
| `better-auth-oidc4vp-1.8.0-beta.10.tgz` | `6d5975a3c01d325d80cf8bac6f3f03a1d195f1c5` | `658895f67c3a43018a86d732c427cd5b0cdad833aa11696fdea162ce479e0c77` |

CIBA comes from the published `@better-auth/ciba` package. OpenID Connect for Identity Assurance (`verified_claims`) is implemented in Zentity itself as an OAuth provider claims extension, so it has no tarball.

To rebuild the tarballs from a checkout of the fork, run `apps/web/scripts/rebuild-vendor.sh [path-to-better-auth]`, or by hand:

1. Check out `feat/zentity-plugins-v1.8` and run `pnpm install`.
2. For each plugin, run `pnpm --filter @better-auth/<plugin> build`, then `pnpm pack` from `packages/<plugin>`. Use `pnpm pack`, not `npm pack`, so `workspace:` peer ranges resolve to concrete versions.
3. Copy the archives here, update the `file:` references in `apps/web/package.json` when the version changes, and record the new commit and `shasum -a 256` output in the table above.
4. Reinstall from scratch: `rm -rf node_modules apps/*/node_modules packages/*/node_modules && pnpm install`. pnpm reuses an installed tarball with an unchanged file name unless `node_modules` is removed.
