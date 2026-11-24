import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Libraries that change less often than the app get their own chunks, so a
// deploy that only touches app code leaves them cached. The function form
// matches every file of a package (react-dom/client included), where the
// object form matched only each package's main entry. Only a package's own
// files are named: its dependencies are left to Rollup, so a dependency the
// public pages share with an admin library is never pulled into that
// library's chunk and the public pages never load admin-only code.
const VENDOR_CHUNKS: [string, RegExp][] = [
  ['vendor-react', /\/node_modules\/(react|react-dom|scheduler|react-router|react-router-dom|@remix-run\/router)\//],
  ['vendor-lightbox', /\/node_modules\/yet-another-react-lightbox\//],
  ['vendor-charts', /\/node_modules\/recharts\//],
  ['vendor-dnd', /\/node_modules\/@dnd-kit\//],
]

function vendorChunk(id: string): string | undefined {
  return VENDOR_CHUNKS.find(([, pattern]) => pattern.test(id))?.[0]
}

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
        manualChunks: vendorChunk,
      },
    },
  },
})
