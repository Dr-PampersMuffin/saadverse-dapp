// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Your repo name on GitHub Pages:
  base: '/saadverse-dapp/',
  // Build directly into /docs for Pages (main/docs):
  build: {
    outDir: 'docs',
    emptyOutDir: true,
  },
  // (Optional) local dev server settings
  server: {
    port: 5173,
    open: true,
  },
});
