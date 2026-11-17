import { readFileSync } from "node:fs";
import { glob } from "node:fs/promises";
import { join } from "node:path";

import {
  normalizeVersion,
  readInstalledVersion,
} from "@/lib/privacy/zk/version-check";

const VERSION_PREFIX_RE = /^[~^]/;
// An exact compiler pin, such as `compiler_version = "=1.0.0"`
const COMPILER_PIN_RE = /^compiler_version\s*=\s*"=(\d+\.\d+\.\d+)"\s*$/m;

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function normalizeRange(raw: string | null | undefined): string | null {
  return normalizeVersion(raw?.trim().replace(VERSION_PREFIX_RE, ""));
}

function readPackageJson(root: string): PackageJson {
  const pkgPath = join(root, "package.json");
  const raw = readFileSync(pkgPath, "utf8");
  return JSON.parse(raw) as PackageJson;
}

function getDependencyVersion(pkg: PackageJson, name: string): string | null {
  return pkg.dependencies?.[name] ?? pkg.devDependencies?.[name] ?? null;
}

async function main() {
  const root = process.cwd();
  const pkg = readPackageJson(root);

  const noirJsVersion = normalizeRange(
    readInstalledVersion("@noir-lang/noir_js") ??
      getDependencyVersion(pkg, "@noir-lang/noir_js")
  );
  const acvmVersion = normalizeRange(
    readInstalledVersion("@noir-lang/acvm_js") ??
      getDependencyVersion(pkg, "@noir-lang/acvm_js")
  );
  const abiVersion = normalizeRange(
    readInstalledVersion("@noir-lang/noirc_abi") ??
      getDependencyVersion(pkg, "@noir-lang/noirc_abi")
  );

  const runtimeVersions = {
    noir_js: noirJsVersion,
    acvm_js: acvmVersion,
    noirc_abi: abiVersion,
  };

  const missingRuntime = Object.entries(runtimeVersions)
    .filter(([, value]) => !value)
    .map(([key]) => key);

  const artifactPaths = await Array.fromAsync(
    glob("noir-circuits/*/artifacts/*.json", { cwd: root })
  );

  if (artifactPaths.length === 0) {
    console.error("No Noir artifacts found in noir-circuits/*/artifacts");
    process.exit(1);
  }

  const artifactVersions = new Set<string>();
  const missingArtifactVersions: string[] = [];

  for (const relPath of artifactPaths) {
    const fullPath = join(root, relPath);
    try {
      const raw = JSON.parse(readFileSync(fullPath, "utf8")) as {
        noir_version?: string;
      };
      const version = normalizeRange(raw.noir_version);
      if (version) {
        artifactVersions.add(version);
      } else {
        missingArtifactVersions.push(relPath);
      }
    } catch (error) {
      console.error(
        `Failed to parse Noir artifact: ${relPath} (${String(error)})`
      );
      process.exit(1);
    }
  }

  const artifactVersionList = Array.from(artifactVersions);

  const manifestPaths = await Array.fromAsync(
    glob("noir-circuits/*/Nargo.toml", { cwd: root })
  );
  const compilerPins = new Set<string>();
  const unpinnedManifests: string[] = [];
  for (const relPath of manifestPaths) {
    const pin = COMPILER_PIN_RE.exec(
      readFileSync(join(root, relPath), "utf8")
    )?.[1];
    if (pin) {
      compilerPins.add(pin);
    } else {
      unpinnedManifests.push(relPath);
    }
  }

  const errors: string[] = [];

  if (manifestPaths.length === 0) {
    errors.push("No Nargo.toml manifests found in noir-circuits/*");
  }

  if (unpinnedManifests.length > 0) {
    errors.push(
      `Nargo.toml without an exact compiler_version pin (="x.y.z"): ${unpinnedManifests.join(", ")}`
    );
  }

  const compilerPinList = Array.from(compilerPins);
  if (compilerPinList.length > 1) {
    errors.push(
      `Nargo.toml manifests pin different compilers: ${compilerPinList.join(", ")}`
    );
  }

  if (missingRuntime.length > 0) {
    errors.push(
      `Missing runtime package versions: ${missingRuntime.join(", ")}`
    );
  }

  if (missingArtifactVersions.length > 0) {
    errors.push(
      `Artifacts missing noir_version: ${missingArtifactVersions.join(", ")}`
    );
  }

  if (artifactVersionList.length === 0) {
    errors.push("No Noir artifact versions detected");
  }

  if (artifactVersionList.length > 1) {
    errors.push(
      `Multiple Noir artifact versions detected: ${artifactVersionList.join(", ")}`
    );
  }

  const runtimeVersionList = Object.values(runtimeVersions).filter(
    (version): version is string => Boolean(version)
  );
  const runtimeUnique = Array.from(new Set(runtimeVersionList));
  if (runtimeUnique.length > 1) {
    errors.push(`Runtime package versions differ: ${runtimeUnique.join(", ")}`);
  }

  const runtimeVersion = runtimeUnique[0] ?? null;
  const artifactVersion = artifactVersionList[0] ?? null;
  if (runtimeVersion && artifactVersion && runtimeVersion !== artifactVersion) {
    errors.push(
      `Runtime version (${runtimeVersion}) does not match artifact version (${artifactVersion})`
    );
  }

  const compilerPin = compilerPinList[0] ?? null;
  if (compilerPin && artifactVersion && compilerPin !== artifactVersion) {
    errors.push(
      `Pinned compiler (${compilerPin}) does not match artifact version (${artifactVersion}); recompile the circuits with nargo ${compilerPin}`
    );
  }

  if (errors.length > 0) {
    for (const error of errors) {
      console.error(error);
    }
    process.exit(1);
  }

  console.log(
    `Noir versions aligned: ${runtimeVersion ?? "unknown"} (nargo pin, artifacts, runtime)`
  );
}

main().catch((error) => {
  console.error(`Noir version check failed: ${String(error)}`);
  process.exit(1);
});
