// tsup builds declaration files through the TypeScript compiler API, which
// TypeScript 7 no longer ships. Resolve tsup's `typescript` to the TypeScript 6
// API package instead of the workspace's TypeScript 7 peer.
module.exports = {
  hooks: {
    readPackage(pkg) {
      if (pkg.name === "tsup") {
        delete pkg.peerDependencies?.typescript;
        delete pkg.peerDependenciesMeta?.typescript;
        pkg.dependencies = {
          ...pkg.dependencies,
          typescript: "npm:@typescript/typescript6@^6.0.2",
        };
      }
      return pkg;
    },
  },
};
