// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// MUST match your repo name exactly
export default defineConfig({
  plugins: [react()],
  base: "/saadverse-dapp/",
});
