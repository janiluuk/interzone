import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  root: path.resolve(__dirname, "."),
  build: {
    outDir: path.resolve(__dirname, "../../dist/dashboard"),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      "/v1": "http://localhost:4242",
      "/admin": "http://localhost:4242",
      "/ws": { target: "ws://localhost:4242", ws: true },
    },
  },
});
