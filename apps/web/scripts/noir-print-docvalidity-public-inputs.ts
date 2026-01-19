import fs from "node:fs";

import { Barretenberg, UltraHonkBackend } from "@aztec/bb.js";
import { Noir } from "@noir-lang/noir_js";

const circuit = JSON.parse(
  fs.readFileSync(
    new URL(
      "../noir-circuits/doc_validity/artifacts/doc_validity.json",
      import.meta.url
    ),
    "utf8"
  )
);

const noir = new Noir(circuit);
const { witness } = await noir.execute({
  expiry_date: "20271231",
  current_date: "20251212",
});

const api = await Barretenberg.new();
const backend = new UltraHonkBackend(circuit.bytecode, api);
const _proofData = await backend.generateProof(witness);
process.exit(0);
