import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const runtime = "nodejs";

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

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initTelemetry } = await import("@/lib/observability/telemetry");
    initTelemetry();

    // Preload Human.js models for faster first liveness request
    const { warmupHumanServer } = await import(
      "@/lib/identity/liveness/human-server"
    );
    await warmupHumanServer();

    // Preload ZK verification keys and CRS cache for faster first proof verification
    const { warmupCRS } = await import("@/lib/privacy/zk/noir-verifier");
    await warmupCRS();

    // Preload Barretenberg for server-side hashing (claim hashes, Merkle trees)
    const { warmupBarretenberg } = await import(
      "@/lib/privacy/crypto/barretenberg"
    );
    await warmupBarretenberg();

    // Check Noir/bb.js WASM assets presence
    const { logNoirWasmAssetStatus } = await import(
      "@/lib/privacy/zk/asset-integrity"
    );
    logNoirWasmAssetStatus();

    // Warn if Noir runtime version mismatches compiled artifacts
    const [
      ageCircuit,
      docValidityCircuit,
      faceMatchCircuit,
      nationalityCircuit,
    ] = await Promise.all([
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

    const runtimeVersion = readPackageVersion("@noir-lang/noir_js");
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

    // Check backend services health and establish connections
    const { warmupServices } = await import(
      "@/lib/observability/service-warmup"
    );
    await warmupServices();
  }
}
