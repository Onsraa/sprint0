import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

// https://vite.dev/config/
// Auth is the X-Sprint0-User header (not cookies), and api.ts targets VITE_API_BASE
// (default http://localhost:8000) directly — so no dev proxy is needed.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
})
