# Vendored Tarballs

This directory holds packages that are not published to a public registry. Each `file:vendor/*.tgz` reference in `apps/web/package.json` resolves here, which keeps every install reproducible from a clean checkout.

## Better Auth plugins

`@better-auth/first-party-apps`, `@better-auth/haip`, `@better-auth/oidc4vci`, and `@better-auth/oidc4vp` have no upstream release. The FPA package is built from Better Auth `v1.8.0-beta.11` with the local source patch below. The other three packages remain on the fork artifacts based on `v1.8.0-beta.10`. The workspace override aligns their `better-call` dependency with the provider. The older fork history is documented below for those artifacts.

| Tarball | Source commit | SHA-256 |
| --- | --- | --- |
| `better-auth-first-party-apps-1.8.0-beta.11.tgz` | Better Auth `v1.8.0-beta.11` (`60df7b02a309edaa611147d5fc05afe952cbd86f`) plus `better-auth-first-party-apps-beta11.patch` (SHA-256 `e08966ba9e9623864d0d426d4ee54fe5c2493f4618179c07d0e9befb900f0a03`) | `a707ed3a02a3a19bd96b6bb2a43fd76a72bae50b8ea96806bbc1b97ad5c62e8d` |
| `better-auth-haip-1.8.0-beta.10.tgz` | `6d5975a3c01d325d80cf8bac6f3f03a1d195f1c5` | `9da2507f3bc28b7650b6e9dade72508180ee31521b2c2789aaeef90dca9552f9` |
| `better-auth-oidc4vci-1.8.0-beta.10.tgz` | `c0d9235dc0c3ae9a7ab22c7a12398bb84e9540db` | `324913806e6d8a1d4a321b97dfda235907a68762a2a00a17da121c5a34678dc8` |
| `better-auth-oidc4vp-1.8.0-beta.10.tgz` | `3766e740d126d7e202dff89763eca32734e6f672` | `b861831350161d84ad50928aa8746996f4a27d318aace5f1f342979b642e7408` |

CIBA comes from the published `@better-auth/ciba` package. OpenID Connect for Identity Assurance (`verified_claims`) is implemented in Zentity itself as an OAuth provider claims extension, so it has no tarball.

To rebuild the FPA tarball, use a clean Better Auth checkout at the recorded beta.11 commit and run `apps/web/scripts/rebuild-first-party-apps-vendor.sh [path-to-better-auth-beta11]`. This applies the tracked patch, installs the package's workspace dependencies, builds it, and writes only the FPA archive to `apps/web/vendor/`. The legacy `rebuild-vendor.sh` builds all four archives from the older fork branch. Use the following procedure for the three beta.10 archives.

1. Check out the fork branch and run `pnpm install`.
2. For each plugin, run `pnpm --filter @better-auth/<plugin> build`, then `pnpm pack` from `packages/<plugin>`. Use `pnpm pack`, not `npm pack`, so `workspace:` peer ranges resolve to concrete versions.
3. Copy the archives here, update the `file:` references in `apps/web/package.json` when the version changes, and record the new commit and `shasum -a 256` output in the table above.
4. Reinstall from scratch: `rm -rf node_modules apps/*/node_modules packages/*/node_modules && pnpm install`. pnpm reuses an installed tarball with an unchanged file name unless `node_modules` is removed.
