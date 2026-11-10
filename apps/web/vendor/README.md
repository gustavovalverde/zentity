# Vendored Tarballs and Patches

This directory holds packages and patches that are not published to a public registry. Each `file:vendor/*.tgz` reference in `apps/web/package.json` resolves here, and each patch is registered under `patchedDependencies` in `pnpm-workspace.yaml`, which keeps every install reproducible from a clean checkout.

## Better Auth plugins

`@better-auth/haip`, `@better-auth/oidc4vci`, and `@better-auth/oidc4vp` have no upstream release. They are built from the [`feat/zentity-plugins-v1.8`](https://github.com/gustavovalverde/better-auth/tree/feat/zentity-plugins-v1.8) branch of the Better Auth fork, which adds the three plugins on top of Better Auth `v1.8.0-beta.7` without changing any upstream package. Every tarball ships `dist` only and declares `better-auth`, `@better-auth/core`, and `@better-auth/oauth-provider` `^1.8.0-beta.7` as peers, so the published Better Auth packages in `apps/web/package.json` provide the runtime.

| Tarball | Source commit | SHA-256 |
| --- | --- | --- |
| `better-auth-haip-1.8.0-beta.7.tgz` | `b12432bfa2e6377acb8fbcf2ca9c5d1bc7023650` | `7011035c46ed8f8d48896d640f85aaf35bb503dead74bc46beebead6801a548e` |
| `better-auth-oidc4vci-1.8.0-beta.7.tgz` | `b12432bfa2e6377acb8fbcf2ca9c5d1bc7023650` | `9013de73563831af382fe311d28a2c59003102fcc675cda75b1f1ee6ba82535e` |
| `better-auth-oidc4vp-1.8.0-beta.7.tgz` | `b12432bfa2e6377acb8fbcf2ca9c5d1bc7023650` | `5bf6b3a61b3a955495876fa86cdf9a68830e23a1143d83dfff9c87500caa179a` |

CIBA comes from the published `@better-auth/ciba` package. OpenID Connect for Identity Assurance (`verified_claims`) is implemented in Zentity itself as an OAuth provider claims extension, so it has no tarball.

To rebuild the tarballs from a checkout of the fork, run `apps/web/scripts/rebuild-vendor.sh [path-to-better-auth]`, or by hand:

1. Check out `feat/zentity-plugins-v1.8` and run `pnpm install`.
2. For each plugin, run `pnpm --filter @better-auth/<plugin> build`, then `pnpm pack` from `packages/<plugin>`. Use `pnpm pack`, not `npm pack`, so `workspace:` peer ranges resolve to concrete versions.
3. Copy the archives here, update the `file:` references in `apps/web/package.json` when the version changes, and record the new commit and `shasum -a 256` output in the table above.
4. Reinstall from scratch: `rm -rf node_modules apps/*/node_modules packages/*/node_modules && pnpm install`. pnpm reuses an installed tarball with an unchanged file name unless `node_modules` is removed.
