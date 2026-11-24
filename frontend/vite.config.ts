import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Loopback unless VITE_HOST asks for more (0.0.0.0 to reach the dev
    // server from another machine).
    host: process.env.VITE_HOST || '127.0.0.1',
    port: 5173,
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-lightbox': ['yet-another-react-lightbox'],
          'vendor-charts': ['recharts'],
          'vendor-dnd': ['@dnd-kit/core', '@dnd-kit/sortable', '@dnd-kit/utilities'],
        },
      },
    },
  },
})
