import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, "..");

function fail(message) {
	console.error(`agent-sdk-rollout check failed: ${message}`);
	process.exitCode = 1;
}

function listTypeScriptFiles(dirPath) {
	if (!fs.existsSync(dirPath)) {
		return [];
	}

	const files = [];
	for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
		const entryPath = path.join(dirPath, entry.name);
		if (entry.isDirectory()) {
			files.push(...listTypeScriptFiles(entryPath));
			continue;
		}

		if (
			entry.isFile() &&
			(entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))
		) {
			files.push(entryPath);
		}
	}
	return files;
}

const mcpAuthDir = path.join(repoRoot, "apps", "mcp", "src", "auth");
const mcpAuthFiles = listTypeScriptFiles(mcpAuthDir);
if (mcpAuthFiles.length > 0) {
	fail(
		`apps/mcp/src/auth must stay empty after the SDK migration:\n${mcpAuthFiles
			.map((file) => `- ${path.relative(repoRoot, file)}`)
			.join("\n")}`,
	);
}

const forbiddenDemoRpFiles = [
	"apps/demo-rp/src/lib/dpop.ts",
	"apps/demo-rp/src/lib/poh-verifier.ts",
	"apps/demo-rp/src/lib/userinfo-fetch.ts",
	"apps/demo-rp/src/lib/scenarios.ts",
	"apps/demo-rp/src/components/shared/provider-validity-card.tsx",
];

// These literals encode the intended post-rollout shape: MCP auth code lives
// under runtime/services/transports, and demo-rp scenarios stay split by route.
for (const relativePath of forbiddenDemoRpFiles) {
	const absolutePath = path.join(repoRoot, relativePath);
	if (fs.existsSync(absolutePath)) {
		fail(`${relativePath} should stay deleted after the demo-rp migration`);
	}
}

const scenarioDir = path.join(repoRoot, "apps", "demo-rp", "src", "scenarios");
const scenarioFiles = listTypeScriptFiles(scenarioDir);
const concreteScenarioImportPattern =
	/from\s+["']@\/scenarios\/(aether|aid|bank|exchange|wine|x402|veripass\/wallet)(?:["'])/;

for (const filePath of scenarioFiles) {
	const relativePath = path.relative(repoRoot, filePath);
	if (relativePath.endsWith("route-scenario-registry.ts")) {
		continue;
	}

	const source = fs.readFileSync(filePath, "utf8");
	if (concreteScenarioImportPattern.test(source)) {
		fail(
			`${relativePath} imports a concrete sibling scenario module. Shared scenario code must stay in route-scenario.ts or a local subdirectory.`,
		);
	}
}

const legacyAapClaimPattern =
	/\b(?:agent_sub|zentity_context_id|zentity_release_id)\b/;
const sourceRootsWithAapClaims = [
	path.join(repoRoot, "apps", "web", "src"),
	path.join(repoRoot, "apps", "mcp", "src"),
	path.join(repoRoot, "apps", "demo-rp", "src"),
	path.join(repoRoot, "packages", "sdk", "src"),
];

for (const sourceRoot of sourceRootsWithAapClaims) {
	for (const filePath of listTypeScriptFiles(sourceRoot)) {
		const relativePath = path.relative(repoRoot, filePath);
		if (
			relativePath.includes(`${path.sep}__tests__${path.sep}`) ||
			/\.(?:test|spec)\.tsx?$/.test(relativePath)
		) {
			continue;
		}

		const source = fs.readFileSync(filePath, "utf8");
		if (legacyAapClaimPattern.test(source)) {
			fail(
				`${relativePath} references a legacy AAP claim. Use act.sub and audit.* only.`,
			);
		}
	}
}

if (process.exitCode !== 1) {
	console.log("agent-sdk-rollout checks passed");
}
