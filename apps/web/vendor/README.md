# Vendored Tarballs

This directory holds packages that are not published to a public registry. Each `file:vendor/*.tgz` reference in `apps/web/package.json` resolves here, which keeps every install reproducible from a clean checkout.

## Better Auth plugins

`@better-auth/first-party-apps`, `@better-auth/haip`, `@better-auth/oidc4vci`, and `@better-auth/oidc4vp` have no upstream release. They are built from the Better Auth fork, which adds the four plugins on top of Better Auth `v1.8.0-beta.10` without changing any upstream package. The plugins first landed on the [`feat/zentity-plugins-v1.8`](https://github.com/gustavovalverde/better-auth/tree/feat/zentity-plugins-v1.8) branch. The [`feat/first-party-apps-plugin`](https://github.com/gustavovalverde/better-auth/tree/feat/first-party-apps-plugin) branch extends that branch's `6d5975a3c` commit with `first-party-apps` and with the `oidc4vci` changes that resolve pairwise wallets, draw random status list indices and move to a new list once one is crowded, require a confidential client to authenticate to redeem its pre-authorized code, and limit the valid credentials a user may hold. The first of those changes also touches the `oidc4vp` documentation. Its build of `haip` is byte-identical to the `6d5975a3c` build, its build of `first-party-apps` to the `4947fca1d` build, and its build of `oidc4vp` to the `3766e740d` build, so those rows keep their earlier commits. Every tarball ships `dist` only and declares `better-auth`, `@better-auth/core`, and `@better-auth/oauth-provider` `^1.8.0-beta.10` as peers, so the published Better Auth packages in `apps/web/package.json` provide the runtime.

| Tarball | Source commit | SHA-256 |
| --- | --- | --- |
| `better-auth-first-party-apps-1.8.0-beta.10.tgz` | `4947fca1d30a0b35d4b74820a2973e3827fc5cbb` | `dc2117fc79e48a95bd3b31496e8f7ad777f2c4580256950feb3bfc34a8dc666e` |
| `better-auth-haip-1.8.0-beta.10.tgz` | `6d5975a3c01d325d80cf8bac6f3f03a1d195f1c5` | `9da2507f3bc28b7650b6e9dade72508180ee31521b2c2789aaeef90dca9552f9` |
| `better-auth-oidc4vci-1.8.0-beta.10.tgz` | `c0d9235dc0c3ae9a7ab22c7a12398bb84e9540db` | `324913806e6d8a1d4a321b97dfda235907a68762a2a00a17da121c5a34678dc8` |
| `better-auth-oidc4vp-1.8.0-beta.10.tgz` | `3766e740d126d7e202dff89763eca32734e6f672` | `b861831350161d84ad50928aa8746996f4a27d318aace5f1f342979b642e7408` |

CIBA comes from the published `@better-auth/ciba` package. OpenID Connect for Identity Assurance (`verified_claims`) is implemented in Zentity itself as an OAuth provider claims extension, so it has no tarball.

To rebuild the tarballs from a checkout of the fork, run `apps/web/scripts/rebuild-vendor.sh [path-to-better-auth]`. The script checks out `feat/first-party-apps-plugin`, the only branch that holds all four plugins, unless `BETTER_AUTH_BRANCH` names another branch, and stops before replacing any tarball when the branch lacks one of them. By hand:

1. Check out the fork branch and run `pnpm install`.
2. For each plugin, run `pnpm --filter @better-auth/<plugin> build`, then `pnpm pack` from `packages/<plugin>`. Use `pnpm pack`, not `npm pack`, so `workspace:` peer ranges resolve to concrete versions.
3. Copy the archives here, update the `file:` references in `apps/web/package.json` when the version changes, and record the new commit and `shasum -a 256` output in the table above.
4. Reinstall from scratch: `rm -rf node_modules apps/*/node_modules packages/*/node_modules && pnpm install`. pnpm reuses an installed tarball with an unchanged file name unless `node_modules` is removed.
