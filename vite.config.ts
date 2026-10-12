import path from "node:path";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const devPort = Number.parseInt(process.env.TREEFOLD_UI_PORT || "15011", 10);
const metadata = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
let commit: string | null = null;
try {
  commit = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: import.meta.dirname,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
} catch {
  // Source archives may not include Git metadata. Never invent a revision.
}

export default defineConfig({
  root: path.resolve(import.meta.dirname, "src/renderer"),
  build: { outDir: path.resolve(import.meta.dirname, "dist"), emptyOutDir: true },
  plugins: [react(), tailwindcss()],
  define: {
    __TREEFOLD_BUILD_INFO__: JSON.stringify({
      version: process.env.TREEFOLD_BUILD_VERSION ?? metadata.version,
      commit,
      repository: metadata.repository.url,
      website: metadata.homepage,
      author: metadata.author,
      copyright: metadata.copyright,
    }),
  },
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "./src/renderer/src") },
  },
  server: {
    host: "127.0.0.1",
    port: devPort,
    strictPort: true,
  },
});
