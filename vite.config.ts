import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const devPort = Number.parseInt(process.env.FE_DEV_SERVER_PORT || "15011", 10);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  envPrefix: ["VITE_", "FE_"],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "./src") },
  },
  server: {
    host: "127.0.0.1",
    port: devPort,
    strictPort: true,
  },
});
