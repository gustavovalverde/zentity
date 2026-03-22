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

export default defineConfig(async () => ({
  plugins: [tailwindcss(), await mdx(MdxConfig), reactRouter(), watchDocs()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./app"),
      collections: path.resolve(__dirname, "./.source"),
    },
  },
}));
