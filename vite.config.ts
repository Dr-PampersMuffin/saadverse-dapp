// vite.config.ts
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// IMPORTANT:
// - Vite automatically loads .env, .env.local, .env.[mode], .env.[mode].local
// - Only variables prefixed with VITE_ are exposed to your frontend via import.meta.env

export default ({ mode }) => {
  // Load ONLY VITE_-prefixed vars from .env/.env.local for this mode
  const env = loadEnv(mode, process.cwd(), "VITE_");

  return defineConfig({
    plugins: [react()],

    // If you serve from a subpath (GitHub Pages as /<repo>/), set base accordingly.
    // Your site is at: https://<user>.github.io/saadverse-dapp/ and you publish to /docs,
    // so the runtime paths should start with /saadverse-dapp/
    base: env.VITE_PUBLIC_BASE || "/saadverse-dapp/",

    build: {
      // You already output to /docs via package.json scripts; this keeps things consistent.
      outDir: "docs",
      emptyOutDir: true,
      // Optional: raise the chunk size warning threshold a bit if needed
      chunkSizeWarningLimit: 1200,
    },

    // You normally don’t need to forward envs here because import.meta.env.* is available.
    // If you ever want to reference a build-time constant (not via import.meta.env),
    // you could define it instead:
    // define: {
    //   __APP_ENV__: JSON.stringify(mode),
    // },
  });
};
