import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const devPort = Number.parseInt(process.env.TREEFOLD_UI_PORT || "15011", 10);

export default defineConfig({
  root: path.resolve(import.meta.dirname, "src/renderer"),
  build: { outDir: path.resolve(import.meta.dirname, "dist"), emptyOutDir: true },
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "./src/renderer/src") },
  },
  server: {
    host: "127.0.0.1",
    port: devPort,
    strictPort: true,
  },
});
