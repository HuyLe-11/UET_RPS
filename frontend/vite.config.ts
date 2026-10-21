import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    // /admin and other page paths belong to the React SPA. Proxying them to
    // FastAPI made Vite return the backend's 404 instead of serving index.html.
    // FastAPI currently serves only the /api namespace used by admin APIs.
    proxy: {
      '/api': 'http://127.0.0.1:8000',
    },
  },
});
