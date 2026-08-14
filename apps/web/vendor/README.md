# Vendored Tarballs

This directory holds tarballs that are not yet published to a public registry. Each `file:vendor/*.tgz` reference in `apps/web/package.json` resolves here, which keeps every install reproducible from a clean checkout.

## Better Auth

The Better Auth tarballs are local release-candidate builds used to exercise unpublished plugin fixes before the next RC is released. The HAIP archive includes Zentity's upstream PAR-validation fix. The OAuth Provider archive includes configurable OIDC authentication-context support and the public signed-query verifier needed by custom authorization flows. The remaining plugin archives are rebuilt from the same Better Auth `next` revision. Published Better Auth core packages stay pinned to the matching RC version.

Regenerate the archives from the adjacent Better Auth checkout after building `ciba`, `haip`, `oauth-provider`, `oidc4ida`, `oidc4vci`, and `oidc4vp`. Run `pnpm pack --pack-destination <zentity>/apps/web/vendor` from each package directory. Keep the `-zentity` suffix on HAIP and OAuth Provider builds from the combined upstream-fix branch until those changes ship in an RC, then switch every plugin back to its published package.

When replacing one with an upstream npm version, first confirm upstream includes the local extension contracts and remove this note in the same change.
