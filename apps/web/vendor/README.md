# Vendored Tarballs and Patches

This directory holds packages and patches that are not published to a public registry. Each `file:vendor/*.tgz` reference in `apps/web/package.json` resolves here, and each patch is registered under `patchedDependencies` in `pnpm-workspace.yaml`, which keeps every install reproducible from a clean checkout.

## Better Auth plugins

`@better-auth/haip`, `@better-auth/oidc4vci`, and `@better-auth/oidc4vp` have no upstream release. They are built from the [`feat/zentity-plugins-v1.8`](https://github.com/gustavovalverde/better-auth/tree/feat/zentity-plugins-v1.8) branch of the Better Auth fork, which adds the three plugins on top of Better Auth `v1.8.0-beta.7` without changing any upstream package. Every tarball ships `dist` only and declares `better-auth`, `@better-auth/core`, and `@better-auth/oauth-provider` `^1.8.0-beta.7` as peers, so the published Better Auth packages in `apps/web/package.json` provide the runtime.

| Tarball | Source commit | SHA-256 |
| --- | --- | --- |
| `better-auth-haip-1.8.0-beta.7.tgz` | `72f9e27ad0bfd39329059cdd7e1e9c02f8a26e97` | `8e1884b9e99e08dbb6ba45a280c8aefaffd5b5664f4cb2dc2d80b5c842e3e0ef` |
| `better-auth-oidc4vci-1.8.0-beta.7.tgz` | `72f9e27ad0bfd39329059cdd7e1e9c02f8a26e97` | `0b14cd1e08cb619a42e47e1f3d2bdd4f2ce6e5231119f3058d2bd159b3e5d98d` |
| `better-auth-oidc4vp-1.8.0-beta.7.tgz` | `72f9e27ad0bfd39329059cdd7e1e9c02f8a26e97` | `5bf6b3a61b3a955495876fa86cdf9a68830e23a1143d83dfff9c87500caa179a` |

CIBA comes from the published `@better-auth/ciba` package. OpenID Connect for Identity Assurance (`verified_claims`) is implemented in Zentity itself as an OAuth provider claims extension, so it has no tarball.

To rebuild the tarballs from a checkout of the fork, run `apps/web/scripts/rebuild-vendor.sh [path-to-better-auth]`, or by hand:

1. Check out `feat/zentity-plugins-v1.8` and run `pnpm install`.
2. For each plugin, run `pnpm --filter @better-auth/<plugin> build`, then `pnpm pack` from `packages/<plugin>`. Use `pnpm pack`, not `npm pack`, so `workspace:` peer ranges resolve to concrete versions.
3. Copy the archives here, update the `file:` references in `apps/web/package.json` when the version changes, and record the new commit and `shasum -a 256` output in the table above.
4. Reinstall from scratch: `rm -rf node_modules apps/*/node_modules packages/*/node_modules && pnpm install`. pnpm reuses an installed tarball with an unchanged file name unless `node_modules` is removed.
