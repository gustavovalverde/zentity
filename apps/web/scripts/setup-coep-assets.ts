import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

// Assets served locally for better performance and reliability.
// With coi-serviceworker, COEP headers are injected into all responses.
const assets = [
  // =========================================================================
  // Barretenberg (Noir ZK proofs)
  // =========================================================================
  {
    id: "bb-threads",
    from: path.join(
      root,
      "node_modules/@aztec/bb.js/dest/node/barretenberg_wasm/barretenberg-threads.wasm.gz",
    ),
    // bb.js appends "-threads" to wasmPath when multi-threading is enabled.
    // Worker passes "/bb/barretenberg.wasm.gz", bb.js requests "barretenberg-threads.wasm.gz"
    to: path.join(root, "public/bb/barretenberg-threads.wasm.gz"),
    required: true,
  },
  {
    id: "bb-single",
    from: path.join(
      root,
      "node_modules/@aztec/bb.js/dest/node/barretenberg_wasm/barretenberg-threads.wasm.gz",
    ),
    // bb.js drops the "-threads" suffix when threads=1, so serve a copy
    // under the non-threaded filename for environments without COI/SAB.
    to: path.join(root, "public/bb/barretenberg.wasm.gz"),
    required: true,
  },
  // =========================================================================
  // TFHE-rs (client-side FHE encryption/decryption)
  // Copied to public to avoid Turbopack hanging on 5MB WASM analysis.
  // tfhe-browser.ts loads from /tfhe/ instead of node_modules.
  // =========================================================================
  {
    id: "tfhe-wasm",
    from: path.join(root, "node_modules/tfhe/tfhe_bg.wasm"),
    to: path.join(root, "public/tfhe/tfhe_bg.wasm"),
    required: true,
  },
  {
    id: "tfhe-js",
    from: path.join(root, "node_modules/tfhe/tfhe.js"),
    to: path.join(root, "public/tfhe/tfhe.js"),
    required: true,
  },
  {
    id: "tfhe-worker-helpers",
    from: path.join(
      root,
      "node_modules/tfhe/snippets/wasm-bindgen-rayon-38edf6e439f6d70d/src/workerHelpers.js",
    ),
    // Must match the import path in tfhe.js
    to: path.join(
      root,
      "public/tfhe/snippets/wasm-bindgen-rayon-38edf6e439f6d70d/src/workerHelpers.js",
    ),
    required: true,
  },
  // =========================================================================
  // Zama fhEVM Relayer SDK
  // =========================================================================
  {
    id: "zama-sdk",
    from: path.join(
      root,
      "node_modules/@zama-fhe/relayer-sdk/bundle/relayer-sdk-js.umd.cjs",
    ),
    to: path.join(root, "public/fhevm/relayer-sdk-js.umd.js"),
    required: true,
  },
  {
    id: "zama-worker-helpers",
    from: path.join(
      root,
      "node_modules/@zama-fhe/relayer-sdk/bundle/workerHelpers.js",
    ),
    to: path.join(root, "public/workerHelpers.js"),
    required: true,
  },
  {
    id: "zama-tfhe-wasm",
    from: path.join(
      root,
      "node_modules/@zama-fhe/relayer-sdk/bundle/tfhe_bg.wasm",
    ),
    to: path.join(root, "public/tfhe_bg.wasm"),
    required: true,
  },
  {
    id: "zama-kms-wasm",
    from: path.join(
      root,
      "node_modules/@zama-fhe/relayer-sdk/bundle/kms_lib_bg.wasm",
    ),
    to: path.join(root, "public/kms_lib_bg.wasm"),
    required: true,
  },
];

for (const asset of assets) {
  if (!fs.existsSync(asset.from)) {
    if (asset.required) {
      throw new Error(
        `Missing required COEP asset (${asset.id}): ${asset.from}`,
      );
    }
    continue;
  }

  fs.mkdirSync(path.dirname(asset.to), { recursive: true });
  fs.copyFileSync(asset.from, asset.to);
}
