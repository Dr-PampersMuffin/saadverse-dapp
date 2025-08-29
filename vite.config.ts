import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// IMPORTANT: this MUST match your repo name!
export default defineConfig({
  plugins: [react()],
  base: "/saadverse-dapp/",
  build: {
    outDir: 'docs',
    sourcemap: false,
  },
  server: {
    port: 5173,
    open: true,
  },
});
