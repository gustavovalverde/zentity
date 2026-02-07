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
      "node_modules/@aztec/bb.js/dest/node/barretenberg_wasm/barretenberg-threads.wasm.gz"
    ),
    // bb.js appends "-threads" to wasmPath when multi-threading is enabled.
    // Worker passes "/bb/barretenberg.wasm.gz", bb.js requests "barretenberg-threads.wasm.gz"
    to: path.join(root, "public/bb/barretenberg-threads.wasm.gz"),
    required: true,
  },
  {
    id: "bb-single",
    // Non-threaded WASM is embedded as a base64 data URL in bb.js's browser build.
    // Extracted at setup time so bb.js can fetch it from our local path.
    from: "__extract_from_data_url__",
    to: path.join(root, "public/bb/barretenberg.wasm.gz"),
    required: true,
    extractDataUrl: path.join(
      root,
      "node_modules/@aztec/bb.js/dest/browser/barretenberg_wasm/fetch_code/browser/barretenberg.js"
    ),
  },
  // =========================================================================
  // Noir.js runtime (ACVM + ABI) WASM assets
  // =========================================================================
  {
    id: "noir-acvm-wasm",
    from: path.join(
      root,
      "node_modules/@noir-lang/acvm_js/web/acvm_js_bg.wasm"
    ),
    to: path.join(root, "public/noir/acvm_js_bg.wasm"),
    required: true,
  },
  {
    id: "noir-abi-wasm",
    from: path.join(
      root,
      "node_modules/@noir-lang/noirc_abi/web/noirc_abi_wasm_bg.wasm"
    ),
    to: path.join(root, "public/noir/noirc_abi_wasm_bg.wasm"),
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
      "node_modules/tfhe/snippets/wasm-bindgen-rayon-38edf6e439f6d70d/src/workerHelpers.js"
    ),
    // Must match the import path in tfhe.js
    to: path.join(
      root,
      "public/tfhe/snippets/wasm-bindgen-rayon-38edf6e439f6d70d/src/workerHelpers.js"
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
      "node_modules/@zama-fhe/relayer-sdk/bundle/relayer-sdk-js.umd.cjs"
    ),
    to: path.join(root, "public/fhevm/relayer-sdk-js.umd.js"),
    required: true,
  },
  {
    id: "zama-worker-helpers",
    from: path.join(
      root,
      "node_modules/@zama-fhe/relayer-sdk/bundle/workerHelpers.js"
    ),
    to: path.join(root, "public/workerHelpers.js"),
    required: true,
  },
  {
    id: "zama-tfhe-wasm",
    from: path.join(
      root,
      "node_modules/@zama-fhe/relayer-sdk/bundle/tfhe_bg.wasm"
    ),
    to: path.join(root, "public/tfhe_bg.wasm"),
    required: true,
  },
  {
    id: "zama-kms-wasm",
    from: path.join(
      root,
      "node_modules/@zama-fhe/relayer-sdk/bundle/kms_lib_bg.wasm"
    ),
    to: path.join(root, "public/kms_lib_bg.wasm"),
    required: true,
  },
];

for (const asset of assets) {
  const extractSource = (asset as { extractDataUrl?: string }).extractDataUrl;

  if (extractSource) {
    // Extract gzipped WASM from base64 data URL embedded in JS module
    if (!fs.existsSync(extractSource)) {
      if (asset.required) {
        throw new Error(
          `Missing required data URL source (${asset.id}): ${extractSource}`
        );
      }
      continue;
    }
    const jsContent = fs.readFileSync(extractSource, "utf-8");
    const match = jsContent.match(
      /data:application\/gzip;base64,([A-Za-z0-9+/=]+)/
    );
    if (!match) {
      throw new Error(
        `Could not extract base64 data URL from ${extractSource}`
      );
    }
    fs.mkdirSync(path.dirname(asset.to), { recursive: true });
    fs.writeFileSync(asset.to, Buffer.from(match[1], "base64"));
    continue;
  }

  if (!fs.existsSync(asset.from)) {
    if (asset.required) {
      throw new Error(
        `Missing required COEP asset (${asset.id}): ${asset.from}`
      );
    }
    continue;
  }

  fs.mkdirSync(path.dirname(asset.to), { recursive: true });
  fs.copyFileSync(asset.from, asset.to);
}
