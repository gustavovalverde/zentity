# Noir Profiling

This repo uses Noir circuits under `apps/web/noir-circuits`. The Noir toolchain
includes `noir-profiler`, which can emit opcode flamegraphs, execution opcodes,
and proving backend gate breakdowns.

## Prerequisites

- `nargo` + `noir-profiler` installed (via `noirup`).
- For gate profiling, the Barretenberg CLI (`bb`) must be available on `PATH`.

## Scripts (recommended)

Run from `apps/web`:

- `bun run circuits:profile` (opcodes, all circuits)
- `bun run circuits:profile:opcodes`
- `bun run circuits:profile:gates` (requires `bb`)
- `bun run circuits:profile:execution` (requires `Prover.toml` per circuit)

Optional flags:

- `--circuit <name>`: run for a single circuit
- `--backend-path <path>`: override `bb` path for gate profiling
- `--prover-toml-path <path>`: override `Prover.toml` for execution opcodes
- `--output <dir>`: output directory (default: `target`)

## Manual commands

From a circuit directory (example: `apps/web/noir-circuits/age_verification`):

```bash
nargo compile
noir-profiler opcodes --artifact-path ./target/age_verification.json --output ./target
```

Gate profiling (requires `bb`):

```bash
noir-profiler gates --artifact-path ./target/age_verification.json \
  --backend-path bb \
  --output ./target \
  -- --include_gates_per_opcode
```

Execution opcodes (requires `Prover.toml` with inputs):

```bash
noir-profiler execution-opcodes --artifact-path ./target/age_verification.json \
  --prover-toml-path Prover.toml \
  --output ./target
```

## Quick constraint counts

For a quick opcode/gate summary without flamegraphs:

```bash
nargo info
```
