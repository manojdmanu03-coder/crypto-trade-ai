import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

const port = Number(process.env.PORT ?? 5173);
const apiTarget = process.env.API_PROXY_TARGET ?? "http://localhost:3001";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    port,
    host: "0.0.0.0",
    proxy: {
      "/api": { target: apiTarget, changeOrigin: true },
      "/ws": { target: apiTarget, ws: true, changeOrigin: true },
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    proxy: {
      "/api": { target: apiTarget, changeOrigin: true },
      "/ws": { target: apiTarget, ws: true, changeOrigin: true },
    },
  },
});
