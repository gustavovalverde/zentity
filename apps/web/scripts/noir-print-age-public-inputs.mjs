import fs from "node:fs";
import { UltraHonkBackend } from "@aztec/bb.js";
import { Noir } from "@noir-lang/noir_js";

const ageCircuit = JSON.parse(
  fs.readFileSync(
    new URL(
      "../noir-circuits/age_verification/artifacts/age_verification.json",
      import.meta.url,
    ),
    "utf8",
  ),
);

const noir = new Noir(ageCircuit);
const { witness } = await noir.execute({
  birth_year: "1990",
  current_year: "2025",
  min_age: "18",
});

const backend = new UltraHonkBackend(ageCircuit.bytecode, { threads: 1 });
const _proofData = await backend.generateProof(witness);

// bb.js keeps worker threads alive; exit explicitly for scripts.
process.exit(0);
