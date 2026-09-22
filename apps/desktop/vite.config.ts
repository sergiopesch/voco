import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

const host = process.env.TAURI_DEV_HOST;
// Retain Vite 6's output targets when changing the compiler and bundler.
const browserTargets = ["edge88", "firefox78", "chrome87", "safari14"];

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    target: ["es2020", ...browserTargets],
    cssTarget: browserTargets,
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 5174,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
});
