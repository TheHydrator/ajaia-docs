import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The frontend lives in client/ and builds into dist/, which the Express server serves.
// In dev, `npm run dev:client` proxies /api to the API on port 3001.
export default defineConfig({
  root: 'client',
  plugins: [react()],
  build: { outDir: '../dist', emptyOutDir: true },
  server: { proxy: { '/api': 'http://localhost:3001' } },
});
