import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The panel is served under /admin by the Express server.
export default defineConfig({
  base: '/admin/',
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true
  },
  server: {
    port: 5173,
    // Dev proxy so the SPA can call the bot's API on :3000
    proxy: {
      '/api': 'http://localhost:3000'
    }
  }
});
