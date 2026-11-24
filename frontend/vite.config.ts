import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Libraries that change less often than the app get their own chunks, so a
// deploy that only touches app code leaves them cached. A group also takes
// the modules its matches import, unless a higher-priority group claims them,
// so anything the public pages share with an admin library must be claimed
// first or it lands in that library's chunk and every public page loads
// admin-only code. The top group claims React and the syntax helpers the
// build injects for older browsers, which app code and recharts both use.
// (Turning off includeDependenciesRecursively instead leaves recharts'
// dependencies in the Dashboard chunk, a cycle with vendor-charts.)
const VENDOR_CHUNKS = [
  {
    name: 'vendor-react',
    test: /[\\/]node_modules[\\/](react|react-dom|scheduler|react-router|react-router-dom|@remix-run[\\/]router)[\\/]|^\0@oxc-project\+runtime@/,
    priority: 1,
  },
  { name: 'vendor-lightbox', test: /[\\/]node_modules[\\/]yet-another-react-lightbox[\\/]/ },
  { name: 'vendor-charts', test: /[\\/]node_modules[\\/]recharts[\\/]/ },
  { name: 'vendor-dnd', test: /[\\/]node_modules[\\/]@dnd-kit[\\/]/ },
]

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
    // Vite 6's default targets. Vite 8's default starts at Safari 16.4 and
    // Chrome 111, and would stop transpiling syntax that Safari 14 to 16.3
    // and Chrome 87 to 110 cannot parse.
    target: ['es2020', 'edge88', 'firefox78', 'chrome87', 'safari14'],
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: VENDOR_CHUNKS,
        },
      },
    },
  },
})
