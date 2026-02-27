import path from "node:path";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

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

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), watchDocs()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
