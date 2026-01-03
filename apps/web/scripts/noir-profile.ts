import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type Mode = "opcodes" | "gates" | "execution-opcodes";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(scriptDir, "..");
const circuitsRoot = path.join(appRoot, "noir-circuits");

const rawArgs = process.argv.slice(2);
let mode: Mode = "opcodes";
let idx = 0;

if (rawArgs[0] && !rawArgs[0].startsWith("--")) {
  mode = rawArgs[0] as Mode;
  idx = 1;
}

const options: {
  circuit?: string;
  backendPath?: string;
  proverTomlPath?: string;
  outputDir: string;
} = {
  outputDir: "target",
};

for (; idx < rawArgs.length; idx++) {
  const arg = rawArgs[idx];
  if (arg === "--mode") {
    mode = (rawArgs[idx + 1] as Mode) ?? mode;
    idx += 1;
  } else if (arg === "--circuit") {
    options.circuit = rawArgs[idx + 1];
    idx += 1;
  } else if (arg === "--backend-path") {
    options.backendPath = rawArgs[idx + 1];
    idx += 1;
  } else if (arg === "--prover-toml-path") {
    options.proverTomlPath = rawArgs[idx + 1];
    idx += 1;
  } else if (arg === "--output") {
    options.outputDir = rawArgs[idx + 1] ?? options.outputDir;
    idx += 1;
  }
}

const allowedModes = new Set<Mode>(["opcodes", "gates", "execution-opcodes"]);
if (!allowedModes.has(mode)) {
  console.error(
    `Unknown mode "${mode}". Use one of: opcodes, gates, execution-opcodes.`
  );
  process.exit(1);
}

if (!fs.existsSync(circuitsRoot)) {
  console.error(`Missing noir-circuits directory: ${circuitsRoot}`);
  process.exit(1);
}

const circuits = options.circuit
  ? [options.circuit]
  : fs
      .readdirSync(circuitsRoot)
      .filter((entry) =>
        fs.statSync(path.join(circuitsRoot, entry)).isDirectory()
      )
      .filter((entry) =>
        fs.existsSync(path.join(circuitsRoot, entry, "Nargo.toml"))
      );

if (!circuits.length) {
  console.error("No Noir circuits found.");
  process.exit(1);
}

function runCommand(command: string, args: string[], cwd: string) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} failed with exit code ${result.status}`);
  }
}

for (const circuit of circuits) {
  const circuitDir = path.join(circuitsRoot, circuit);
  const artifactRel = path.join("target", `${circuit}.json`);
  const artifactAbs = path.join(circuitDir, artifactRel);
  const outputDir = path.join(circuitDir, options.outputDir);

  fs.mkdirSync(outputDir, { recursive: true });

  console.log(`\n[noir-profiler] ${circuit} (${mode})`);
  runCommand("nargo", ["compile"], circuitDir);

  if (!fs.existsSync(artifactAbs)) {
    throw new Error(`Missing artifact: ${artifactAbs}`);
  }

  if (mode === "opcodes") {
    runCommand(
      "noir-profiler",
      ["opcodes", "--artifact-path", `./${artifactRel}`, "--output", outputDir],
      circuitDir
    );
    continue;
  }

  if (mode === "gates") {
    const backendPath = options.backendPath ?? "bb";
    runCommand(
      "noir-profiler",
      [
        "gates",
        "--artifact-path",
        `./${artifactRel}`,
        "--backend-path",
        backendPath,
        "--output",
        outputDir,
        "--",
        "--include_gates_per_opcode",
      ],
      circuitDir
    );
    continue;
  }

  const proverTomlPath = options.proverTomlPath ?? "Prover.toml";
  if (!fs.existsSync(path.join(circuitDir, proverTomlPath))) {
    console.warn(
      `[noir-profiler] Skipping ${circuit}: missing ${proverTomlPath}`
    );
    continue;
  }

  runCommand(
    "noir-profiler",
    [
      "execution-opcodes",
      "--artifact-path",
      `./${artifactRel}`,
      "--prover-toml-path",
      proverTomlPath,
      "--output",
      outputDir,
    ],
    circuitDir
  );
}
