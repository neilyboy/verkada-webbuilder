import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// During development the frontend runs on 5173 and proxies /api to the
// Node backend on 8080. In production the backend serves the built files.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8080',
    },
  },
  build: {
    outDir: 'dist',
  },
});
