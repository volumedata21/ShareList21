import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  return {
    plugins: [react()],
    server: {
      // 1. Listen on all IPs (0.0.0.0)
      host: true,
      
      // 2. CRITICAL FIX: Allow ANY domain name to access the dev server.
      // This stops the "Blocked request" error for reverse proxies.
      allowedHosts: true, 
      
      proxy: {
        '/api': {
          target: 'http://localhost:80', // Internal backend port
          changeOrigin: true
        }
      }
    }
  };
});