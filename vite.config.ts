import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Prevent build failure on minor TS errors
  esbuild: {
    ignoreAnnotations: true,
    logOverride: { 'this-is-undefined-in-esm': 'silent' }
  },
  server: {
    host: true,
    allowedHosts: true, 
    proxy: {
      '/api': {
        target: 'http://localhost:80',
        changeOrigin: true
      }
    }
  }
});