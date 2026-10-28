import react from '@vitejs/plugin-react'
import process from 'node:process'
import { defineConfig } from 'vite'

// https://vite.dev/config/
// Config is async so we can pull in the bundle-size visualiser only when asked
// (ANALYZE=1). That keeps it out of normal builds — a normal `npm run build`
// never even imports the package, so the build still works if it isn't
// installed. Run `npm run analyze` to get an interactive size report.
export default defineConfig(async () => {
   const plugins = [react()]
   if (process.env.ANALYZE) {
      const { visualizer } = await import('rollup-plugin-visualizer')
      plugins.push(
         visualizer({
            filename: 'dist/stats.html',
            open: true,
            gzipSize: true,
            brotliSize: true,
         })
      )
   }

   return {
      plugins,
       server: {
          proxy: {
            '/api': 'http://localhost:3000',
       },
      },
      // Vitest configuration. Component tests need a DOM, so they run in
      // jsdom; the setup file wires up jest-dom matchers and auto-cleanup.
      // Pure helper tests (lib/*) don't touch the DOM but share the same
      // runner. Run with `npm test` (once) or `npm run test:watch`.
      test: {
         environment: 'jsdom',
         pool: 'vmThreads',
         globals: true,
         setupFiles: './src/test/setup.js',
         css: false,
         include: ['src/**/*.{test,spec}.{js,jsx}'],
      },
      build: {
         // Recharts and three.js are reached only from lazy pages/components.
         // Leave Recharts to Rollup's graph-aware splitting: forcing it into a
         // manual chunk makes it an entry dependency on the signed-out page.
         chunkSizeWarningLimit: 700,
         rollupOptions: {
            output: {
               // Pull the big, rarely-changing third-party code into named
               // chunks. These change far less often than our own app code, so
               // a returning visitor keeps them cached across deploys instead
               // of re-downloading them whenever we ship a change. Anything not
               // matched here is left to Rollup's default splitting, which
               // keeps code that is only reached through a lazy page in that
               // page's own on-demand chunk (e.g. papaparse stays with the
               // Import pages).
               manualChunks(id) {
                  if (!id.includes('node_modules')) return
                   if (id.includes('@tanstack')) {
                     return 'react-query'
                  }
                  if (id.includes('/three/')) {
                     // three.js is only reached through the lazy CohortConstellation
                     // on the dashboard; its own chunk keeps the WebGL bytes out of
                     // the initial load and cached across deploys.
                     return 'three'
                  }
                  if (id.includes('/write-excel-file/') || id.includes('/xlsx/')) {
                     // The .xlsx writer is only pulled in when the Export Center
                     // actually builds a workbook (lazy import in lib/xlsx.js), so
                     // its own chunk stays out of every other page's load.
                     return 'xlsx'
                  }
                  if (id.includes('/fflate/')) {
                     // The ZIP bundler is lazy-imported by lib/bundle.js only when
                     // an export produces more than one artifact.
                     return 'fflate'
                  }
                  if (
                     id.includes('/react/') ||
                     id.includes('/react-dom/') ||
                     id.includes('/react-router/') ||
                     id.includes('/react-is/') ||
                     id.includes('/scheduler/')
                  ) {
                     return 'react-vendor'
                  }
               },
            },
         },
      },
   }
})
