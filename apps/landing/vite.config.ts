import { readFileSync } from "node:fs";
import path from "node:path";
import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import mdx from "fumadocs-mdx/vite";
import { defineConfig, type Plugin } from "vite";
import * as MdxConfig from "./source.config";

const docsDir = path.resolve(__dirname, "../../docs");

// Vite only watches the project root by default. Docs live at the monorepo
// root, so we explicitly add the directory to chokidar for HMR on ?raw imports.
function watchDocs(): Plugin {
  return {
    name: "watch-docs",
    configureServer(server) {
      server.watcher.add(docsDir);
    },
  };
}

// Reads markdown files from the monorepo docs/ at build time and exposes them
// as plain string exports via `virtual:markdown-content`. This avoids both the
// runtime readFile (broken on Vercel) and ?raw imports (hijacked by fumadocs-mdx).
const markdownFiles: Record<string, string> = {
  whitepaper: path.resolve(
    docsDir,
    "papers/whitepapers/verification-without-collection/WHITEPAPER.md",
  ),
  privacy: path.resolve(docsDir, "legal/privacy-policy.md"),
  terms: path.resolve(docsDir, "legal/terms-of-service.md"),
};

function markdownContent(): Plugin {
  const virtualId = "virtual:markdown-content";
  const resolvedId = `\0${virtualId}`;

  return {
    name: "markdown-content",
    resolveId(id) {
      if (id === virtualId) return resolvedId;
    },
    load(id) {
      if (id !== resolvedId) return;
      const exports = Object.entries(markdownFiles)
        .map(
          ([key, filePath]) =>
            `export const ${key} = ${JSON.stringify(readFileSync(filePath, "utf-8"))};`,
        )
        .join("\n");
      return exports;
    },
  };
}

export default defineConfig(async () => ({
  plugins: [
    tailwindcss(),
    markdownContent(),
    await mdx(MdxConfig),
    reactRouter(),
    watchDocs(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./app"),
      collections: path.resolve(__dirname, "./.source"),
    },
  },
}));
