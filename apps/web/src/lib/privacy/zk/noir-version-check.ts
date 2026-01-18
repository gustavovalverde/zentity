import "server-only";

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import ageCircuit from "@/noir-circuits/age_verification/artifacts/age_verification.json";
import docValidityCircuit from "@/noir-circuits/doc_validity/artifacts/doc_validity.json";
import faceMatchCircuit from "@/noir-circuits/face_match/artifacts/face_match.json";
import nationalityCircuit from "@/noir-circuits/nationality_membership/artifacts/nationality_membership.json";

const CIRCUIT_ARTIFACTS = [
  ageCircuit,
  docValidityCircuit,
  faceMatchCircuit,
  nationalityCircuit,
] as const;

function normalizeVersion(version: string | null | undefined): string | null {
  if (!version) {
    return null;
  }
  const [prefix] = version.split("+");
  return prefix || null;
}

function readPackageVersion(packageName: string): string | null {
  const parts = packageName.startsWith("@")
    ? packageName.split("/").slice(0, 2)
    : [packageName.split("/")[0]];

  let currentDir = process.cwd();
  for (let i = 0; i < 10; i += 1) {
    const pkgPath = join(currentDir, "node_modules", ...parts, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const raw = readFileSync(pkgPath, "utf8");
        const parsed = JSON.parse(raw) as { version?: unknown };
        return typeof parsed.version === "string" ? parsed.version : null;
      } catch {
        return null;
      }
    }
    const parent = dirname(currentDir);
    if (parent === currentDir) {
      break;
    }
    currentDir = parent;
  }

  return null;
}

function getNoirArtifactVersions(): string[] {
  const versions = new Set<string>();
  for (const circuit of CIRCUIT_ARTIFACTS) {
    const version = normalizeVersion(
      (circuit as { noir_version?: string }).noir_version
    );
    if (version) {
      versions.add(version);
    }
  }
  return Array.from(versions);
}

export function checkNoirVersionDrift(): {
  runtimeVersion: string | null;
  artifactVersions: string[];
  matchesRuntime: boolean;
} {
  const runtimeVersion = readPackageVersion("@noir-lang/noir_js");
  const artifactVersions = getNoirArtifactVersions();
  const normalizedRuntime = normalizeVersion(runtimeVersion ?? undefined);
  const matchesRuntime =
    normalizedRuntime !== null &&
    artifactVersions.every((version) => version === normalizedRuntime);

  return { runtimeVersion, artifactVersions, matchesRuntime };
}
