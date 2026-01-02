import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { UltraHonkBackend } from "@aztec/bb.js";

const crsPath =
  process.env.BB_CRS_PATH || process.env.CRS_PATH || "/tmp/.bb-crs";

if (!process.env.CRS_PATH) {
  process.env.CRS_PATH = crsPath;
}

try {
  mkdirSync(crsPath, { recursive: true });
} catch {
  // Best effort; directory may already exist or be read-only.
}

const crsReady =
  existsSync(path.join(crsPath, "bn254_g1.dat")) ||
  existsSync(path.join(crsPath, "bn254_g1.dat.gz")) ||
  existsSync(path.join(crsPath, "g1.dat")) ||
  existsSync(path.join(crsPath, "g1.dat.gz"));

if (crsReady) {
  console.log(`[prewarm] CRS cache already present at ${crsPath}`);
  process.exit(0);
}

const circuits = [
  "age_verification",
  "doc_validity",
  "face_match",
  "nationality_membership",
];

const baseDir = path.resolve(process.cwd(), "noir-circuits");

for (const name of circuits) {
  const artifactPath = path.join(baseDir, name, "artifacts", `${name}.json`);
  const raw = readFileSync(artifactPath, "utf8");
  const parsed = JSON.parse(raw);
  const bytecode = parsed?.bytecode;
  if (typeof bytecode !== "string" || !bytecode.length) {
    throw new Error(`Missing bytecode for ${name}`);
  }

  console.log(`[prewarm] Loading CRS via ${name} circuit`);
  const backend = new UltraHonkBackend(bytecode, {
    threads: 1,
    crsPath,
  });
  await backend.getVerificationKey();
}

console.log(`[prewarm] CRS cache ready at ${crsPath}`);
