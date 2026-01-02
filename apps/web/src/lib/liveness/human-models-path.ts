import "server-only";

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

// In Docker standalone builds we copy models to `/app/human-models`.
// For local dev we fall back to node_modules.
const standaloneModelsPath = path.join(process.cwd(), "human-models");
const nodeModulesModelsPath = path.join(
  process.cwd(),
  "node_modules",
  "@vladmandic",
  "human-models",
  "models"
);

const resolvedPath = fs.existsSync(standaloneModelsPath)
  ? standaloneModelsPath
  : nodeModulesModelsPath;

// Filesystem path for serving model files.
export const HUMAN_MODELS_DIR = resolvedPath;

// TensorFlow.js Node.js backend requires file:// URLs for local paths.
// Ensure trailing slash so relative URL resolution works correctly.
export const HUMAN_MODELS_URL = pathToFileURL(resolvedPath + path.sep).href;
