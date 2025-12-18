import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  esbuild: {
    ignoreAnnotations: true,
    logOverride: { 'this-is-undefined-in-esm': 'silent' }
  },
  server: {
    host: true,
    allowedHosts: true, 
    proxy: {
      '/api': {
        // CHANGED: localhost -> 127.0.0.1 to force IPv4
        target: 'http://127.0.0.1:80',
        changeOrigin: true,
        secure: false,
      }
    }
  }
});