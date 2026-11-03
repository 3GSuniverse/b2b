import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// In development the dashboard runs on :5173 and forwards API calls to the server on :4000,
// so cookies stay same-origin exactly like production (where the server serves this build).
const api = { target: 'http://localhost:4000', changeOrigin: false };

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    port: 5173,
    proxy: { '/api': api, '/u': api, '/webhooks': api, '/health': api },
  },
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 900 },
});
