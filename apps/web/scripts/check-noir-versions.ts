import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { glob } from "glob";

const VERSION_PREFIX_RE = /^[~^]/;

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function normalizeVersion(raw: string | null | undefined): string | null {
  if (!raw) {
    return null;
  }
  const trimmed = raw.trim().replace(VERSION_PREFIX_RE, "");
  const [prefix] = trimmed.split("+");
  return prefix || null;
}

function readPackageJson(root: string): PackageJson {
  const pkgPath = join(root, "package.json");
  const raw = readFileSync(pkgPath, "utf8");
  return JSON.parse(raw) as PackageJson;
}

function readInstalledVersion(root: string, pkgName: string): string | null {
  const pkgPath = join(root, "node_modules", pkgName, "package.json");
  if (!existsSync(pkgPath)) {
    return null;
  }
  try {
    const raw = readFileSync(pkgPath, "utf8");
    const parsed = JSON.parse(raw) as { version?: string };
    return typeof parsed.version === "string" ? parsed.version : null;
  } catch {
    return null;
  }
}

function getDependencyVersion(pkg: PackageJson, name: string): string | null {
  return pkg.dependencies?.[name] ?? pkg.devDependencies?.[name] ?? null;
}

async function main() {
  const root = process.cwd();
  const pkg = readPackageJson(root);

  const noirJsVersion = normalizeVersion(
    readInstalledVersion(root, "@noir-lang/noir_js") ??
      getDependencyVersion(pkg, "@noir-lang/noir_js")
  );
  const acvmVersion = normalizeVersion(
    readInstalledVersion(root, "@noir-lang/acvm_js") ??
      getDependencyVersion(pkg, "@noir-lang/acvm_js")
  );
  const abiVersion = normalizeVersion(
    readInstalledVersion(root, "@noir-lang/noirc_abi") ??
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

  const artifactPaths = await glob("noir-circuits/*/artifacts/*.json", {
    cwd: root,
  });

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
      const version = normalizeVersion(raw.noir_version);
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

  const errors: string[] = [];

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

  if (errors.length > 0) {
    for (const error of errors) {
      console.error(error);
    }
    process.exit(1);
  }

  console.log(
    `Noir versions aligned: ${runtimeVersion ?? "unknown"} (artifacts)`
  );
}

main().catch((error) => {
  console.error(`Noir version check failed: ${String(error)}`);
  process.exit(1);
});
