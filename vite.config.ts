// vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// IMPORTANT: this must match your repo name
export default defineConfig({
  base: '/saadverse-dapp/',
  plugins: [react()],
})
