import { readFileSync } from "node:fs";
import { findPackageJSON } from "node:module";

export function normalizeVersion(
  version: string | null | undefined
): string | null {
  if (!version) {
    return null;
  }
  const [prefix] = version.split("+");
  return prefix || null;
}

/**
 * Installed version of a dependency, or null when it cannot be resolved.
 * Resolves the package.json directly, so it also works for packages whose
 * export map hides `./package.json` (bb.js, noir_js).
 */
export function readInstalledVersion(packageName: string): string | null {
  try {
    const pkgPath = findPackageJSON(packageName, import.meta.url);
    if (!pkgPath) {
      return null;
    }
    const parsed = JSON.parse(readFileSync(pkgPath, "utf8")) as {
      version?: unknown;
    };
    return typeof parsed.version === "string" ? parsed.version : null;
  } catch {
    return null;
  }
}

export async function checkNoirVersions() {
  const [ageCircuit, docValidityCircuit, faceMatchCircuit, nationalityCircuit] =
    await Promise.all([
      import(
        "@/noir-circuits/age_verification/artifacts/age_verification.json"
      ),
      import("@/noir-circuits/doc_validity/artifacts/doc_validity.json"),
      import("@/noir-circuits/face_match/artifacts/face_match.json"),
      import(
        "@/noir-circuits/nationality_membership/artifacts/nationality_membership.json"
      ),
    ]);

  const artifactVersions = new Set<string>();
  for (const circuit of [
    ageCircuit,
    docValidityCircuit,
    faceMatchCircuit,
    nationalityCircuit,
  ]) {
    const version = normalizeVersion(
      (circuit as { noir_version?: string }).noir_version
    );
    if (version) {
      artifactVersions.add(version);
    }
  }

  const runtimeVersion = readInstalledVersion("@noir-lang/noir_js");
  const normalizedRuntime = normalizeVersion(runtimeVersion ?? undefined);
  const matchesRuntime =
    normalizedRuntime !== null &&
    [...artifactVersions].every((version) => version === normalizedRuntime);

  if (!matchesRuntime) {
    const { logger } = await import("@/lib/logging/logger");
    logger.warn(
      {
        runtimeVersion,
        artifactVersions: [...artifactVersions],
      },
      "Noir runtime version does not match compiled circuit artifacts"
    );
  }
}
